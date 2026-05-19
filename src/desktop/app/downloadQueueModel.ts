import type { CookieSource, FetchResponse, ProviderId } from "../../../electron/types";

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
  /** Provider passed to fetch when this item was queued (for preset defaulting). */
  fetchProvider?: ProviderId | "auto";
  /** True after user (or bulk) picks a quality; fetch/refetch must not overwrite preset. */
  presetUserSet?: boolean;
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

export type QueueItemStatusParts = { label: string; detail: string };

/** Split download progress line: label (percent / phase) vs detail (speed · ETA from stage). */
export function queueItemStatusParts(item: QueueItem): QueueItemStatusParts {
  if (item.status !== QUEUE_STATUS.downloading) {
    return { label: queueStatusLabels[item.status], detail: "" };
  }
  const progress = queueItemProgress(item);
  if (item.finalizing) {
    return { label: item.stage || "Finalizing...", detail: "" };
  }
  let detail = "";
  const stage = item.stage?.trim();
  if (stage) {
    const comma = stage.indexOf(",");
    detail = comma >= 0 ? `${stage.slice(0, comma).trim()} · ${stage.slice(comma + 1).trim()}` : stage;
  }
  if (item.phase) return { label: `${item.phase} · ${progress}%`, detail };
  return { label: `${progress}%`, detail };
}

export function queueItemStatusText(item: QueueItem): string {
  const { label, detail } = queueItemStatusParts(item);
  return detail ? `${label} — ${detail}` : label;
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
