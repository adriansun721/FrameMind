import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("frameMind", {
  saveProject: (request: { path: string | null; content: string }) =>
    ipcRenderer.invoke("project:save", request),
  openProject: () => ipcRenderer.invoke("project:open"),
});
