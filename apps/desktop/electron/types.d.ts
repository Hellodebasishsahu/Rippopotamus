export {};

declare global {
  interface Window {
    rippo: {
      health: () => Promise<EngineHealth>;
      probePage: (url: string, options?: PageProbeOptions) => Promise<PageProbeResponse>;
      clearSniffCache: () => Promise<{ ok: boolean }>;
      setNetworkProxy: (proxy: string) => Promise<{ networkProxy: string; health: EngineHealth }>;
      checkNetworkProxy: (proxy: string) => Promise<NetworkProxyCheckResponse>;
      setTransferSettings: (payload: Partial<TransferSettings>) => Promise<{ transfer: TransferSettings; health: EngineHealth }>;
      fetch: (url: string, provider?: ProviderId | "auto", cookieSource?: CookieSource) => Promise<FetchResponse>;
      fetchFull: (url: string, provider?: ProviderId | "auto", cookieSource?: CookieSource) => Promise<FetchResponse>;
      download: (payload: DownloadRequest) => Promise<DownloadResponse>;
      cancelDownload: (jobId: string) => Promise<DownloadCancelResponse>;
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
      checkAppUpdate: () => Promise<AppUpdateInfo>;
      chooseOutputRoot: () => Promise<{ outputRoot: string; canceled: boolean }>;
      resetOutputRoot: () => Promise<{ outputRoot: string }>;
      listLibrary: (payload?: LibraryListRequest) => Promise<LibraryListResponse>;
      loadLibraryThumbnail: (path: string) => Promise<LibraryThumbnailResult>;
      openPath: (target: string) => Promise<void>;
      showItemInFolder: (target: string) => Promise<void>;
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
  aria2c?: string | null;
  aria2cPath?: string | null;
  aria2cOk?: boolean;
  aria2cError?: string | null;
  torrentEngine?: "aria2c" | null;
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
  networkProxy?: string;
  networkProxyEnabled?: boolean;
  transfer?: TransferSettings;
  aria2MaxConnections?: number;
  aria2DownloadLimit?: string;
  packaged: boolean;
  error?: string;
};

export type TransferSettings = {
  aria2MaxConnections: number;
  aria2DownloadLimit: string;
};

export type AppUpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  configured: boolean;
  manifestUrl: string | null;
  dmgUrl: string | null;
  date?: string;
  notes: string[];
  error?: string;
};

export type BrowserInfo = { id: string; label: string; appPath: string };

export type NetworkProxyCheckResponse = {
  ok: boolean;
  proxy: string;
  ip?: string | null;
  error?: string;
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
  source: "network" | "dom" | "meta";
  method: string;
  score: number;
  contentType?: string;
  resolution?: string;
};

export type PageProbeOptions = {
  incognito?: boolean;
};

export type PageProbeLink = {
  url: string;
  text?: string;
};

export type PageProbeResponse = {
  ok: true;
  url: string;
  finalUrl: string;
  candidates: PageProbeCandidate[];
  pageLinks?: PageProbeLink[];
  crawledLinks?: number;
  timedOut: boolean;
  fastSettled?: boolean;
  elapsedMs?: number;
  cached?: boolean;
  cachedAt?: number;
} | {
  ok: false;
  url: string;
  error: string;
  candidates: PageProbeCandidate[];
  pageLinks?: PageProbeLink[];
  crawledLinks?: number;
  timedOut?: boolean;
  fastSettled?: boolean;
  elapsedMs?: number;
  cached?: boolean;
  cachedAt?: number;
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
    filesize?: number | null;
    filesize_approx?: number | null;
    provisional?: boolean;
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

export type DownloadCancelResponse = {
  ok: boolean;
  jobId: string;
  error?: string;
};

export type DownloadEvent = {
  jobId: string;
  type: "started" | "progress" | "stage" | "phase" | "success" | "error" | "notice" | "canceled";
  level?: "warning" | "error";
  warnings?: string[];
  percent?: number;
  eta?: string | null;
  speed?: string | null;
  message?: string;
  finalizing?: boolean;
  kind?: string;
  destination?: string;
  files?: Array<string | { path: string; size?: number | null }>;
  outputRoot?: string;
  error?: string;
};

export type LibraryFile = {
  path: string;
  size?: number | null;
};

export type LibraryItemKind = "video" | "audio" | "image" | "document" | "file";

export type LibraryItem = {
  id: string;
  url: string;
  preset: string;
  title: string;
  kind: LibraryItemKind;
  files: LibraryFile[];
  fileCount: number;
  totalSize?: number | null;
  savedAt?: number | null;
  primaryPath: string;
};

export type LibraryListRequest = {
  outputRoot?: string;
};

export type LibraryListResponse = {
  ok: boolean;
  outputRoot: string;
  items: LibraryItem[];
  total: number;
  /** Entries dropped because their files no longer exist on disk. */
  missing?: number;
  /** Entries dropped because the ledger record was malformed or unsafe. */
  skipped?: number;
  error?: string;
};

export type LibraryThumbnailResult = {
  ok: boolean;
  /** A data: URL (image/png or image/jpeg) ready to drop into an <img src>. */
  dataUrl?: string;
  error?: string;
};
