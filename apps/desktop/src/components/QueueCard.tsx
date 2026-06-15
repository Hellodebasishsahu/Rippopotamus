import { Check, FolderOpen, ImageOff, Link2, Loader2, RefreshCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrowserInfo, CookieSource, PresetOption } from "../../electron/types";
import {
  QUEUE_STATUS,
  queueItemCanChangeOutput,
  queueItemCanRefetch,
  queueItemCanRemove,
  queueItemStatusParts,
  type QueueItem,
} from "../app/downloadQueueModel";
import { getDesktopClient } from "../client/desktopClient";
import { QueueMenu, type QueueMenuOption } from "./QueueMenu";

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function cookieAccessLabel(source: CookieSource, browsers: BrowserInfo[]): string {
  if (source.mode === "off") return "Public links only";
  const browser = browsers.find((candidate) => candidate.id === source.browserId);
  return browser ? `${browser.label} session` : "Browser session";
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
    .trim();
  const lower = cleaned.toLowerCase();

  if (/unsupported url/i.test(cleaned)) return "This link is not supported yet.";
  if (lower.includes("requested format is not available") || lower.includes("selected format is not available")) return "This link does not have that format. Choose another format and try again.";
  if (lower.includes("status=500") || lower.includes("response status is not successful") || lower.includes("source is having trouble")) return "The source is having trouble right now. Try again later or use another link.";
  if (lower.includes("http error 403") || lower.includes("access denied") || lower.includes("forbidden")) return "This source blocked the download. Try browser login or another link.";
  if (lower.includes("http error 404") || lower.includes("not found")) return "This source is no longer available.";
  if (!cleaned || TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(cleaned))) return fallback;
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function formatBytes(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
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

function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function thumbnailUrls(item: QueueItem): string[] {
  const candidates = [
    item.metadata?.thumbnail,
    ...(item.metadata?.thumbnails || []),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(candidates));
}

function fileBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  return i >= 0 ? normalized.slice(i + 1) : normalized;
}

function ThumbnailImage({ urls }: { urls: string[] }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    setLoading(true);
    setOrientation("landscape");

    const desktop = getDesktopClient();
    if (!desktop) {
      setFailed(true);
      setLoading(false);
      return;
    }

    desktop.loadThumbnail(urls).then((result) => {
      if (cancelled) return;
      if (result.src) setSrc(result.src);
      else setFailed(true);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [urls.join("\n")]);

  if (loading) return <Loader2 className="thumb-spinner" size={18} strokeWidth={1.8} aria-hidden />;
  if (failed || !src) return <ImageOff size={22} strokeWidth={1.5} aria-hidden />;

  const isPortrait = orientation === "portrait";
  return (
    <span className={`thumb-frame-inner${isPortrait ? " is-portrait" : ""}`}>
      {isPortrait ? <img className="thumb-backdrop" src={src} alt="" aria-hidden /> : null}
      <img
        className={`thumb-image ${orientation}`}
        src={src}
        alt=""
        onLoad={(event) => {
          const image = event.currentTarget;
          setOrientation(image.naturalHeight > image.naturalWidth ? "portrait" : "landscape");
        }}
        onError={() => {
          setSrc(null);
          setFailed(true);
        }}
      />
    </span>
  );
}

function presetMenuOptions(presets: PresetOption[]): QueueMenuOption[] {
  return presets.map((p) => ({ id: p.id, label: p.label, detail: p.detail }));
}

function accessMenuOptions(browsers: BrowserInfo[]): QueueMenuOption[] {
  return [
    { id: "off", label: "Public only", detail: "No browser session" },
    ...browsers.map((b) => ({ id: `browser:${b.id}`, label: b.label, detail: "Use logged-in session" })),
  ];
}

function cookieSourceToMenuId(source: CookieSource | null | undefined): string {
  return source?.mode === "browser" ? `browser:${source.browserId}` : "off";
}

function cookieSourceFromMenuId(value: string): CookieSource {
  if (value.startsWith("browser:")) return { mode: "browser", browserId: value.slice("browser:".length) };
  return { mode: "off" };
}

export function QueueCard({
  item,
  itemPresets,
  presetOptions,
  browsers,
  progress,
  showBrowserAccess,
  visibleNotices,
  selected,
  showSelectCheckbox,
  onSelectClick,
  openSource,
  setItemPreset,
  setItemCookieSource,
  refetch,
  removeItem,
  cancelDownload,
  resumeDownload,
}: {
  item: QueueItem;
  itemPresets: PresetOption[];
  presetOptions: PresetOption[];
  browsers: BrowserInfo[];
  progress: number | null;
  showBrowserAccess: boolean;
  visibleNotices: { level: "warning" | "error"; message: string }[];
  selected: boolean;
  showSelectCheckbox: boolean;
  onSelectClick: (event: React.MouseEvent) => void;
  openSource: (item: QueueItem) => void;
  setItemPreset: (id: string, preset: string) => void;
  setItemCookieSource: (id: string, source: CookieSource) => void;
  refetch: (item: QueueItem) => void;
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
  const showIndeterminate = item.status === QUEUE_STATUS.queued || item.status === QUEUE_STATUS.resolving;
  const showProgressTrack = isDownloading || showIndeterminate;
  const progressPct = progress ?? 0;

  const host = shortUrl(item.url);
  const dur = formatDuration(item.metadata?.duration);
  const size = formatBytes(item.metadata?.filesize ?? item.metadata?.filesize_approx ?? null);
  const metaParts: string[] = [host];
  if (item.metadata?.uploader) metaParts.push(item.metadata.uploader);
  if (size) metaParts.push(size);

  const lastFile = item.files?.length ? item.files[item.files.length - 1] : null;
  const lastPath = typeof lastFile === "string" ? lastFile : lastFile?.path;

  const ytDlpSegments = item.metadata?.provider === "yt-dlp" && itemPresets.length > 0 && itemPresets.length <= 4;
  const showStatusBadge = !showProgressTrack && !isFailed && item.status !== QUEUE_STATUS.canceled;

  return (
    <article className={`queue-tile ${item.status}${selected ? " is-selected" : ""}`}>
      <div className="tile-media">
        {showSelectCheckbox ? (
          <label className="tile-select" onClick={(e) => onSelectClick(e)}>
            <input type="checkbox" checked={selected} readOnly tabIndex={-1} aria-label="Select item" />
          </label>
        ) : null}

        <button type="button" className="tile-thumb" onClick={() => openSource(item)} aria-label="Open source" title="Open source">
          {item.metadata ? <ThumbnailImage urls={thumbnailUrls(item)} /> : <Link2 size={20} strokeWidth={1.5} aria-hidden />}
          <span className="tile-thumb-scrim" aria-hidden />
          {dur && !showProgressTrack ? <span className="tile-duration">{dur}</span> : null}
          {showStatusBadge ? (
            <span className={`tile-status status-${item.status}`} data-status={item.status}>
              {item.status === QUEUE_STATUS.done ? <Check size={10} strokeWidth={2.5} aria-hidden /> : <span className="status-glyph" aria-hidden />}
              {statusParts.label}
            </span>
          ) : null}
          {showProgressTrack ? (
            <div className={`tile-progress${showIndeterminate ? " is-indeterminate" : ""}${item.finalizing ? " is-finalizing" : ""}`}>
              <div className="tile-progress-track">
                {!showIndeterminate ? (
                  <div className="tile-progress-fill" style={{ width: `${progressPct}%` }} />
                ) : (
                  <div className="tile-progress-fill tile-progress-indeterminate" />
                )}
              </div>
              <div className="tile-progress-meta">
                <span>{statusParts.label}</span>
                {!showIndeterminate && statusParts.detail ? <span>{statusParts.detail}</span> : null}
              </div>
            </div>
          ) : null}
        </button>

        <div className="tile-actions">
          <button type="button" className="tile-action-btn" onClick={() => void refetch(item)} disabled={!queueItemCanRefetch(item)} title="Refetch" aria-label="Refetch">
            <RefreshCcw size={13} strokeWidth={2} aria-hidden />
          </button>
          {isDownloading ? (
            <button type="button" className="tile-action-btn is-danger" onClick={() => void cancelDownload(item)} title="Cancel download" aria-label="Cancel download">
              <Square size={11} strokeWidth={2.4} aria-hidden />
            </button>
          ) : null}
          <button type="button" className="tile-action-btn is-danger" onClick={() => removeItem(item.localId)} disabled={!queueItemCanRemove(item)} title="Remove" aria-label="Remove">
            <Trash2 size={13} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      <div className="tile-body">
        <h3 className="tile-title">{item.metadata?.title || host}</h3>
        <p className="tile-meta">{metaParts.join(" · ")}</p>

        {isFailed || isCanceled ? (
          <div className="tile-alert">
            <p>{isCanceled ? "Canceled. Partial files will be reused." : item.error ? consumerErrorMessage(item.error) : "Failed"}</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void resumeDownload(item)} disabled={isDownloading}>
              Resume
            </button>
          </div>
        ) : null}

        {!isFailed && item.error ? <p className="item-error">{consumerErrorMessage(item.error)}</p> : null}
        {visibleNotices.slice(0, 1).map((notice, i) => (
          <p key={i} className={notice.level === "error" ? "item-error" : "item-warning"}>{notice.message}</p>
        ))}

        {item.status === QUEUE_STATUS.done && lastPath ? (
          <p className="tile-file" title={lastPath}>
            <FolderOpen size={12} strokeWidth={2} aria-hidden />
            {fileBasename(lastPath)}
          </p>
        ) : null}

        {canEdit && (itemPresets.length > 0 || showBrowserAccess) ? (
          <div className="tile-controls">
            {ytDlpSegments ? (
              <div className="quality-segments" role="group" aria-label="Quality">
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
            ) : itemPresets.length ? (
              <QueueMenu
                value={item.preset}
                options={presetMenuOptions(itemPresets)}
                onChange={(id) => setItemPreset(item.localId, id)}
                disabled={!canEdit}
                ariaLabel="Quality"
                triggerText={qualityShort}
                className="queue-control-menu"
              />
            ) : null}
            {showBrowserAccess ? (
              <QueueMenu
                value={cookieSourceToMenuId(item.cookieSource)}
                options={accessMenuOptions(browsers)}
                onChange={(id) => setItemCookieSource(item.localId, cookieSourceFromMenuId(id))}
                disabled={!canEdit}
                ariaLabel="Site access"
                triggerText={cookieAccessLabel(item.cookieSource, browsers)}
                className="queue-control-menu"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
