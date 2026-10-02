import { contextBridge, ipcRenderer } from "electron";
import { DesktopChannel, type FrameMindDesktopApi } from "./contracts";

const desktopApi: FrameMindDesktopApi = {
  setTheme: (theme) => ipcRenderer.invoke(DesktopChannel.SetTheme, theme),
  saveProject: (request: { path: string | null; content: string }) =>
    ipcRenderer.invoke(DesktopChannel.SaveProject, request),
  openProject: () => ipcRenderer.invoke(DesktopChannel.OpenProject),
};

contextBridge.exposeInMainWorld("frameMind", desktopApi);
