import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rippo", {
  health: () => ipcRenderer.invoke("engine:health"),
  probePage: (url: string, options?: { incognito?: boolean }) => ipcRenderer.invoke("page:probe", url, options),
  clearSniffCache: () => ipcRenderer.invoke("page:clear-probe-cache"),
  setNetworkProxy: (proxy: string) => ipcRenderer.invoke("network:set-proxy", proxy),
  checkNetworkProxy: (proxy: string) => ipcRenderer.invoke("network:check-proxy", proxy),
  setTransferSettings: (payload: { aria2MaxConnections?: number; aria2DownloadLimit?: string }) => ipcRenderer.invoke("transfer:set-settings", payload),
  fetch: (url: string, provider?: string, cookieSource?: unknown) => ipcRenderer.invoke("engine:fetch", url, provider, cookieSource),
  download: (payload: { url: string; preset: string; outputRoot?: string; itemId?: string; title?: string; cookieSource?: unknown }) =>
    ipcRenderer.invoke("engine:download", payload),
  cancelDownload: (jobId: string) => ipcRenderer.invoke("engine:download-cancel", jobId),
  openFolder: (folder: string) => ipcRenderer.invoke("shell:open-folder", folder),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  loadThumbnail: (urls: string[]) => ipcRenderer.invoke("thumbnail:load", urls),
  listBrowsers: () => ipcRenderer.invoke("cookies:list-browsers"),
  setDefaultCookieSource: (source: unknown) => ipcRenderer.invoke("cookies:set-default-source", source),
  setCookiesBrowser: (browserId: string | null) => ipcRenderer.invoke("cookies:set-browser", browserId),
  checkYtDlpUpdate: () => ipcRenderer.invoke("ytdlp:check-update"),
  updateYtDlp: () => ipcRenderer.invoke("ytdlp:update"),
  checkGalleryDlUpdate: () => ipcRenderer.invoke("gallerydl:check-update"),
  updateGalleryDl: () => ipcRenderer.invoke("gallerydl:update"),
  checkAppUpdate: () => ipcRenderer.invoke("app-update:check"),
  chooseOutputRoot: () => ipcRenderer.invoke("output:choose"),
  resetOutputRoot: () => ipcRenderer.invoke("output:reset"),
  onDownloadEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("engine:download-event", listener);
    return () => ipcRenderer.removeListener("engine:download-event", listener);
  },
  importSheet: (payload: Record<string, unknown>) => ipcRenderer.invoke("engine:sheet-import", payload),
  onSheetImportEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("engine:sheet-import-event", listener);
    return () => ipcRenderer.removeListener("engine:sheet-import-event", listener);
  },
});
