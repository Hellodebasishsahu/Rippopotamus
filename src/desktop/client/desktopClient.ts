import type {
  CookieSource,
  DownloadEvent,
  DownloadRequest,
  DownloadResponse,
  EngineHealth,
  GalleryDlUpdateInfo,
  GalleryDlUpdateResult,
  IndexIngestRequest,
  IndexIngestResponse,
  IndexIngestSettings,
  IndexIngestSettingsResponse,
  IndexSearchRequest,
  IndexSearchResponse,
  IndexSemanticIngestRequest,
  IndexSemanticIngestResponse,
  OpenRouterModelCatalog,
  SourceSearchResponse,
  ThumbnailLoadResult,
  YtDlpUpdateInfo,
  YtDlpUpdateResult,
} from "../../../electron/types";

type RippoBridge = Window["rippo"];

export type DesktopClient = {
  health: () => Promise<EngineHealth>;
  searchSources: (query?: string, pack?: string) => Promise<SourceSearchResponse>;
  listAiModels: (refresh?: boolean) => Promise<OpenRouterModelCatalog>;
  setAiModel: (modelId: string) => Promise<{ model: string; health: EngineHealth; catalog: OpenRouterModelCatalog }>;
  indexStatus: RippoBridge["indexStatus"];
  indexIngest: (payload: IndexIngestRequest) => Promise<IndexIngestResponse>;
  indexSemanticIngest: (payload: IndexSemanticIngestRequest) => Promise<IndexSemanticIngestResponse>;
  getIndexIngestSettings: () => Promise<IndexIngestSettingsResponse>;
  setIndexIngestSettings: (payload: Partial<IndexIngestSettings>) => Promise<IndexIngestSettingsResponse>;
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
  chooseOutputRoot: RippoBridge["chooseOutputRoot"];
  resetOutputRoot: RippoBridge["resetOutputRoot"];
  onDownloadEvent: (callback: (event: DownloadEvent) => void) => () => void;
};

export function createDesktopClient(bridge?: RippoBridge): DesktopClient | null {
  if (!bridge) return null;
  return {
    health: bridge.health,
    searchSources: bridge.searchSources,
    listAiModels: bridge.listAiModels,
    setAiModel: bridge.setAiModel,
    indexStatus: bridge.indexStatus,
    indexIngest: bridge.indexIngest,
    indexSemanticIngest: bridge.indexSemanticIngest,
    getIndexIngestSettings: bridge.getIndexIngestSettings,
    setIndexIngestSettings: bridge.setIndexIngestSettings,
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
    chooseOutputRoot: bridge.chooseOutputRoot,
    resetOutputRoot: bridge.resetOutputRoot,
    onDownloadEvent: bridge.onDownloadEvent,
  };
}

export function getDesktopClient(): DesktopClient | null {
  if (typeof window === "undefined") return null;
  return createDesktopClient(window.rippo);
}
