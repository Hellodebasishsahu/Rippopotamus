import { Download, FolderOpen, Play, Square, Trash2, Video } from "lucide-react";
import { useEffect, useState } from "react";
import type { PresetOption } from "../types/desktop";
import {
  QUEUE_STATUS,
  queueItemCanChangeOutput,
  queueItemCanRemove,
  queueItemSizeLabel,
  queueItemStatusParts,
  queueStatusLabels,
  type QueueItem,
} from "../app/downloadQueueModel";
import { absoluteLibraryPath } from "../app/useLibrary";
import type { DesktopClient } from "../client/desktopClient";
import { QueueMenu, type QueueMenuOption } from "./QueueMenu";

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatDuration(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const TECHNICAL_MESSAGE_PATTERNS = [
  /\bCUID#/i,
  /\bException:/i,
  /\berrorCode=\d+/i,
  /\bHttpSkipResponseCommand/i,
  /\bDHTRoutingTable/i,
  /\bdht\.dat\b/i,
  /\/Users\//i,
  /\baria2c?\b/i,
  /\byt-dlp\b/i,
  /\bgallery-dl\b/i,
];

function consumerErrorMessage(message: string, fallback = "Download failed. Try again or use another link."): string {
  const cleaned = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/^\[[\w.:-]+\]\s+[\w-]+:\s*/i, "") // ponytail: strip yt-dlp "[extractor] id:" prefix
    .trim();
  const lower = cleaned.toLowerCase();

  if (lower.includes("no video could be found") || lower.includes("no media") || lower.includes("no video formats found"))
    return "No downloadable video in this post. If it's login-only, connect your browser in Settings.";

  if (
    lower.includes("your network is blocking") ||
    lower.includes("connection reset by peer") ||
    lower.includes("curl: (35)") ||
    lower.includes("airtel.in/dot")
  ) return "Your network is blocking this site. Turn on a VPN (Settings → Network access) and try again.";
  if (/unsupported url/i.test(cleaned)) return "This link is not supported yet.";
  if (lower.includes("requested format is not available") || lower.includes("selected format is not available")) return "This link does not have that format. Choose another format and try again.";
  if (lower.includes("status=500") || lower.includes("response status is not successful") || lower.includes("source is having trouble")) return "The source is having trouble right now. Try again later or use another link.";
  if (lower.includes("http error 403") || lower.includes("access denied") || lower.includes("forbidden")) return "This source blocked the download. Try browser login or another link.";
  if (lower.includes("http error 404") || lower.includes("not found")) return "This source is no longer available.";
  if (!cleaned || TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(cleaned))) return fallback;
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function presetMenuOptions(presets: PresetOption[]): QueueMenuOption[] {
  return presets.map((p) => ({ id: p.id, label: p.label, detail: p.detail }));
}

function fileBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  return i >= 0 ? normalized.slice(i + 1) : normalized;
}

function statusLabel(item: QueueItem): string {
  if (item.status === QUEUE_STATUS.failed) return "Failed";
  if (item.status === QUEUE_STATUS.canceled) return "Canceled";
  if (item.status === QUEUE_STATUS.resolving || item.status === QUEUE_STATUS.queued) {
    return item.stage?.trim() || queueStatusLabels[item.status];
  }
  return queueStatusLabels[item.status];
}

// ponytail: fetch the remote thumbnail through the existing bridge (remote <img> is CSP-blocked in Tauri).
function QueueThumbnail({ desktop, url, duration }: { desktop: DesktopClient | null; url?: string; duration: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!desktop || !url) return;
    let cancelled = false;
    desktop.loadThumbnail([url]).then((r) => { if (!cancelled) setSrc(r.src); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [desktop, url]);
  return (
    <div className="queue-card-thumb">
      {src ? <img src={src} alt="" loading="lazy" /> : <Video size={18} strokeWidth={1.6} className="queue-card-thumb-icon" aria-hidden />}
      {duration ? <span className="queue-card-dur">{duration}</span> : null}
    </div>
  );
}

export function QueueCard({
  item,
  itemPresets,
  presetOptions,
  desktop,
  outputRoot,
  progress,
  visibleNotices,
  selected,
  showSelectCheckbox,
  onSelectClick,
  setItemPreset,
  startDownload,
  removeItem,
  cancelDownload,
  resumeDownload,
}: {
  item: QueueItem;
  itemPresets: PresetOption[];
  presetOptions: PresetOption[];
  desktop: DesktopClient | null;
  outputRoot: string;
  progress: number | null;
  visibleNotices: { level: "warning" | "error"; message: string }[];
  selected: boolean;
  showSelectCheckbox: boolean;
  onSelectClick: (event: React.MouseEvent) => void;
  setItemPreset: (id: string, preset: string) => void;
  startDownload: (item: QueueItem) => Promise<void>;
  removeItem: (id: string) => void;
  cancelDownload: (item: QueueItem) => void;
  resumeDownload: (item: QueueItem) => void;
}) {
  const statusParts = queueItemStatusParts(item);
  const currentPreset = presetOptions.find((p) => p.id === item.preset);
  const qualityShort = currentPreset?.label || item.preset;
  const canEdit = queueItemCanChangeOutput(item);
  const isFailed = item.status === QUEUE_STATUS.failed;
  const isCanceled = item.status === QUEUE_STATUS.canceled;
  const isDownloading = item.status === QUEUE_STATUS.downloading;
  const isDone = item.status === QUEUE_STATUS.done;
  const isReady = item.status === QUEUE_STATUS.ready;
  const showIndeterminate = item.status === QUEUE_STATUS.queued || item.status === QUEUE_STATUS.resolving;
  const isBusy = isDownloading || showIndeterminate || item.finalizing;
  const progressPct = progress ?? 0;

  const host = shortUrl(item.url);
  const sizeLabel = queueItemSizeLabel(item);
  const duration = formatDuration(item.metadata?.duration);
  const uploader = item.metadata?.uploader;
  const lastFile = item.files?.length ? item.files[item.files.length - 1] : null;
  const lastPath = typeof lastFile === "string" ? lastFile : lastFile?.path;
  const displayName = isDone && lastPath
    ? fileBasename(lastPath)
    : (item.metadata?.title || host);

  const ytDlpSegments = item.metadata?.provider === "yt-dlp" && itemPresets.length > 0 && itemPresets.length <= 4;
  const errorText = isFailed && item.error
    ? consumerErrorMessage(item.error)
    : isCanceled
      ? "Canceled"
      : visibleNotices[0]?.message || (!isFailed && item.error ? consumerErrorMessage(item.error) : "");

  // One meta line — only what matters in this state.
  const metaParts: string[] = [];
  if (isDone) {
    metaParts.push("Saved");
    if (sizeLabel) metaParts.push(sizeLabel);
  } else {
    metaParts.push(uploader || host);
    if (sizeLabel) metaParts.push(sizeLabel);
  }
  const metaLine = metaParts.join(" · ");

  // Live progress line: percent · speed · left — dropping any that aren't known yet.
  const progLine = [statusParts.label, statusParts.speed, statusParts.eta]
    .filter((p) => p && p !== "—")
    .join(" · ");

  async function revealFile() {
    if (!desktop || !lastPath) return;
    try {
      await desktop.showItemInFolder(absoluteLibraryPath(outputRoot, lastPath));
    } catch {
      undefined;
    }
  }

  async function openFile() {
    if (!desktop || !lastPath) return;
    try {
      await desktop.openPath(absoluteLibraryPath(outputRoot, lastPath));
    } catch {
      undefined;
    }
  }

  return (
    <article
      className={`queue-card ${item.status}${selected ? " is-selected" : ""}`}
      title={errorText || undefined}
    >
      {showSelectCheckbox ? (
        <label className="queue-card-select queue-row-select" onClick={(e) => onSelectClick(e)}>
          <input type="checkbox" checked={selected} readOnly tabIndex={-1} aria-label="Select item" />
        </label>
      ) : null}

      <QueueThumbnail desktop={desktop} url={item.metadata?.thumbnail} duration={duration} />

      {isBusy ? (
        <div className="queue-card-progress">
          <span className="queue-card-title" title={displayName}>{displayName}</span>
          <div className={`queue-progress-track${item.finalizing ? " is-finalizing" : ""}${showIndeterminate ? " is-indeterminate" : ""}`}>
            <div
              className={`queue-progress-fill${showIndeterminate ? " queue-progress-indeterminate" : ""}`}
              style={showIndeterminate ? undefined : { width: `${progressPct}%` }}
            />
          </div>
          <span className="queue-card-progline">{progLine || statusLabel(item)}</span>
        </div>
      ) : (
        <div className="queue-card-body">
          <span className="queue-card-title" title={displayName}>{displayName}</span>
          <span className={`queue-card-meta${isFailed || isCanceled ? " is-error" : ""}`}>
            {isFailed || isCanceled ? errorText : metaLine}
          </span>
        </div>
      )}

      <div className="queue-card-right">
        {isReady && canEdit && itemPresets.length > 0 ? (
          ytDlpSegments ? (
            <div className="quality-segments quality-segments-compact" role="group" aria-label="Quality">
              {itemPresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`quality-segment${item.preset === p.id ? " is-active" : ""}`}
                  onClick={() => setItemPreset(item.localId, p.id)}
                  title={p.detail}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : (
            <QueueMenu
              value={item.preset}
              options={presetMenuOptions(itemPresets)}
              onChange={(id) => setItemPreset(item.localId, id)}
              disabled={!canEdit}
              ariaLabel="Format"
              triggerText={qualityShort}
              className="queue-control-menu"
            />
          )
        ) : null}

        {!isBusy && !isReady ? (
          <span className={`queue-card-pill ${item.status}`}>
            <span className="queue-card-pill-dot" aria-hidden />
            {statusLabel(item)}
          </span>
        ) : null}

        <div className="queue-card-actions">
          {isReady ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void startDownload(item)} disabled={!desktop} title="Save this file">
              <Download size={13} strokeWidth={2} aria-hidden />
              Save
            </button>
          ) : null}
          {isDone && lastPath ? (
            <>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void openFile()}>Open</button>
              <button type="button" className="queue-row-action-btn" onClick={() => void revealFile()} title="Show in folder" aria-label="Show in folder">
                <FolderOpen size={13} strokeWidth={2} aria-hidden />
              </button>
            </>
          ) : null}
          {isDownloading ? (
            <button type="button" className="queue-row-action-btn is-danger" onClick={() => void cancelDownload(item)} title="Stop" aria-label="Stop download">
              <Square size={11} strokeWidth={2.4} aria-hidden />
            </button>
          ) : null}
          {(isFailed || isCanceled) ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void resumeDownload(item)} title="Retry" aria-label="Retry download">
              <Play size={12} strokeWidth={2} aria-hidden />
              Retry
            </button>
          ) : null}
          <button
            type="button"
            className="queue-row-action-btn is-danger"
            onClick={() => removeItem(item.localId)}
            disabled={!queueItemCanRemove(item)}
            title="Remove"
            aria-label="Remove"
          >
            <Trash2 size={13} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>
    </article>
  );
}
