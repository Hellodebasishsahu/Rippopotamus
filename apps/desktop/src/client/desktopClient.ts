import type {
  CookieSource,
  DownloadCancelResponse,
  DownloadEvent,
  DownloadRequest,
  DownloadResponse,
  EngineHealth,
  AppUpdateInfo,
  GalleryDlUpdateInfo,
  GalleryDlUpdateResult,
  LibraryListRequest,
  LibraryListResponse,
  ThumbnailLoadResult,
  YtDlpUpdateInfo,
  YtDlpUpdateResult,
} from "../../electron/types";

type RippoBridge = Window["rippo"];

export type DesktopClient = {
  health: () => Promise<EngineHealth>;
  probePage: RippoBridge["probePage"];
  clearSniffCache: RippoBridge["clearSniffCache"];
  setNetworkProxy: RippoBridge["setNetworkProxy"];
  checkNetworkProxy: RippoBridge["checkNetworkProxy"];
  setTransferSettings: RippoBridge["setTransferSettings"];
  fetch: RippoBridge["fetch"];
  fetchFull: RippoBridge["fetchFull"];
  download: (payload: DownloadRequest) => Promise<DownloadResponse>;
  cancelDownload: (jobId: string) => Promise<DownloadCancelResponse>;
  openFolder: (folder: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  loadThumbnail: (urls: string[]) => Promise<ThumbnailLoadResult>;
  listBrowsers: RippoBridge["listBrowsers"];
  setDefaultCookieSource: (source: CookieSource) => ReturnType<RippoBridge["setDefaultCookieSource"]>;
  setCookiesBrowser: RippoBridge["setCookiesBrowser"];
  checkYtDlpUpdate: () => Promise<YtDlpUpdateInfo>;
  updateYtDlp: () => Promise<YtDlpUpdateResult>;
  checkGalleryDlUpdate: () => Promise<GalleryDlUpdateInfo>;
  updateGalleryDl: () => Promise<GalleryDlUpdateResult>;
  checkAppUpdate: () => Promise<AppUpdateInfo>;
  chooseOutputRoot: RippoBridge["chooseOutputRoot"];
  resetOutputRoot: RippoBridge["resetOutputRoot"];
  listLibrary: (payload?: LibraryListRequest) => Promise<LibraryListResponse>;
  openPath: (target: string) => Promise<void>;
  showItemInFolder: (target: string) => Promise<void>;
  onDownloadEvent: (callback: (event: DownloadEvent) => void) => () => void;
};

export function createDesktopClient(bridge?: RippoBridge): DesktopClient | null {
  if (!bridge) return null;
  return {
    health: bridge.health,
    probePage: bridge.probePage,
    clearSniffCache: bridge.clearSniffCache,
    setNetworkProxy: bridge.setNetworkProxy,
    checkNetworkProxy: bridge.checkNetworkProxy,
    setTransferSettings: bridge.setTransferSettings,
    fetch: bridge.fetch,
    fetchFull: bridge.fetchFull,
    download: bridge.download,
    cancelDownload: bridge.cancelDownload,
    openFolder: bridge.openFolder,
    openExternal: bridge.openExternal,
    loadThumbnail: bridge.loadThumbnail,
    listBrowsers: bridge.listBrowsers,
    setDefaultCookieSource: bridge.setDefaultCookieSource,
    setCookiesBrowser: bridge.setCookiesBrowser,
    checkYtDlpUpdate: bridge.checkYtDlpUpdate,
    updateYtDlp: bridge.updateYtDlp,
    checkGalleryDlUpdate: bridge.checkGalleryDlUpdate,
    updateGalleryDl: bridge.updateGalleryDl,
    checkAppUpdate: bridge.checkAppUpdate,
    chooseOutputRoot: bridge.chooseOutputRoot,
    resetOutputRoot: bridge.resetOutputRoot,
    listLibrary: bridge.listLibrary,
    openPath: bridge.openPath,
    showItemInFolder: bridge.showItemInFolder,
    onDownloadEvent: bridge.onDownloadEvent,
  };
}

export function getDesktopClient(): DesktopClient | null {
  if (typeof window === "undefined") return null;
  return createDesktopClient(window.rippo);
}
