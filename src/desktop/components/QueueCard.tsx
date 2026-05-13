import { ExternalLink, ImageOff, Link2, Loader2, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrowserInfo, CookieSource, PresetOption } from "../../../electron/types";
import { queueItemCanChangeOutput, queueItemCanRefetch, queueItemCanRemove, type QueueItem } from "../app/downloadQueueModel";
import { getDesktopClient } from "../client/desktopClient";

function formatDuration(seconds?: number) {
  if (!seconds) return "Unknown length";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function sourceUrl(item: QueueItem) {
  return item.metadata?.webpage_url || item.url;
}

function metaLine(item: QueueItem): string {
  const parts: string[] = [];
  if (item.metadata?.extractor) parts.push(item.metadata.extractor);
  else parts.push(shortUrl(sourceUrl(item)));
  if (item.metadata?.uploader) parts.push(item.metadata.uploader);
  if (item.metadata?.duration) parts.push(formatDuration(item.metadata.duration));
  return parts.join(" · ");
}

function cookieSourceValue(source: CookieSource | null | undefined): string {
  return source?.mode === "browser" ? `browser:${source.browserId}` : "off";
}

function cookieSourceFromValue(value: string): CookieSource {
  if (value.startsWith("browser:")) return { mode: "browser", browserId: value.slice("browser:".length) };
  return { mode: "off" };
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
  /\bqBittorrent\b/i,
  /\bqbittorrent-nox\b/i,
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

function thumbnailUrls(item: QueueItem): string[] {
  const candidates = [
    item.metadata?.thumbnail,
    ...(item.metadata?.thumbnails || []),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(candidates));
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

  if (loading) return <Loader2 className="thumb-spinner" size={26} strokeWidth={1.8} aria-hidden />;
  if (failed || !src) return <ImageOff size={28} strokeWidth={1.5} aria-hidden />;

  return (
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
  );
}

export function QueueCard({
  item,
  itemPresets,
  presetOptions,
  browsers,
  progress,
  statusText,
  showBrowserAccess,
  visibleNotices,
  openSource,
  setItemPreset,
  setItemCookieSource,
  refetch,
  removeItem,
}: {
  item: QueueItem;
  itemPresets: PresetOption[];
  presetOptions: PresetOption[];
  browsers: BrowserInfo[];
  progress: number | null;
  statusText: string;
  showBrowserAccess: boolean;
  visibleNotices: { level: "warning" | "error"; message: string }[];
  openSource: (item: QueueItem) => void;
  setItemPreset: (id: string, preset: string) => void;
  setItemCookieSource: (id: string, source: CookieSource) => void;
  refetch: (item: QueueItem) => void;
  removeItem: (id: string) => void;
}) {
  return (
    <article className={`queue-item ${item.status}`}>
      <button type="button" className="thumb" onClick={() => openSource(item)} aria-label="Open source page" title="Open source page">
        {item.metadata ? <ThumbnailImage urls={thumbnailUrls(item)} /> : <Link2 size={28} strokeWidth={1.5} aria-hidden />}
        <span className="thumb-overlay"><ExternalLink size={20} strokeWidth={2} aria-hidden /></span>
      </button>
      <div className="item-body">
        <div className="item-head">
          <h3 className="item-title">{item.metadata?.title || shortUrl(item.url)}</h3>
          <p className="item-meta">{metaLine(item)}</p>
          {item.error ? <p className="item-error">{consumerErrorMessage(item.error)}</p> : null}
          {visibleNotices.map((notice, i) => (
            <p key={i} className={notice.level === "error" ? "item-error" : "item-warning"}>{notice.message}</p>
          ))}
          {item.files?.length && !item.error ? <p className="item-files">{item.files.join(" · ")}</p> : null}
        </div>
        <div className="item-foot">
          <span className={`status-badge status-${item.status}`} data-status={item.status}>
            <span className="status-glyph" />
            {statusText}
          </span>
          <div className="preset-chip">
            <select
              value={item.preset}
              onChange={(event) => setItemPreset(item.localId, event.target.value)}
              disabled={!queueItemCanChangeOutput(item)}
              aria-label="Output format"
              title={presetOptions.find((p) => p.id === item.preset)?.detail}
            >
              {itemPresets.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          {showBrowserAccess ? (
            <div className="access-chip" title={cookieAccessLabel(item.cookieSource, browsers)}>
              <select
                value={cookieSourceValue(item.cookieSource)}
                onChange={(event) => setItemCookieSource(item.localId, cookieSourceFromValue(event.target.value))}
                disabled={!queueItemCanChangeOutput(item)}
                aria-label="Site access"
              >
                <option value="off">Public only</option>
                {browsers.map((browser) => (
                  <option key={browser.id} value={`browser:${browser.id}`}>{browser.label}</option>
                ))}
              </select>
            </div>
          ) : null}
          <span className="foot-spacer" />
          <button type="button" className="icon-btn" onClick={() => refetch(item)} disabled={!queueItemCanRefetch(item)} title="Refetch" aria-label="Refetch">
            <RefreshCcw size={16} strokeWidth={2} aria-hidden />
          </button>
          <button type="button" className="icon-btn icon-btn-danger" onClick={() => removeItem(item.localId)} disabled={!queueItemCanRemove(item)} title="Remove" aria-label="Remove">
            <Trash2 size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>
      {progress !== null ? <div className={`card-progress ${item.finalizing ? "finalizing" : ""}`} style={{ width: `${progress}%` }} /> : null}
    </article>
  );
}
