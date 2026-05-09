import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rippo", {
  health: () => ipcRenderer.invoke("engine:health"),
  fetch: (url: string) => ipcRenderer.invoke("engine:fetch", url),
  download: (payload: { url: string; preset: string; outputRoot?: string; itemId?: string; title?: string }) =>
    ipcRenderer.invoke("engine:download", payload),
  openFolder: (folder: string) => ipcRenderer.invoke("shell:open-folder", folder),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  loadThumbnail: (urls: string[], pageUrl?: string) => ipcRenderer.invoke("thumbnail:load", urls, pageUrl),
  listBrowsers: () => ipcRenderer.invoke("cookies:list-browsers"),
  setCookiesBrowser: (browserId: string | null) => ipcRenderer.invoke("cookies:set-browser", browserId),
  checkYtDlpUpdate: () => ipcRenderer.invoke("ytdlp:check-update"),
  updateYtDlp: () => ipcRenderer.invoke("ytdlp:update"),
  chooseOutputRoot: () => ipcRenderer.invoke("output:choose"),
  resetOutputRoot: () => ipcRenderer.invoke("output:reset"),
  onDownloadEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("engine:download-event", listener);
    return () => ipcRenderer.removeListener("engine:download-event", listener);
  },
});
