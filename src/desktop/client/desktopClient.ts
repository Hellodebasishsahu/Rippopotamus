import type {
  CookieSource,
  DownloadEvent,
  DownloadRequest,
  DownloadResponse,
  EngineHealth,
  AppUpdateInfo,
  GalleryDlUpdateInfo,
  GalleryDlUpdateResult,
  IndexIngestRequest,
  IndexIngestResponse,
  IndexSearchRequest,
  IndexSearchResponse,
  OpenRouterModelCatalog,
  SheetImportEvent,
  SheetImportRequest,
  SheetImportResponse,
  SourceSearchResponse,
  ThumbnailLoadResult,
  YtDlpUpdateInfo,
  YtDlpUpdateResult,
} from "../../../electron/types";

type RippoBridge = Window["rippo"];

export type DesktopClient = {
  projects: {
    importSheet: (payload: SheetImportRequest) => Promise<SheetImportResponse>;
    onSheetImportEvent: (callback: (event: SheetImportEvent) => void) => () => void;
  };
  health: () => Promise<EngineHealth>;
  probePage: RippoBridge["probePage"];
  clearSniffCache: RippoBridge["clearSniffCache"];
  searchSources: (query?: string, pack?: string) => Promise<SourceSearchResponse>;
  listAiModels: (refresh?: boolean) => Promise<OpenRouterModelCatalog>;
  setAiModel: (modelId: string) => Promise<{ model: string; health: EngineHealth; catalog: OpenRouterModelCatalog }>;
  setNetworkProxy: RippoBridge["setNetworkProxy"];
  checkNetworkProxy: RippoBridge["checkNetworkProxy"];
  indexStatus: RippoBridge["indexStatus"];
  indexIngest: (payload: IndexIngestRequest) => Promise<IndexIngestResponse>;
  indexSearch: (payload: IndexSearchRequest) => Promise<IndexSearchResponse>;
  fetch: RippoBridge["fetch"];
  download: (payload: DownloadRequest) => Promise<DownloadResponse>;
  openFolder: (folder: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  loadThumbnail: (urls: string[]) => Promise<ThumbnailLoadResult>;
  libraryThumbnail: RippoBridge["libraryThumbnail"];
  libraryMediaUrl: RippoBridge["libraryMediaUrl"];
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
  onDownloadEvent: (callback: (event: DownloadEvent) => void) => () => void;
};

export function createDesktopClient(bridge?: RippoBridge): DesktopClient | null {
  if (!bridge) return null;
  return {
    projects: {
      importSheet: (payload: SheetImportRequest) => bridge.importSheet(payload),
      onSheetImportEvent: (callback) => bridge.onSheetImportEvent(callback),
    },
    health: bridge.health,
    probePage: bridge.probePage,
    clearSniffCache: bridge.clearSniffCache,
    searchSources: bridge.searchSources,
    listAiModels: bridge.listAiModels,
    setAiModel: bridge.setAiModel,
    setNetworkProxy: bridge.setNetworkProxy,
    checkNetworkProxy: bridge.checkNetworkProxy,
    indexStatus: bridge.indexStatus,
    indexIngest: bridge.indexIngest,
    indexSearch: bridge.indexSearch,
    fetch: bridge.fetch,
    download: bridge.download,
    openFolder: bridge.openFolder,
    openExternal: bridge.openExternal,
    loadThumbnail: bridge.loadThumbnail,
    libraryThumbnail: bridge.libraryThumbnail,
    libraryMediaUrl: bridge.libraryMediaUrl,
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
    onDownloadEvent: bridge.onDownloadEvent,
  };
}

export function getDesktopClient(): DesktopClient | null {
  if (typeof window === "undefined") return null;
  return createDesktopClient(window.rippo);
}
