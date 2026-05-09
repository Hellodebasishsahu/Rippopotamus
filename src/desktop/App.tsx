import { Download, ExternalLink, FolderOpen, Link2, Loader2, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DownloadEvent, EngineHealth, FetchResponse } from "../../electron/types";

const presets = [
  { id: "mp4-best", label: "MP4", detail: "Best source" },
  { id: "audio-mp3", label: "MP3", detail: "Audio only" },
  { id: "thumbnail", label: "Thumb", detail: "JPG cover" },
  { id: "proxy", label: "Proxy", detail: "720p MP4" },
];

const DEFAULT_PRESET = "mp4-best";

type QueueItem = {
  localId: string;
  url: string;
  status: "queued" | "fetching" | "ready" | "downloading" | "done" | "failed";
  preset: string;
  metadata?: FetchResponse["metadata"];
  error?: string;
  progress?: number;
  stage?: string;
  phase?: string;
  phaseIndex?: number;
  finalizing?: boolean;
  files?: string[];
  jobId?: string;
};

function splitUrls(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,]+/).map((part) => part.trim()).filter((part) => /^https?:\/\//.test(part))));
}

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

const statusLabels: Record<QueueItem["status"], string> = {
  queued: "Queued",
  fetching: "Fetching…",
  ready: "Ready",
  downloading: "Downloading",
  done: "Saved",
  failed: "Failed",
};

function metaLine(item: QueueItem): string {
  const parts: string[] = [];
  if (item.metadata?.extractor) parts.push(item.metadata.extractor);
  else parts.push(shortUrl(sourceUrl(item)));
  if (item.metadata?.uploader) parts.push(item.metadata.uploader);
  if (item.metadata?.duration) parts.push(formatDuration(item.metadata.duration));
  return parts.join(" · ");
}

export function App() {
  const rippo = window.rippo;
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [outputRoot, setOutputRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [input]);

  const detectedCount = useMemo(() => splitUrls(input).length, [input]);

  useEffect(() => {
    if (!rippo) {
      setHealthError("Desktop engine IPC is not available.");
      return;
    }
    rippo.health()
      .then((result) => {
        setHealth(result);
        setOutputRoot(result.outputRoot);
      })
      .catch((error) => setHealthError(error.message || String(error)));
  }, [rippo]);

  useEffect(() => {
    if (!rippo) return undefined;
    return rippo.onDownloadEvent((event: DownloadEvent) => {
      setItems((current) => current.map((item) => {
        if (item.jobId !== event.jobId) return item;
        if (event.type === "phase") {
          return { ...item, phase: event.kind, phaseIndex: (item.phaseIndex || 0) + 1, progress: 0, finalizing: false };
        }
        if (event.type === "progress") {
          if (item.finalizing) return item;
          return { ...item, progress: event.percent ?? item.progress, stage: event.speed ? `${event.speed}${event.eta ? `, ${event.eta} left` : ""}` : item.stage };
        }
        if (event.type === "stage") {
          return { ...item, stage: event.message, finalizing: event.finalizing ? true : item.finalizing, progress: event.finalizing ? 100 : item.progress };
        }
        if (event.type === "success") return { ...item, status: "done", progress: 100, files: event.files, stage: "Saved", finalizing: false };
        if (event.type === "error") return { ...item, status: "failed", error: event.error || "Download failed", finalizing: false };
        return item;
      }));
    });
  }, [rippo]);

  const totals = useMemo(() => ({
    ready: items.filter((item) => item.status === "ready").length,
    done: items.filter((item) => item.status === "done").length,
    failed: items.filter((item) => item.status === "failed").length,
  }), [items]);

  async function addAndFetch() {
    const urls = splitUrls(input);
    if (!urls.length || !rippo) return;

    const existing = new Set(items.map((item) => item.url));
    const fresh = urls
      .filter((url) => !existing.has(url))
      .map((url) => ({ localId: crypto.randomUUID().slice(0, 10), url, status: "queued" as const, preset: DEFAULT_PRESET }));

    setInput("");
    setItems((current) => [...fresh, ...current]);

    for (const item of fresh) {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "fetching" } : candidate));
      try {
        const result = await rippo.fetch(item.url);
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "ready", metadata: result.metadata } : candidate));
      } catch (error) {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "failed", error: error instanceof Error ? error.message : String(error) } : candidate));
      }
    }
  }

  async function downloadReady() {
    const ready = items.filter((item) => item.status === "ready");
    if (!ready.length || busy || !rippo) return;
    setBusy(true);
    for (const item of ready) {
      const jobId = item.localId;
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "downloading", progress: 0, error: undefined, jobId, phase: undefined, phaseIndex: 0, finalizing: false, stage: undefined } : candidate));
      try {
        const response = await rippo.download({
          url: item.url,
          preset: item.preset,
          outputRoot,
          itemId: item.localId,
          title: item.metadata?.title || item.localId,
        });
        const result = response.result as { type?: string; files?: string[] } | undefined;
        if (result?.type === "success") {
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "done", progress: 100, files: result.files, stage: "Saved", jobId: response.jobId } : candidate));
        } else {
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, jobId: response.jobId } : candidate));
        }
      } catch (error) {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "failed", error: error instanceof Error ? error.message : String(error) } : candidate));
      }
    }
    setBusy(false);
  }

  async function refetch(item: QueueItem) {
    if (!rippo) return;
    setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "fetching", error: undefined } : candidate));
    try {
      const result = await rippo.fetch(item.url);
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "ready", metadata: result.metadata } : candidate));
    } catch (error) {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "failed", error: error instanceof Error ? error.message : String(error) } : candidate));
    }
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.localId !== id));
  }

  function setItemPreset(id: string, preset: string) {
    setItems((current) => current.map((item) => item.localId === id ? { ...item, preset } : item));
  }

  function openSource(item: QueueItem) {
    if (rippo) rippo.openExternal(sourceUrl(item)).catch(() => undefined);
    else window.open(sourceUrl(item), "_blank", "noopener,noreferrer");
  }

  return (
    <main className="app">
      <div className="layout">
        <header className="hero">
          <div className="hero-content">
            <div className="masthead">
              <div className="brand-lockup">
                <img className="brand-logo" src={`${import.meta.env.BASE_URL}brand-logo.png`} alt="" width={120} height={120} decoding="async" />
                <h1 className="brand-name">RIPPO</h1>
              </div>
            </div>

            <div className={`composer ${input ? "has-content" : ""}`}>
              <textarea
                id="url-input"
                ref={textareaRef}
                className="input-multiline"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    addAndFetch();
                  }
                }}
                placeholder="Paste link(s) to start…"
                rows={1}
                aria-label="URLs to fetch"
              />
              <div className="composer-foot">
                {detectedCount > 1 ? <span className="link-count">{detectedCount} links</span> : <span className="composer-hint">⌘↵ to fetch</span>}
                <button type="button" className="btn btn-primary btn-fetch" onClick={addAndFetch} disabled={!detectedCount || !rippo}>
                  Fetch{detectedCount > 1 ? ` ${detectedCount}` : ""}
                </button>
              </div>
            </div>
          </div>
          <div className="hero-gradient" />
        </header>

        <section className="queue">
          {healthError ? <p className="error-text">{healthError}</p> : null}
          {items.length > 0 && (
            <p className="queue-summary">{items.length} · {totals.ready} ready · {totals.done} saved{totals.failed ? ` · ${totals.failed} failed` : ""}</p>
          )}
          {items.length === 0 ? (
            <div className="empty">No URLs yet.</div>
          ) : (
            items.map((item) => {
              const progress = item.status === "downloading" ? Math.max(2, Math.round(item.progress || 0)) : null;
              let statusText: string;
              if (item.status === "downloading") {
                if (item.finalizing) statusText = item.stage || "Finalizing…";
                else if (item.phase) statusText = `${item.phase} · ${progress}%`;
                else statusText = `${progress}%`;
              } else {
                statusText = statusLabels[item.status];
              }
              return (
                <article key={item.localId} className={`queue-item ${item.status}`}>
                  <button type="button" className="thumb" onClick={() => openSource(item)} aria-label="Open source page" title="Open source page">
                    {item.metadata?.thumbnail ? <img src={item.metadata.thumbnail} alt="" /> : <Link2 size={28} strokeWidth={1.5} aria-hidden />}
                    <span className="thumb-overlay"><ExternalLink size={20} strokeWidth={2} aria-hidden /></span>
                  </button>
                  <div className="item-body">
                    <div className="item-head">
                      <h3 className="item-title">{item.metadata?.title || shortUrl(item.url)}</h3>
                      <p className="item-meta">{metaLine(item)}</p>
                      {item.error ? <p className="item-error">{item.error}</p> : null}
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
                          disabled={item.status === "downloading" || item.status === "done"}
                          aria-label="Output format"
                          title={presets.find((p) => p.id === item.preset)?.detail}
                        >
                          {presets.map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      <span className="foot-spacer" />
                      <button type="button" className="icon-btn" onClick={() => refetch(item)} disabled={item.status === "fetching" || item.status === "downloading"} title="Refetch" aria-label="Refetch">
                        <RefreshCcw size={16} strokeWidth={2} aria-hidden />
                      </button>
                      <button type="button" className="icon-btn icon-btn-danger" onClick={() => removeItem(item.localId)} disabled={item.status === "downloading"} title="Remove" aria-label="Remove">
                        <Trash2 size={16} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  </div>
                  {progress !== null ? <div className={`card-progress ${item.finalizing ? "finalizing" : ""}`} style={{ width: `${progress}%` }} /> : null}
                </article>
              );
            })
          )}
        </section>

        <footer className="app-footer">
          <p className="footer-path" title={outputRoot || undefined}>{outputRoot || "Set output when engine connects."}</p>
          <div className="footer-actions">
            <button type="button" className="btn btn-ghost btn-footer" onClick={() => rippo?.openFolder(outputRoot)} disabled={!rippo}>
              <FolderOpen size={16} strokeWidth={2} aria-hidden /> Open folder
            </button>
            <button type="button" className="btn btn-primary btn-footer" onClick={downloadReady} disabled={!totals.ready || busy || !rippo}>
              {busy ? <Loader2 className="spin" size={16} strokeWidth={2} aria-hidden /> : <Download size={16} strokeWidth={2} aria-hidden />} Download{totals.ready ? ` ${totals.ready}` : ""}
            </button>
          </div>
        </footer>
      </div>
      {health && !health.ok && health.error ? <p className="error-text health-banner">{health.error}</p> : null}
    </main>
  );
}
