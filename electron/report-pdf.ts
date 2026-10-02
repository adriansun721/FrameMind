import { BrowserWindow } from "electron";

/** A disposable offline renderer; CSP blocks page scripts, the host waits for fonts and figures. */
export async function renderReportPdf(html: string): Promise<Buffer> {
  const prefix = '<!doctype html><html lang="zh-CN"><head>';
  if (!html.startsWith(prefix)) throw new Error("PDF 排版文档无效");
  // Enforce policy at the host boundary, even if the caller omits its own CSP.
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'none\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'" />';
  const document = prefix + policy + html.slice(prefix.length);
  const window = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false,
    partition: "report-print",
  } });
  window.webContents.session.webRequest.onBeforeRequest((request, done) => done({ cancel: !request.url.startsWith("data:") }));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
        await window.webContents.executeJavaScript(`Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())]).then(() => true)`)
          .catch(() => { throw new Error("PDF 图表或字体加载失败，未写入报告"); });
        const bytes = await window.webContents.printToPDF({
          pageSize: "A4", preferCSSPageSize: true, printBackground: true,
          displayHeaderFooter: true, headerTemplate: "<span></span>",
          footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#000">FrameMind &nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
          margins: { top: 20 / 25.4, bottom: 20 / 25.4, left: 20 / 25.4, right: 20 / 25.4 },
        });
        if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF 计算书生成失败");
        return bytes;
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("PDF 排版超时，请减少附录内容后重试")), 60_000); }),
    ]);
  } finally {
    clearTimeout(timer);
    if (!window.isDestroyed()) window.destroy();
  }
}
