export {};

declare global {
  interface Window {
    rippo: {
      health: () => Promise<EngineHealth>;
      fetch: (url: string) => Promise<FetchResponse>;
      download: (payload: DownloadRequest) => Promise<DownloadResponse>;
      openFolder: (folder: string) => Promise<void>;
      onDownloadEvent: (callback: (event: DownloadEvent) => void) => () => void;
    };
  }
}

export type EngineHealth = {
  ok: boolean;
  python?: string;
  ytDlp?: string;
  ffmpeg?: string | null;
  ffmpegOk?: boolean;
  ffmpegVersion?: string | null;
  outputRoot: string;
  packaged: boolean;
  error?: string;
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
  type: "started" | "progress" | "stage" | "success" | "error";
  percent?: number;
  eta?: string | null;
  speed?: string | null;
  message?: string;
  files?: string[];
  outputRoot?: string;
  error?: string;
};
