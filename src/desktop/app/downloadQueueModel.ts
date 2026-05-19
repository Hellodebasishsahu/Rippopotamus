import type { CookieSource, FetchResponse } from "../../../electron/types";

export const QUEUE_STATUS = {
  queued: "queued",
  /** Metadata / URL resolution (was "fetching" in older builds). */
  resolving: "resolving",
  ready: "ready",
  downloading: "downloading",
  /** yt-dlp/gallery final mux pass */
  finalizing: "finalizing",
  done: "done",
  failed: "failed",
} as const;

export type QueueStatus = (typeof QUEUE_STATUS)[keyof typeof QUEUE_STATUS];

export type QueueNotice = {
  level: "warning" | "error";
  message: string;
};

export type QueueItem = {
  localId: string;
  url: string;
  status: QueueStatus;
  preset: string;
  metadata?: Extract<FetchResponse, { ok: true }>["metadata"];
  error?: string;
  progress?: number;
  stage?: string;
  phase?: string;
  phaseIndex?: number;
  finalizing?: boolean;
  files?: Array<string | { path: string; size?: number | null }>;
  jobId?: string;
  notices?: QueueNotice[];
  cookieSource: CookieSource;
};

export const queueStatusLabels: Record<QueueStatus, string> = {
  [QUEUE_STATUS.queued]: "Queued",
  [QUEUE_STATUS.resolving]: "Resolving...",
  [QUEUE_STATUS.ready]: "Ready",
  [QUEUE_STATUS.downloading]: "Downloading",
  [QUEUE_STATUS.finalizing]: "Finalizing...",
  [QUEUE_STATUS.done]: "Saved",
  [QUEUE_STATUS.failed]: "Failed",
};

export function queueItemProgress(item: QueueItem): number | null {
  if (item.status !== QUEUE_STATUS.downloading) return null;
  return Math.max(2, Math.round(item.progress || 0));
}

export function queueItemStatusText(item: QueueItem): string {
  if (item.status !== QUEUE_STATUS.downloading) return queueStatusLabels[item.status];

  const progress = queueItemProgress(item);
  if (item.finalizing) return item.stage || "Finalizing...";
  if (item.phase) return `${item.phase} · ${progress}%`;
  return `${progress}%`;
}

export function queueItemCanChangeOutput(item: QueueItem): boolean {
  return item.status !== QUEUE_STATUS.downloading && item.status !== QUEUE_STATUS.done;
}

export function queueItemCanRefetch(item: QueueItem): boolean {
  return item.status !== QUEUE_STATUS.resolving && item.status !== QUEUE_STATUS.downloading;
}

export function queueItemCanRemove(item: QueueItem): boolean {
  return item.status !== QUEUE_STATUS.downloading;
}
