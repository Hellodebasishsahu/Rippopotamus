import type { CookieSource, FetchResponse, ProviderId } from "../types/desktop";

export const QUEUE_STATUS = {
  queued: "queued",
  /** Metadata / URL resolution (was "fetching" in older builds). */
  resolving: "resolving",
  ready: "ready",
  downloading: "downloading",
  /** yt-dlp/gallery final mux pass */
  finalizing: "finalizing",
  done: "done",
  canceled: "canceled",
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
  /** Chosen video resolution cap (e.g. 1080). Undefined = preset default (best). */
  maxHeight?: number;
  /** Playlist this item was expanded from, for grouping/labeling. */
  playlistTitle?: string;
  metadata?: Extract<FetchResponse, { ok: true }>["metadata"];
  error?: string;
  progress?: number;
  speed?: string | null;
  eta?: string | null;
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
  [QUEUE_STATUS.canceled]: "Canceled",
  [QUEUE_STATUS.failed]: "Failed",
};

export function queueItemProgress(item: QueueItem): number | null {
  if (item.status !== QUEUE_STATUS.downloading) return null;
  return Math.max(2, Math.round(item.progress || 0));
}

export type QueueItemStatusParts = { label: string; detail: string; speed: string; eta: string };

export function queueItemSizeLabel(item: QueueItem): string {
  const fromMeta = item.metadata?.filesize ?? item.metadata?.filesize_approx ?? null;
  if (fromMeta != null && Number.isFinite(fromMeta) && fromMeta > 0) {
    return formatBytes(fromMeta) ?? "—";
  }
  const lastFile = item.files?.length ? item.files[item.files.length - 1] : null;
  const fileSize = typeof lastFile === "object" && lastFile ? lastFile.size : null;
  if (fileSize != null && Number.isFinite(fileSize) && fileSize > 0) {
    return formatBytes(fileSize) ?? "—";
  }
  return "—";
}

function formatBytes(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** Split download progress: percent label, speed, and ETA for table columns. */
export function queueItemStatusParts(item: QueueItem): QueueItemStatusParts {
  const empty = { label: "", detail: "", speed: "—", eta: "—" };
  if (item.status !== QUEUE_STATUS.downloading) {
    const stage = item.stage?.trim();
    const label = stage && (item.status === QUEUE_STATUS.queued || item.status === QUEUE_STATUS.resolving)
      ? stage
      : queueStatusLabels[item.status];
    return { ...empty, label };
  }
  const progress = queueItemProgress(item);
  if (item.finalizing) {
    return { ...empty, label: item.stage || "Finalizing..." };
  }
  const speed = item.speed?.trim() || "—";
  const eta = item.eta?.replace(/\s*left$/i, "").trim() || "—";
  let detail = "";
  if (speed !== "—" && eta !== "—") detail = `${speed} · ${eta}`;
  else if (speed !== "—") detail = speed;
  else if (item.stage?.trim()) {
    const comma = item.stage.indexOf(",");
    detail = comma >= 0 ? `${item.stage.slice(0, comma).trim()} · ${item.stage.slice(comma + 1).trim()}` : item.stage;
  }
  if (item.phase) return { label: `${item.phase} · ${progress}%`, detail, speed, eta };
  return { label: `${progress}%`, detail, speed, eta };
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
