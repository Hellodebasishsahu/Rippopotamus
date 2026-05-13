import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rippo", {
  health: () => ipcRenderer.invoke("engine:health"),
  probePage: (url: string) => ipcRenderer.invoke("page:probe", url),
  searchSources: (query?: string, pack?: string) => ipcRenderer.invoke("engine:source-search", query, pack),
  listAiModels: (refresh?: boolean) => ipcRenderer.invoke("ai:models", refresh),
  setAiModel: (modelId: string) => ipcRenderer.invoke("ai:set-model", modelId),
  indexStatus: (indexRoot?: string) => ipcRenderer.invoke("engine:index-status", indexRoot),
  indexIngest: (payload: { indexRoot?: string; paths: string[] }) => ipcRenderer.invoke("engine:index-ingest", payload),
  indexSearch: (payload: { indexRoot?: string; query?: string; limit?: number }) => ipcRenderer.invoke("engine:index-search", payload),
  indexUpsert: (payload: { indexRoot?: string; moments: unknown[] }) => ipcRenderer.invoke("engine:index-upsert", payload),
  fetch: (url: string, provider?: string, cookieSource?: unknown) => ipcRenderer.invoke("engine:fetch", url, provider, cookieSource),
  download: (payload: { url: string; preset: string; outputRoot?: string; itemId?: string; title?: string; cookieSource?: unknown }) =>
    ipcRenderer.invoke("engine:download", payload),
  openFolder: (folder: string) => ipcRenderer.invoke("shell:open-folder", folder),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  loadThumbnail: (urls: string[]) => ipcRenderer.invoke("thumbnail:load", urls),
  libraryThumbnail: (payload: { path: string; time?: number }) => ipcRenderer.invoke("library:thumbnail", payload),
  libraryMediaUrl: (payload: { path: string }) => ipcRenderer.invoke("library:media-url", payload),
  listBrowsers: () => ipcRenderer.invoke("cookies:list-browsers"),
  setDefaultCookieSource: (source: unknown) => ipcRenderer.invoke("cookies:set-default-source", source),
  setCookiesBrowser: (browserId: string | null) => ipcRenderer.invoke("cookies:set-browser", browserId),
  checkYtDlpUpdate: () => ipcRenderer.invoke("ytdlp:check-update"),
  updateYtDlp: () => ipcRenderer.invoke("ytdlp:update"),
  checkGalleryDlUpdate: () => ipcRenderer.invoke("gallerydl:check-update"),
  updateGalleryDl: () => ipcRenderer.invoke("gallerydl:update"),
  chooseOutputRoot: () => ipcRenderer.invoke("output:choose"),
  resetOutputRoot: () => ipcRenderer.invoke("output:reset"),
  onDownloadEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("engine:download-event", listener);
    return () => ipcRenderer.removeListener("engine:download-event", listener);
  },
});
