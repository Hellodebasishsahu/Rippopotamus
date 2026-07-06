import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rippo", {
  health: () => ipcRenderer.invoke("engine:health"),
  probePage: (url: string, options?: { incognito?: boolean }) => ipcRenderer.invoke("page:probe", url, options),
  clearSniffCache: () => ipcRenderer.invoke("page:clear-probe-cache"),
  setTransferSettings: (payload: { aria2MaxConnections?: number; aria2DownloadLimit?: string }) => ipcRenderer.invoke("transfer:set-settings", payload),
  fetch: (url: string, provider?: string, cookieSource?: unknown) => ipcRenderer.invoke("engine:fetch", url, provider, cookieSource),
  fetchFull: (url: string, provider?: string, cookieSource?: unknown) => ipcRenderer.invoke("engine:fetch-full", url, provider, cookieSource),
  download: (payload: { url: string; preset: string; outputRoot?: string; itemId?: string; title?: string; cookieSource?: unknown }) =>
    ipcRenderer.invoke("engine:download", payload),
  cancelDownload: (jobId: string) => ipcRenderer.invoke("engine:download-cancel", jobId),
  openFolder: (folder: string) => ipcRenderer.invoke("shell:open-folder", folder),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  loadThumbnail: (urls: string[]) => ipcRenderer.invoke("thumbnail:load", urls),
  openLogs: () => ipcRenderer.invoke("logs:open"),
  logsPath: () => ipcRenderer.invoke("logs:path"),
  listBrowsers: () => ipcRenderer.invoke("cookies:list-browsers"),
  setDefaultCookieSource: (source: unknown) => ipcRenderer.invoke("cookies:set-default-source", source),
  setCookiesBrowser: (browserId: string | null) => ipcRenderer.invoke("cookies:set-browser", browserId),
  checkHelpers: () => ipcRenderer.invoke("helpers:check-all"),
  updateHelpers: () => ipcRenderer.invoke("helpers:update-all"),
  checkAppUpdate: () => ipcRenderer.invoke("app-update:check"),
  chooseOutputRoot: () => ipcRenderer.invoke("output:choose"),
  resetOutputRoot: () => ipcRenderer.invoke("output:reset"),
  listLibrary: (payload?: { outputRoot?: string }) => ipcRenderer.invoke("library:list", payload),
  loadLibraryThumbnail: (target: string) => ipcRenderer.invoke("library:thumbnail", target),
  openPath: (target: string) => ipcRenderer.invoke("shell:open-path", target),
  showItemInFolder: (target: string) => ipcRenderer.invoke("shell:show-item", target),
  onDownloadEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("engine:download-event", listener);
    return () => ipcRenderer.removeListener("engine:download-event", listener);
  },
});
