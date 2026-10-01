import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";
import {
  DesktopChannel,
  type OpenProjectResult,
  type SaveProjectRequest,
  type SaveProjectResult,
} from "./contracts";
import { ProjectFileStore } from "./project-files";

const projectFiles = new ProjectFileStore();

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
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
