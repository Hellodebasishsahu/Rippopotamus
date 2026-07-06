import type {
  CookieSource,
  DownloadCancelResponse,
  DownloadEvent,
  DownloadRequest,
  DownloadResponse,
  EngineHealth,
  AppUpdateInfo,
  HelperCheckResult,
  HelperUpdateResult,
  LibraryListRequest,
  LibraryListResponse,
  LibraryThumbnailResult,
  ThumbnailLoadResult,
} from "../../electron/types";

type RippoBridge = Window["rippo"];

export type DesktopClient = {
  health: () => Promise<EngineHealth>;
  probePage: RippoBridge["probePage"];
  clearSniffCache: RippoBridge["clearSniffCache"];
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
  checkHelpers: () => Promise<HelperCheckResult[]>;
  updateHelpers: () => Promise<HelperUpdateResult[]>;
  checkAppUpdate: () => Promise<AppUpdateInfo>;
  chooseOutputRoot: RippoBridge["chooseOutputRoot"];
  resetOutputRoot: RippoBridge["resetOutputRoot"];
  listLibrary: (payload?: LibraryListRequest) => Promise<LibraryListResponse>;
  loadLibraryThumbnail: (target: string) => Promise<LibraryThumbnailResult>;
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
    checkHelpers: bridge.checkHelpers,
    updateHelpers: bridge.updateHelpers,
    checkAppUpdate: bridge.checkAppUpdate,
    chooseOutputRoot: bridge.chooseOutputRoot,
    resetOutputRoot: bridge.resetOutputRoot,
    listLibrary: bridge.listLibrary,
    loadLibraryThumbnail: bridge.loadLibraryThumbnail,
    openPath: bridge.openPath,
    showItemInFolder: bridge.showItemInFolder,
    onDownloadEvent: bridge.onDownloadEvent,
  };
}

export function getDesktopClient(): DesktopClient | null {
  if (typeof window === "undefined") return null;
  return createDesktopClient(window.rippo);
}
