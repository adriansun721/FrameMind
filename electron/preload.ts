import { contextBridge, ipcRenderer } from "electron";
import { DesktopChannel, type FrameMindDesktopApi } from "./contracts";

const desktopApi: FrameMindDesktopApi = {
  runNativeAnalysis: (request) => ipcRenderer.invoke(DesktopChannel.RunNativeAnalysis, request),
  cancelNativeAnalysis: (requestId) => ipcRenderer.invoke(DesktopChannel.CancelNativeAnalysis, requestId),
  onNativeAnalysisPhase: (requestId, listener) => {
    const receive = (_event: Electron.IpcRendererEvent, message: { requestId?: string }) => {
      if (message?.requestId === requestId) listener(message);
    };
    ipcRenderer.on(DesktopChannel.NativeAnalysisPhase, receive);
    return () => ipcRenderer.removeListener(DesktopChannel.NativeAnalysisPhase, receive);
  },
  saveRecovery: (request) => ipcRenderer.invoke(DesktopChannel.SaveRecovery, request),
  listRecovery: () => ipcRenderer.invoke(DesktopChannel.ListRecovery),
  readRecovery: (id) => ipcRenderer.invoke(DesktopChannel.ReadRecovery, id),
  exportReportPdf: (request) => ipcRenderer.invoke(DesktopChannel.ExportReportPdf, request),
  exportReportWord: (request) => ipcRenderer.invoke(DesktopChannel.ExportReportWord, request),
  exportReportData: (request) => ipcRenderer.invoke(DesktopChannel.ExportReportData, request),
  setTheme: (theme) => ipcRenderer.invoke(DesktopChannel.SetTheme, theme),
  saveProject: (request: { path: string | null; content: string }) =>
    ipcRenderer.invoke(DesktopChannel.SaveProject, request),
  openProject: () => ipcRenderer.invoke(DesktopChannel.OpenProject),
  saveChatHistory: (request) => ipcRenderer.invoke(DesktopChannel.SaveChatHistory, request),
  loadChatHistory: (projectId) => ipcRenderer.invoke(DesktopChannel.LoadChatHistory, projectId),
  getDeepSeekSettings: () => ipcRenderer.invoke(DesktopChannel.GetDeepSeekSettings),
  saveDeepSeekSettings: (request) => ipcRenderer.invoke(DesktopChannel.SaveDeepSeekSettings, request),
  removeDeepSeekCredential: () => ipcRenderer.invoke(DesktopChannel.RemoveDeepSeekCredential),
  testDeepSeekConnection: () => ipcRenderer.invoke(DesktopChannel.TestDeepSeekConnection),
  chatDeepSeek: (request) => ipcRenderer.invoke(DesktopChannel.ChatDeepSeek, request),
  cancelDeepSeekChat: (requestId) => ipcRenderer.invoke(DesktopChannel.CancelDeepSeekChat, requestId),
  importStep: (request) => ipcRenderer.invoke(DesktopChannel.ImportStep, request),
  cancelCadImport: (requestId) => ipcRenderer.invoke(DesktopChannel.CancelCadImport, requestId),
  exportCadPreview: (request) => ipcRenderer.invoke(DesktopChannel.ExportCadPreview, request),
  recordProjectCheckpoints: (request) => ipcRenderer.invoke(DesktopChannel.RecordProjectCheckpoints, request),
  listProjectCheckpoints: (projectId) => ipcRenderer.invoke(DesktopChannel.ListProjectCheckpoints, projectId),
  readProjectCheckpoint: (request) => ipcRenderer.invoke(DesktopChannel.ReadProjectCheckpoint, request),
  verifyCadImportSource: (request) => ipcRenderer.invoke(DesktopChannel.VerifyCadImportSource, request),
};

contextBridge.exposeInMainWorld("frameMind", desktopApi);
