import { contextBridge, ipcRenderer } from "electron";
import { DesktopChannel, type FrameMindDesktopApi } from "./contracts";

const desktopApi: FrameMindDesktopApi = {
  exportReportWord: (request) => ipcRenderer.invoke(DesktopChannel.ExportReportWord, request),
  setTheme: (theme) => ipcRenderer.invoke(DesktopChannel.SetTheme, theme),
  saveProject: (request: { path: string | null; content: string }) =>
    ipcRenderer.invoke(DesktopChannel.SaveProject, request),
  openProject: () => ipcRenderer.invoke(DesktopChannel.OpenProject),
  getDeepSeekSettings: () => ipcRenderer.invoke(DesktopChannel.GetDeepSeekSettings),
  saveDeepSeekSettings: (request) => ipcRenderer.invoke(DesktopChannel.SaveDeepSeekSettings, request),
  removeDeepSeekCredential: () => ipcRenderer.invoke(DesktopChannel.RemoveDeepSeekCredential),
  testDeepSeekConnection: () => ipcRenderer.invoke(DesktopChannel.TestDeepSeekConnection),
  chatDeepSeek: (request) => ipcRenderer.invoke(DesktopChannel.ChatDeepSeek, request),
  cancelDeepSeekChat: (requestId) => ipcRenderer.invoke(DesktopChannel.CancelDeepSeekChat, requestId),
};

contextBridge.exposeInMainWorld("frameMind", desktopApi);
