import { app, BrowserWindow, dialog, ipcMain, safeStorage, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DesktopChannel,
  type OpenProjectResult,
  type SaveProjectRequest,
  type SaveProjectResult,
} from "./contracts";
import { ProjectFileStore } from "./project-files";
import { DeepSeekConnection } from "./deepseek";

const projectFiles = new ProjectFileStore();
if (process.env.FRAMEMIND_E2E_USER_DATA_PATH) app.setPath("userData", process.env.FRAMEMIND_E2E_USER_DATA_PATH);

let deepSeek: DeepSeekConnection;
const productionUrl = pathToFileURL(join(__dirname, "../dist/index.html")).href;
const trustedUrl = process.env.VITE_DEV_SERVER_URL ?? productionUrl;
function requireTrustedSender(event: IpcMainInvokeEvent): void {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame
    || event.senderFrame.url !== trustedUrl && event.senderFrame.url !== `${trustedUrl}/`) {
    throw new Error("不允许访问本机连接设置");
  }
}
ipcMain.handle(DesktopChannel.GetDeepSeekSettings, (event) => {
  requireTrustedSender(event); return deepSeek.getSettings();
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
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== trustedUrl && url !== `${trustedUrl}/`) event.preventDefault();
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle(DesktopChannel.SaveProject, async (_event, request: SaveProjectRequest): Promise<SaveProjectResult> => {
  const automatedPath = process.env.FRAMEMIND_E2E_PROJECT_PATH;
  let targetPath = request.path ?? automatedPath ?? null;

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

  await projectFiles.save(targetPath, request.content);
  return { status: "saved" as const, path: targetPath };
});

ipcMain.handle(DesktopChannel.OpenProject, async (): Promise<OpenProjectResult> => {
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
    content: await projectFiles.open(targetPath),
  };
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
