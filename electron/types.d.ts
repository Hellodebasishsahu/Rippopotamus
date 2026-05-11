export {};

declare global {
  interface Window {
    rippo: {
      health: () => Promise<EngineHealth>;
      probePage: (url: string) => Promise<PageProbeResponse>;
      searchSources: (query?: string, pack?: string) => Promise<SourceSearchResponse>;
      listAiModels: (refresh?: boolean) => Promise<OpenRouterModelCatalog>;
      setAiModel: (modelId: string) => Promise<{ model: string; health: EngineHealth; catalog: OpenRouterModelCatalog }>;
      fetch: (url: string, provider?: ProviderId | "auto", cookieSource?: CookieSource) => Promise<FetchResponse>;
      download: (payload: DownloadRequest) => Promise<DownloadResponse>;
      openFolder: (folder: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      loadThumbnail: (urls: string[]) => Promise<ThumbnailLoadResult>;
      listBrowsers: () => Promise<CookiesBrowserResponse>;
      setDefaultCookieSource: (source: CookieSource) => Promise<CookiesBrowserResponse>;
      setCookiesBrowser: (browserId: string | null) => Promise<CookiesBrowserResponse>;
      checkYtDlpUpdate: () => Promise<YtDlpUpdateInfo>;
      updateYtDlp: () => Promise<YtDlpUpdateResult>;
      checkGalleryDlUpdate: () => Promise<GalleryDlUpdateInfo>;
      updateGalleryDl: () => Promise<GalleryDlUpdateResult>;
      chooseOutputRoot: () => Promise<{ outputRoot: string; canceled: boolean }>;
      resetOutputRoot: () => Promise<{ outputRoot: string }>;
      onDownloadEvent: (callback: (event: DownloadEvent) => void) => () => void;
    };
  }
}

export type EngineHealth = {
  ok: boolean;
  python?: string;
  ytDlp?: string;
  ytDlpPath?: string | null;
  galleryDl?: string | null;
  galleryDlPath?: string | null;
  galleryDlOk?: boolean;
  galleryDlError?: string | null;
  qBittorrent?: string | null;
  qBittorrentPath?: string | null;
  qBittorrentOk?: boolean;
  qBittorrentError?: string | null;
  aria2c?: string | null;
  aria2cPath?: string | null;
  aria2cOk?: boolean;
  aria2cError?: string | null;
  torrentEngine?: "qbittorrent" | "aria2c" | null;
  torrentOk?: boolean;
  torrentError?: string | null;
  ffmpeg?: string | null;
  ffmpegOk?: boolean;
  ffmpegVersion?: string | null;
  cookiesBrowser?: string | null;
  cookiesSupported?: boolean;
  cookiesBrowsers?: BrowserInfo[];
  cookieSource?: CookieSource;
  cookies?: CookiesHealth;
  providers?: ProviderOption[];
  presets?: PresetOption[];
  outputRoot: string;
  openRouterModel?: string;
  openRouterKeyPresent?: boolean;
  searchEvidence?: SearchEvidenceStatus;
  packaged: boolean;
  error?: string;
};

export type OpenRouterModel = {
  id: string;
  name: string;
  contextLength?: number | null;
  inputModalities?: string[];
  outputModalities?: string[];
};

export type OpenRouterModelCatalog = {
  ok: boolean;
  apiKeyPresent: boolean;
  selectedModel: string;
  defaultModel: string;
  models: OpenRouterModel[];
  cached: boolean;
  cachePath?: string;
  fetchedAt?: number | null;
  error?: string | null;
};

export type BrowserInfo = { id: string; label: string; appPath: string };

export type SearchEvidenceResult = {
  title: string;
  url: string;
  displayUrl?: string;
  snippet?: string;
  position?: number;
};

export type SearchEvidenceStatus = {
  configured?: boolean;
  available?: boolean;
  enabled?: boolean;
  provider: string;
  providers?: string[];
  source?: string;
  label?: string;
  query?: string;
  requestedPack?: string;
  resultCount?: number;
  results?: SearchEvidenceResult[];
  reason?: string;
  error?: string;
  fallbackErrors?: Array<{ provider: string; error: string }>;
};

export type CookieSource = {
  mode: "off";
} | {
  mode: "browser";
  browserId: string;
};

export type ProviderId = string;

export type ProviderOption = {
  id: ProviderId;
  label: string;
  defaultPreset: string;
};

export type PresetOption = {
  id: string;
  label: string;
  detail: string;
  provider: ProviderId;
};

export type ThumbnailLoadResult = {
  src: string | null;
  url: string | null;
};

export type CookiesHealth = {
  status: "off" | "ok" | "error";
  browser: string | null;
  ok: boolean | null;
  message: string | null;
};

export type CookiesBrowserResponse = {
  browsers: BrowserInfo[];
  selected: string | null;
  source: CookieSource;
  supported: boolean;
};

export type PageProbeCandidateKind = "video" | "audio" | "image" | "pdf" | "playlist" | "torrent" | "document" | "other";

export type PageProbeCandidate = {
  url: string;
  kind: PageProbeCandidateKind;
  type: PageProbeCandidateKind;
  label: string;
  source: "network" | "dom";
  method: string;
  score: number;
  contentType?: string;
};

export type PageProbeResponse = {
  ok: true;
  url: string;
  finalUrl: string;
  candidates: PageProbeCandidate[];
  timedOut: boolean;
} | {
  ok: false;
  url: string;
  error: string;
  candidates: PageProbeCandidate[];
  timedOut?: boolean;
};

export type SourceSearchPack = {
  id: string;
  label: string;
  description?: string;
  count?: number;
};

export type SourceSearchResult = {
  id: string;
  pack: string;
  packLabel: string;
  title: string;
  description: string;
  url: string;
  openUrl: string;
  mediaTypes: string[];
  usage: string;
  actionLabel: string;
  score: number;
  resultKind?: "item" | "source";
  sourceName?: string;
  thumbnailUrl?: string;
};

export type SourceSearchIntelligence = {
  enabled: boolean;
  source: string;
  requestedPack: string;
  pack: string;
  packLabel: string;
  confidence: number;
  reason: string;
  searchTerms: string[];
  ui: string;
  query: string;
  webEvidence?: SearchEvidenceStatus;
  error?: string;
};

export type SourceSearchResponse = {
  ok: boolean;
  query: string;
  pack: string;
  requestedPack?: string;
  packs: SourceSearchPack[];
  results: SourceSearchResult[];
  actualResultCount?: number;
  routeResultCount?: number;
  searchedSources?: string[];
  intelligence?: SourceSearchIntelligence;
  error?: string;
};

export type YtDlpUpdateInfo = {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  binaryPath: string;
  managedBinaryExists: boolean;
  downloadUrl?: string;
  error?: string;
};

export type YtDlpUpdateResult = YtDlpUpdateInfo & {
  health: EngineHealth;
};

export type GalleryDlUpdateInfo = YtDlpUpdateInfo;

export type GalleryDlUpdateResult = GalleryDlUpdateInfo & {
  health: EngineHealth;
};

export type FetchResponse = {
  ok: true;
  url: string;
  metadata: {
    id?: string;
    title?: string;
    extractor?: string;
    webpage_url?: string;
    duration?: number;
    uploader?: string;
    upload_date?: string;
    thumbnail?: string;
    thumbnails?: string[];
    description?: string;
    provider?: ProviderId;
  };
} | {
  ok: false;
  url: string;
  error: string;
};

export type DownloadRequest = {
  url: string;
  preset: string;
  outputRoot?: string;
  itemId?: string;
  title?: string;
  cookieSource?: CookieSource;
};

export type DownloadResponse = {
  jobId: string;
  result: unknown;
};

export type DownloadEvent = {
  jobId: string;
  type: "started" | "progress" | "stage" | "phase" | "success" | "error" | "notice";
  level?: "warning" | "error";
  warnings?: string[];
  percent?: number;
  eta?: string | null;
  speed?: string | null;
  message?: string;
  finalizing?: boolean;
  kind?: string;
  destination?: string;
  files?: string[];
  outputRoot?: string;
  error?: string;
};
