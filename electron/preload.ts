import { contextBridge, ipcRenderer } from "electron";
import { DesktopChannel, type FrameMindDesktopApi } from "./contracts";

const desktopApi: FrameMindDesktopApi = {
  saveProject: (request: { path: string | null; content: string }) =>
    ipcRenderer.invoke(DesktopChannel.SaveProject, request),
  openProject: () => ipcRenderer.invoke(DesktopChannel.OpenProject),
};

contextBridge.exposeInMainWorld("frameMind", desktopApi);
