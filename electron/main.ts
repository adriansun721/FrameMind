import { app, BrowserWindow, dialog, ipcMain, safeStorage, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  DesktopChannel,
  type OpenProjectResult,
  type SaveProjectRequest,
  type SaveProjectResult,
  type ExportReportWordRequest,
  type ExportReportPdfRequest,
  type CadImportRequest,
  type CadImportResult,
  type CadParsePhase,
} from "./contracts";
import { ProjectFileStore } from "./project-files";
import { ChatHistoryStore } from "./chat-history";
import { RecoveryStore } from "./recovery-store";
import { DeepSeekConnection } from "./deepseek";
import { renderReportPdf } from "./report-pdf";
import { NativeAnalysisHost } from "./native-analysis";
import { CadParserHost } from "./cad-parser";
import { ProjectHistoryStore } from "./project-history-store";
import { ProjectCandidates } from "./project-candidates";
import { CadImportSources } from "./cad-import-sources";

const nativeAnalysis = new NativeAnalysisHost(app.isPackaged
  ? join(process.resourcesPath, "native", "framemind-core.exe")
  : join(__dirname, "../native/bin/framemind-core.exe"));
const cadParser = new CadParserHost({ worker: app.isPackaged
  ? join(process.resourcesPath, "cad", "cad-parser-worker.mjs")
  : join(__dirname, "../scripts/cad-parser-worker.mjs") });
app.on("before-quit", () => { nativeAnalysis.dispose(); cadParser.dispose(); });

const projectFiles = new ProjectFileStore();
if (process.env.FRAMEMIND_E2E_USER_DATA_PATH) app.setPath("userData", process.env.FRAMEMIND_E2E_USER_DATA_PATH);
const chatHistories = new ChatHistoryStore(join(app.getPath("userData"), "chat-history"));
const recoveries = new RecoveryStore(join(app.getPath("userData"), "recovery"));
const projectCheckpoints = new ProjectHistoryStore(join(app.getPath("userData"), "project-history"));
const projectCandidates = new ProjectCandidates(projectCheckpoints);
const cadImportSources = new CadImportSources();

let deepSeek: DeepSeekConnection;
const productionUrl = pathToFileURL(join(__dirname, "../dist/index.html")).href;
const developmentUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
const trustedUrl = developmentUrl ?? productionUrl;
function requireTrustedSender(event: IpcMainInvokeEvent): void {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame
    || event.senderFrame.url !== trustedUrl && event.senderFrame.url !== `${trustedUrl}/`) {
    throw new Error("不允许访问本机连接设置");
  }
}
ipcMain.handle(DesktopChannel.RecordProjectCheckpoints, (event, request) => { requireTrustedSender(event); return projectCheckpoints.record(request); });
ipcMain.handle(DesktopChannel.ListProjectCheckpoints, (event, projectId: string) => { requireTrustedSender(event); return projectCheckpoints.list(projectId); });
ipcMain.handle(DesktopChannel.ReadProjectCheckpoint, (event, request) => { requireTrustedSender(event); return projectCheckpoints.read(request.projectId, request.commit); });
ipcMain.handle(DesktopChannel.ReadProjectCheckpointEvidence, (event, request) => { requireTrustedSender(event); return projectCheckpoints.readEvidence(request.projectId, request.commit); });
ipcMain.handle(DesktopChannel.SyncCandidateContext, (event, request) => { requireTrustedSender(event); projectCandidates.sync(event.sender.id, request); });
ipcMain.handle(DesktopChannel.CandidateTool, (event, request) => { requireTrustedSender(event); return projectCandidates.tool(event.sender.id, request); });
ipcMain.handle(DesktopChannel.InspectCandidate, (event, taskId) => { requireTrustedSender(event); return projectCandidates.inspect(event.sender.id, taskId); });
ipcMain.handle(DesktopChannel.MergeCandidate, (event, request) => {
  requireTrustedSender(event);
  if (!request || Object.keys(request).some((key) => !["taskId", "expectedCommit"].includes(key))) throw new Error("合并拒绝未知参数或强制信号");
  return projectCandidates.merge(event.sender.id, request.taskId, request.expectedCommit);
});
ipcMain.handle(DesktopChannel.RestoreProjectCheckpoint, (event, selector) => { requireTrustedSender(event); return projectCandidates.restore(event.sender.id, selector); });
ipcMain.handle(DesktopChannel.VerifyCadImportSource, (event, request) => { requireTrustedSender(event); return cadImportSources.verify(event.sender.id, request); });
ipcMain.handle(DesktopChannel.GetDeepSeekSettings, (event) => {
  requireTrustedSender(event); return deepSeek.getSettings();
});
ipcMain.handle(DesktopChannel.RunNativeAnalysis, (event, request: unknown) => {
  requireTrustedSender(event);
  return nativeAnalysis.run(event.sender.id, request, (message) => {
    if (!event.sender.isDestroyed()) event.sender.send(DesktopChannel.NativeAnalysisPhase, message);
  });
});
ipcMain.handle(DesktopChannel.CancelNativeAnalysis, (event, requestId: string) => {
  requireTrustedSender(event);
  if (typeof requestId !== "string") throw new Error("原生请求身份无效");
  nativeAnalysis.cancel(event.sender.id, requestId);
});
ipcMain.handle(DesktopChannel.CancelCadImport, (event, requestId: unknown) => {
  requireTrustedSender(event);
  if (typeof requestId !== "string") throw new Error("CAD 任务身份无效");
  cadParser.cancel(event.sender.id, requestId);
});
ipcMain.handle(DesktopChannel.ExportCadPreview, async (event, request: { suggestedName: string; content: string }): Promise<SaveProjectResult> => {
  requireTrustedSender(event);
  if (!request || typeof request.content !== "string" || request.content.length > 32 * 1024 * 1024 || typeof request.suggestedName !== "string") throw new Error("CAD 预览导出无效");
  const parsed = JSON.parse(request.content);
  if (parsed.task !== "P25-04" || parsed.previewOnly !== true || !/^[a-f0-9]{64}$/.test(parsed.inputSha256)) throw new Error("CAD 预览身份无效");
  let target = process.env.FRAMEMIND_E2E_CAD_PREVIEW_PATH;
  if (!target) {
    const name = request.suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120);
    const selection = await dialog.showSaveDialog({ title: "导出 STEP 预览", defaultPath: `${name}.json`, filters: [{ name: "预览 JSON", extensions: ["json"] }] });
    if (selection.canceled || !selection.filePath) return { status: "cancelled" };
    target = selection.filePath;
  }
  if (!target.toLowerCase().endsWith(".json")) target += ".json";
  await projectFiles.save(target, request.content);
  return { status: "saved", path: target };
});
ipcMain.handle(DesktopChannel.ImportStep, async (event, request: CadImportRequest): Promise<CadImportResult> => {
  requireTrustedSender(event);
  if (!request || typeof request.projectContent !== "string" || request.projectContent.length > 64 * 1024 * 1024) throw new Error("导入前恢复内容无效");
  let targetPath = request.path ?? process.env.FRAMEMIND_E2E_STEP_PATH ?? null;
  if (!targetPath) {
    const result = await dialog.showOpenDialog({ title: "导入 STEP 装配", properties: ["openFile"], filters: [{ name: "STEP CAD 文件", extensions: ["step", "stp"] }] });
    if (result.canceled || result.filePaths.length === 0) return { status: "cancelled" };
    targetPath = result.filePaths[0];
  }
  if (typeof targetPath !== "string" || !targetPath || ![".step", ".stp"].includes(extname(targetPath).toLowerCase())) throw new Error("CAD 输入必须是 .step 或 .stp 文件");
  targetPath = resolve(targetPath);
  // The checkpoint is the only project write in this operation. The parser can only
  // produce an intermediate result, so a crash cannot change the formal model.
  await recoveries.save({ content: request.projectContent, formalSave: request.formalSave ?? null });
  await projectCheckpoints.record({ projectId: JSON.parse(request.projectContent).id, snapshots: [{ kind: "step-before", content: request.projectContent }] });
  const taskId = `cad_${randomUUID()}`;
  const messages = await cadParser.run(event.sender.id, { requestId: taskId, inputPath: targetPath, ...(request.retryOf ? { retryOf: request.retryOf } : {}), ...(request.parameters ? { parameters: request.parameters } : {}) });
  const phases = messages.filter((message): message is CadParsePhase => message.kind === "phase");
  const terminal = messages.at(-1);
  if (terminal?.kind === "result") {
    cadImportSources.register(event.sender.id, taskId, targetPath, terminal.input.sha256);
    terminal.sourceFile = { name: basename(targetPath), importedAt: new Date().toISOString() };
    return { status: "parsed", path: targetPath, checkpointed: true, phases, result: terminal };
  }
  const error = terminal?.kind === "error" ? terminal.error : { code: "cad-no-result", message: "CAD 解析未返回结果", stage: "startup" as const };
  return { status: "failed", path: targetPath, checkpointed: true, phases, error, requestId: taskId, ...(request.retryOf ? { retryOf: request.retryOf } : {}) };
});
ipcMain.handle(DesktopChannel.SaveDeepSeekSettings, (event, request: unknown) => {
  requireTrustedSender(event); return deepSeek.save(request);
});
ipcMain.handle(DesktopChannel.RemoveDeepSeekCredential, (event) => {
  requireTrustedSender(event); return deepSeek.remove();
});
ipcMain.handle(DesktopChannel.TestDeepSeekConnection, (event) => {
  requireTrustedSender(event); return deepSeek.testConnection();
});
ipcMain.handle(DesktopChannel.ChatDeepSeek, (event, request) => {
  requireTrustedSender(event); return deepSeek.chat(request);
});
ipcMain.handle(DesktopChannel.CancelDeepSeekChat, (event, requestId: unknown) => {
  requireTrustedSender(event); return deepSeek.cancelChat(requestId);
});

ipcMain.handle(DesktopChannel.SetTheme, (event, theme: unknown) => {
  if (theme !== "dark" && theme !== "light") throw new Error("不支持的主题");
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.setTitleBarOverlay(theme === "light"
    ? { color: "#f0f0f0", symbolColor: "#484848" }
    : { color: "#202020", symbolColor: "#b6b6b6" });
  window?.setBackgroundColor(theme === "light" ? "#f7f7f7" : "#1a1a1a");
});

ipcMain.handle(DesktopChannel.SaveChatHistory, (event, request: { projectId: string; content: string }) => {
  requireTrustedSender(event);
  return chatHistories.save(request.projectId, request.content);
});
ipcMain.handle(DesktopChannel.LoadChatHistory, (event, projectId: string) => {
  requireTrustedSender(event);
  return chatHistories.load(projectId);
});
ipcMain.handle(DesktopChannel.SaveRecovery, (event, request) => { requireTrustedSender(event); return recoveries.save(request); });
ipcMain.handle(DesktopChannel.ListRecovery, (event) => { requireTrustedSender(event); return recoveries.list(); });
ipcMain.handle(DesktopChannel.ReadRecovery, (event, id: string) => { requireTrustedSender(event); return recoveries.read(id); });

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#1a1a1a",
    title: "FrameMind",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#202020",
      symbolColor: "#b6b6b6",
      height: 33,
    },
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  const owner = window.webContents.id;
  window.webContents.on("destroyed", () => { nativeAnalysis.cancelOwner(owner); cadParser.cancelOwner(owner); projectCandidates.close(owner); });
  window.webContents.on("render-process-gone", () => { nativeAnalysis.cancelOwner(owner); cadParser.cancelOwner(owner); });
  window.webContents.on("did-start-loading", () => { nativeAnalysis.cancelOwner(owner); cadParser.cancelOwner(owner); });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== trustedUrl && url !== `${trustedUrl}/`) event.preventDefault();
  });

  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle(DesktopChannel.SaveProject, async (event, request: SaveProjectRequest): Promise<SaveProjectResult> => {
  requireTrustedSender(event);
  const automatedPath = process.env.FRAMEMIND_E2E_PROJECT_PATH;
  if (!request || typeof request.content !== "string" || (request.historyMode !== undefined && !["copy", "new"].includes(request.historyMode))) throw new Error("项目保存请求无效");
  let targetPath = request.saveAs ? process.env.FRAMEMIND_E2E_SAVE_AS_PATH ?? null : request.path ?? automatedPath ?? null;

  if (!targetPath) {
    const result = await dialog.showSaveDialog({
      title: "保存 FrameMind 项目",
      defaultPath: "未命名项目.framemind",
      filters: [{ name: "FrameMind 项目", extensions: ["framemind"] }],
    });
    if (result.canceled || !result.filePath) {
      return { status: "cancelled" as const };
    }
    targetPath = result.filePath;
  }

  if (!targetPath.toLowerCase().endsWith(".framemind")) targetPath += ".framemind";
  const saved = await projectCheckpoints.save(targetPath, request.content, request.historyMode);
  return { status: "saved" as const, path: targetPath, ...saved, savedAt: (await stat(targetPath)).mtime.toISOString() };
});

ipcMain.handle(DesktopChannel.OpenProject, async (event): Promise<OpenProjectResult> => {
  requireTrustedSender(event);
  const automatedPath = process.env.FRAMEMIND_E2E_PROJECT_PATH;
  let targetPath = automatedPath ?? null;

  if (!targetPath) {
    const result = await dialog.showOpenDialog({
      title: "打开 FrameMind 项目",
      properties: ["openFile"],
      filters: [{ name: "FrameMind 项目", extensions: ["framemind"] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { status: "cancelled" as const };
    }
    targetPath = result.filePaths[0];
  }

  return {
    status: "opened" as const,
    path: targetPath,
    ...await projectCheckpoints.open(targetPath),
    savedAt: (await stat(targetPath)).mtime.toISOString(),
  };
});

for (const format of [
  { channel: DesktopChannel.ExportReportWord, extension: "docx", title: "Word 计算书", filter: "Word 文档", env: "FRAMEMIND_E2E_REPORT_PATH" },
  { channel: DesktopChannel.ExportReportData, extension: "zip", title: "随机响应数据", filter: "ZIP 数据包", env: "FRAMEMIND_E2E_REPORT_DATA_PATH" },
]) ipcMain.handle(format.channel, async (event, request: ExportReportWordRequest): Promise<SaveProjectResult> => {
  requireTrustedSender(event);
  if (!request || typeof request.suggestedName !== "string" || typeof request.base64 !== "string"
    || request.base64.length > 90_000_000 || request.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.base64)) {
    throw new Error(`${format.title}导出内容无效`);
  }
  const bytes = Buffer.from(request.base64, "base64");
  if (bytes.length < 4 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error(`${format.title}格式无效`);
  let targetPath = process.env[format.env];
  if (!targetPath) {
    const name = request.suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120) || "工程计算书";
    const selection = await dialog.showSaveDialog({ title: `导出 ${format.title}`, defaultPath: `${name}.${format.extension}`, filters: [{ name: format.filter, extensions: [format.extension] }] });
    if (selection.canceled || !selection.filePath) return { status: "cancelled" };
    targetPath = selection.filePath;
  }
  if (!targetPath.toLowerCase().endsWith(`.${format.extension}`)) targetPath += `.${format.extension}`;
  await projectFiles.save(targetPath, request.base64, "base64");
  return { status: "saved", path: targetPath };
});

ipcMain.handle(DesktopChannel.ExportReportPdf, async (event, request: ExportReportPdfRequest): Promise<SaveProjectResult> => {
  requireTrustedSender(event);
  if (!request || typeof request.suggestedName !== "string" || typeof request.html !== "string"
    || request.html.length > 90_000_000 || !request.html.startsWith("<!doctype html>")) throw new Error("PDF 计算书导出内容无效");
  let targetPath = process.env.FRAMEMIND_E2E_REPORT_PDF_PATH;
  if (!targetPath) {
    const name = request.suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120) || "工程计算书";
    const selection = await dialog.showSaveDialog({ title: "导出 PDF 计算书", defaultPath: `${name}.pdf`, filters: [{ name: "PDF 文档", extensions: ["pdf"] }] });
    if (selection.canceled || !selection.filePath) return { status: "cancelled" };
    targetPath = selection.filePath;
  }
  if (!targetPath.toLowerCase().endsWith(".pdf")) targetPath += ".pdf";
  const bytes = await renderReportPdf(request.html);
  await projectFiles.save(targetPath, bytes.toString("base64"), "base64");
  return { status: "saved", path: targetPath };
});

app.whenReady().then(() => {
  deepSeek = new DeepSeekConnection(join(app.getPath("userData"), "deepseek.credentials"), {
    isAvailable: () => process.platform === "win32" && safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
