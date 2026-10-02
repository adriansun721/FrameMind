import { contextBridge, ipcRenderer } from "electron";
import { DesktopChannel, type FrameMindDesktopApi } from "./contracts";

const desktopApi: FrameMindDesktopApi = {
  setTheme: (theme) => ipcRenderer.invoke(DesktopChannel.SetTheme, theme),
  saveProject: (request: { path: string | null; content: string }) =>
    ipcRenderer.invoke(DesktopChannel.SaveProject, request),
  openProject: () => ipcRenderer.invoke(DesktopChannel.OpenProject),
  getDeepSeekSettings: () => ipcRenderer.invoke(DesktopChannel.GetDeepSeekSettings),
  saveDeepSeekSettings: (request) => ipcRenderer.invoke(DesktopChannel.SaveDeepSeekSettings, request),
  removeDeepSeekCredential: () => ipcRenderer.invoke(DesktopChannel.RemoveDeepSeekCredential),
  testDeepSeekConnection: () => ipcRenderer.invoke(DesktopChannel.TestDeepSeekConnection),
};

contextBridge.exposeInMainWorld("frameMind", desktopApi);
