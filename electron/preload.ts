import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rippo", {
  health: () => ipcRenderer.invoke("engine:health"),
  fetch: (url: string) => ipcRenderer.invoke("engine:fetch", url),
  download: (payload: { url: string; preset: string; outputRoot?: string; itemId?: string; title?: string }) =>
    ipcRenderer.invoke("engine:download", payload),
  openFolder: (folder: string) => ipcRenderer.invoke("shell:open-folder", folder),
  onDownloadEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("engine:download-event", listener);
    return () => ipcRenderer.removeListener("engine:download-event", listener);
  },
});
