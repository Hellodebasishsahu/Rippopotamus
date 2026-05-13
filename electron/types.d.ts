export {};

declare global {
  interface Window {
    rippo: {
      health: () => Promise<EngineHealth>;
      probePage: (url: string) => Promise<PageProbeResponse>;
      searchSources: (query?: string, pack?: string) => Promise<SourceSearchResponse>;
      listAiModels: (refresh?: boolean) => Promise<OpenRouterModelCatalog>;
      setAiModel: (modelId: string) => Promise<{ model: string; health: EngineHealth; catalog: OpenRouterModelCatalog }>;
      indexStatus: (indexRoot?: string) => Promise<IndexStatusResponse>;
      indexIngest: (payload: IndexIngestRequest) => Promise<IndexIngestResponse>;
      indexSemanticIngest: (payload: IndexSemanticIngestRequest) => Promise<IndexSemanticIngestResponse>;
      getIndexIngestSettings: () => Promise<IndexIngestSettingsResponse>;
      setIndexIngestSettings: (payload: Partial<IndexIngestSettings>) => Promise<IndexIngestSettingsResponse>;
      indexSearch: (payload: IndexSearchRequest) => Promise<IndexSearchResponse>;
      indexUpsert: (payload: IndexUpsertRequest) => Promise<IndexUpsertResponse>;
      fetch: (url: string, provider?: ProviderId | "auto", cookieSource?: CookieSource) => Promise<FetchResponse>;
      download: (payload: DownloadRequest) => Promise<DownloadResponse>;
      openFolder: (folder: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      loadThumbnail: (urls: string[]) => Promise<ThumbnailLoadResult>;
      libraryThumbnail: (payload: { path: string; time?: number }) => Promise<{ ok: boolean; url: string | null }>;
      libraryMediaUrl: (payload: { path: string }) => Promise<{ ok: boolean; url: string | null }>;
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
  supportsBrowserAccess?: boolean;
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
  media?: MediaInfo | null;
  playable?: PlayableLink[];
  error?: string;
};

export type PlayableLink = {
  url: string;
  host: string;
  label: string;
  kind: "video" | "audio" | string;
  size?: string;
  quality?: string;
  extension?: string;
  source_adapter?: string;
};

export type IndexMoment = {
  id?: string;
  path: string;
  assetPath?: string;
  start?: number | null;
  end?: number | null;
  title?: string;
  description?: string;
  caption?: string;
  tags?: string[];
  embedding?: number[];
  vector?: number[];
};

export type IndexStatusResponse = {
  ok: boolean;
  indexRoot: string;
  dbPath?: string;
  assetCount: number;
  momentCount: number;
  embeddedMomentCount: number;
  embeddingEndpointConfigured: boolean;
  geminiEmbeddingConfigured?: boolean;
  geminiEmbeddingModel?: string;
  embeddingDimensions?: number;
  error?: string;
};

export type IndexAsset = {
  id: string;
  path: string;
  kind: "video" | "image" | "audio" | string;
  title: string;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  state: "added" | "updated" | "unchanged" | string;
};

export type IndexSkippedEntry = {
  path: string;
  reason: string;
};

export type IndexIngestRequest = {
  indexRoot?: string;
  paths: string[];
};

export type IndexIngestResponse = IndexStatusResponse & {
  indexed: IndexAsset[];
  added: number;
  updated: number;
  unchanged: number;
  skipped: number;
  skippedEntries: IndexSkippedEntry[];
};

export type IndexSemanticIngestRequest = {
  indexRoot?: string;
  paths: string[];
  provider?: IndexEmbeddingProvider;
  chunkDuration?: number;
  overlap?: number;
  preprocess?: boolean;
  skipStill?: boolean;
  targetResolution?: number;
  targetFps?: number;
};

export type IndexEmbeddingProvider = "gemini";

export type IndexNumberLimit = {
  min: number;
  max: number;
  step: number;
  default: number;
};

export type IndexIngestLimits = {
  provider: IndexEmbeddingProvider;
  label: string;
  model: string;
  videoSeconds: number;
  recommendedDimensions: number[];
  chunkDuration: IndexNumberLimit;
  overlap: IndexNumberLimit;
  targetResolution: IndexNumberLimit;
  targetFps: IndexNumberLimit;
};

export type IndexIngestSettings = {
  provider: IndexEmbeddingProvider;
  chunkDuration: number;
  overlap: number;
  preprocess: boolean;
  skipStill: boolean;
  targetResolution: number;
  targetFps: number;
};

export type IndexIngestSettingsResponse = IndexIngestSettings & {
  limits: IndexIngestLimits;
};

export type IndexSemanticIngestResponse = IndexStatusResponse & {
  semantic: boolean;
  embedded: number;
  videoChunks: number;
  imageCount: number;
  failed: number;
  failedEntries?: IndexSkippedEntry[];
  skipped: number;
  skippedEntries: IndexSkippedEntry[];
  embeddingProvider?: string;
  embeddingModel?: string;
  chunkDuration?: number;
  overlap?: number;
};

export type IndexSearchRequest = {
  indexRoot?: string;
  query?: string;
  limit?: number;
};

export type IndexSearchResult = {
  id: string;
  assetId: string;
  path: string;
  file: string;
  kind: "video" | "image" | "audio" | string;
  title: string;
  start?: number | null;
  end?: number | null;
  description: string;
  tags: string[];
  score: number;
  matchType: "embedding" | "text" | "recent" | string;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
};

export type IndexSearchResponse = IndexStatusResponse & {
  query: string;
  results: IndexSearchResult[];
  resultCount: number;
  queryEmbeddingSource?: string | null;
};

export type IndexUpsertRequest = {
  indexRoot?: string;
  moments: IndexMoment[];
};

export type IndexUpsertResponse = IndexStatusResponse & {
  upserted: number;
  skipped: number;
  skippedEntries: IndexSkippedEntry[];
};

export type MediaInfo = {
  imdbId: string | null;
  type: "movie" | "series" | string | null;
  title: string | null;
  year: string | null;
  releaseInfo?: string | null;
  poster?: string | null;
  background?: string | null;
  synopsis?: string | null;
  runtime?: string | null;
  imdbRating?: string | null;
  genres?: string[] | null;
  cast?: string[] | null;
  source?: string;
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
