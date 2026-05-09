export {};

declare global {
  interface Window {
    rippo: {
      health: () => Promise<EngineHealth>;
      fetch: (url: string) => Promise<FetchResponse>;
      download: (payload: DownloadRequest) => Promise<DownloadResponse>;
      openFolder: (folder: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      listBrowsers: () => Promise<CookiesBrowserResponse>;
      setCookiesBrowser: (browserId: string | null) => Promise<CookiesBrowserResponse>;
      checkYtDlpUpdate: () => Promise<YtDlpUpdateInfo>;
      updateYtDlp: () => Promise<YtDlpUpdateResult>;
      onDownloadEvent: (callback: (event: DownloadEvent) => void) => () => void;
    };
  }
}

export type EngineHealth = {
  ok: boolean;
  python?: string;
  ytDlp?: string;
  ytDlpPath?: string | null;
  ffmpeg?: string | null;
  ffmpegOk?: boolean;
  ffmpegVersion?: string | null;
  cookiesBrowser?: string | null;
  cookiesSupported?: boolean;
  cookiesBrowsers?: BrowserInfo[];
  cookies?: CookiesHealth;
  outputRoot: string;
  packaged: boolean;
  error?: string;
};

export type BrowserInfo = { id: string; label: string; appPath: string };

export type CookiesHealth = {
  status: "off" | "ok" | "error";
  browser: string | null;
  ok: boolean | null;
  message: string | null;
};

export type CookiesBrowserResponse = {
  browsers: BrowserInfo[];
  selected: string | null;
  supported: boolean;
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

export type FetchResponse = {
  ok: boolean;
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
    description?: string;
  };
};

export type DownloadRequest = {
  url: string;
  preset: string;
  outputRoot?: string;
  itemId?: string;
  title?: string;
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
