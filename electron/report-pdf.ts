import { BrowserWindow } from "electron";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** Disposable offline print renderers, bounded by the report's table batches. */
export async function renderReportPdf(html: string): Promise<Buffer> {
  const prefix = '<!doctype html><html lang="zh-CN"><head>';
  if (!html.startsWith(prefix)) throw new Error("PDF 排版文档无效");
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'none\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'" />';
  const document = prefix + policy + html.slice(prefix.length);
  const bodyStart = document.indexOf("<body>"); const bodyEnd = document.lastIndexOf("</body>");
  const bodies = bodyStart < 0 || bodyEnd < bodyStart ? [document] : document.slice(bodyStart + 6, bodyEnd).split("<!--FRAMEMIND_PRINT_PART-->").map((part) => document.slice(0, bodyStart + 6) + part + document.slice(bodyEnd));
  const directory = await mkdtemp(join(tmpdir(), "framemind-report-"));
  const path = join(directory, "report.html"); const allowedUrl = pathToFileURL(path).href;
  const partition = `report-print-${randomUUID()}`;
  let current: BrowserWindow | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const print = async (content: string): Promise<Buffer> => {
    if (expired) throw new Error("PDF 排版超时");
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition } });
    current = window;
    window.webContents.session.webRequest.onBeforeRequest((request, done) => done({ cancel: request.url !== allowedUrl && !request.url.startsWith("data:") }));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    try {
      await writeFile(path, content, "utf8");
      await window.loadFile(path);
      await window.webContents.executeJavaScript(`Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())]).then(() => true)`)
        .catch(() => { throw new Error("PDF 图表或字体加载失败，未写入报告"); });
      return await window.webContents.printToPDF({
        pageSize: "A4", preferCSSPageSize: true, printBackground: true,
        displayHeaderFooter: bodies.length === 1, headerTemplate: "<span></span>",
        footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#000">FrameMind &nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        margins: { top: 20 / 25.4, bottom: 20 / 25.4, left: 20 / 25.4, right: 20 / 25.4 },
      });
    } finally { if (!window.isDestroyed()) window.destroy(); current = undefined; }
  };
  try {
    return await Promise.race([
      (async () => {
        if (bodies.length === 1) {
          const bytes = await print(bodies[0]);
          if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF 计算书生成失败");
          return bytes;
        }
        const merged = await PDFDocument.create();
        merged.setCreator("FrameMind"); merged.setProducer("FrameMind / Chromium / pdf-lib");
        for (const body of bodies) {
          const source = await PDFDocument.load(await print(body));
          for (const page of await merged.copyPages(source, source.getPageIndices())) merged.addPage(page);
        }
        const font = await merged.embedFont(StandardFonts.Helvetica);
        const pages = merged.getPages();
        pages.forEach((page, index) => {
          const footer = `FrameMind   ${index + 1} / ${pages.length}`;
          page.drawText(footer, { x: (page.getWidth() - font.widthOfTextAtSize(footer, 9)) / 2, y: 22, size: 9, font });
        });
        return Buffer.from(await merged.save());
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; if (current && !current.isDestroyed()) current.destroy(); reject(new Error("PDF 排版超时，请减少附录内容后重试")); }, 60_000); }),
    ]);
  } finally {
    clearTimeout(timer); expired = true;
    if (current && !current.isDestroyed()) current.destroy();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid report cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
