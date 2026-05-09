import { Download, ExternalLink, FolderOpen, Link2, Loader2, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DownloadEvent, EngineHealth, FetchResponse } from "../../electron/types";

const presets = [
  { id: "mp4-best", label: "MP4", detail: "Best source" },
  { id: "audio-mp3", label: "MP3", detail: "Audio only" },
  { id: "thumbnail", label: "Thumb", detail: "JPG cover" },
  { id: "proxy", label: "Proxy", detail: "720p MP4" },
];

type QueueItem = {
  localId: string;
  url: string;
  status: "queued" | "fetching" | "ready" | "downloading" | "done" | "failed";
  metadata?: FetchResponse["metadata"];
  error?: string;
  progress?: number;
  stage?: string;
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

export function App() {
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [preset, setPreset] = useState("mp4-best");
  const [outputRoot, setOutputRoot] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.rippo.health()
      .then((result) => {
        setHealth(result);
        setOutputRoot(result.outputRoot);
      })
      .catch((error) => setHealthError(error.message || String(error)));
  }, []);

  useEffect(() => {
    return window.rippo.onDownloadEvent((event: DownloadEvent) => {
      setItems((current) => current.map((item) => {
        if (item.jobId !== event.jobId) return item;
        if (event.type === "progress") {
          return { ...item, progress: event.percent ?? item.progress, stage: event.speed ? `${event.speed}${event.eta ? `, ${event.eta} left` : ""}` : item.stage };
        }
        if (event.type === "stage") return { ...item, stage: event.message };
        if (event.type === "success") return { ...item, status: "done", progress: 100, files: event.files, stage: "Saved" };
        if (event.type === "error") return { ...item, status: "failed", error: event.error || "Download failed" };
        return item;
      }));
    });
  }, []);

  const totals = useMemo(() => ({
    ready: items.filter((item) => item.status === "ready").length,
    done: items.filter((item) => item.status === "done").length,
    failed: items.filter((item) => item.status === "failed").length,
  }), [items]);

  async function addAndFetch() {
    const urls = splitUrls(input);
    if (!urls.length) return;

    const existing = new Set(items.map((item) => item.url));
    const fresh = urls
      .filter((url) => !existing.has(url))
      .map((url) => ({ localId: crypto.randomUUID().slice(0, 10), url, status: "queued" as const }));

    setInput("");
    setItems((current) => [...fresh, ...current]);

    for (const item of fresh) {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "fetching" } : candidate));
      try {
        const result = await window.rippo.fetch(item.url);
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "ready", metadata: result.metadata } : candidate));
      } catch (error) {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "failed", error: error instanceof Error ? error.message : String(error) } : candidate));
      }
    }
  }

  async function downloadReady() {
    const ready = items.filter((item) => item.status === "ready" || item.status === "failed");
    if (!ready.length || busy) return;
    setBusy(true);
    for (const item of ready) {
      if (item.status === "failed" && !item.metadata) continue;
      const jobId = item.localId;
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "downloading", progress: 0, error: undefined, jobId } : candidate));
      try {
        const response = await window.rippo.download({
          url: item.url,
          preset,
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

  function retryFetch(item: QueueItem) {
    setInput(item.url);
    setItems((current) => current.filter((candidate) => candidate.localId !== item.localId));
  }

  return (
    <main className="app">
      <header className="controls">
        <div className="brand-band">
          <div className="brand">
            <img className="brand-logo" src={`${import.meta.env.BASE_URL}brand-logo.png`} alt="" width={52} height={52} decoding="async" />
            <div className="brand-text">
              <span className="brand-name">Rippopotamus</span>
              <span className="brand-tagline">Links in → assets out</span>
            </div>
          </div>
          <div className={`status-chip ${health?.ok ? "ok" : healthError ? "bad" : "pending"}`}>
            <span className={`engine-dot ${health?.ok ? "ok" : healthError ? "bad" : "pending"}`} aria-hidden />
            <span className="status-chip-label">{health?.ok ? "Engine ready" : healthError || "Starting…"}</span>
          </div>
        </div>
        <div className="input-row">
          <label className="url-field" htmlFor="url-input">
            <Link2 size={18} strokeWidth={2} aria-hidden />
            <textarea
              id="url-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste URLs"
              rows={3}
            />
          </label>
          <button type="button" className="btn btn-primary btn-fetch" onClick={addAndFetch} disabled={!splitUrls(input).length}>
            Fetch
          </button>
        </div>
        <div className="preset-row" role="group" aria-label="Output format">
          {presets.map((item) => (
            <button key={item.id} type="button" className={preset === item.id ? "preset active" : "preset"} onClick={() => setPreset(item.id)} title={item.detail}>
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <section className="queue">
        {items.length > 0 && (
          <p className="queue-summary">{items.length} · {totals.ready} ready · {totals.done} saved</p>
        )}
        {items.length === 0 ? (
          <div className="empty">Paste URLs above.</div>
        ) : (
          items.map((item) => (
            <article key={item.localId} className={`queue-item ${item.status}`}>
              <div className="thumb">
                {item.metadata?.thumbnail ? <img src={item.metadata.thumbnail} alt="" /> : <Link2 size={22} strokeWidth={2} />}
              </div>
              <div className="item-main">
                <div className="item-title">
                  <strong>{item.metadata?.title || shortUrl(item.url)}</strong>
                  <a href={item.metadata?.webpage_url || item.url} target="_blank" rel="noreferrer" aria-label="Open source page">
                    <ExternalLink size={14} strokeWidth={2} aria-hidden />
                  </a>
                </div>
                <p>{item.metadata?.uploader || item.url}</p>
                {(item.metadata?.extractor || item.metadata?.duration) ? (
                  <p className="item-detail">
                    {[item.metadata?.extractor, item.metadata?.duration ? formatDuration(item.metadata.duration) : null].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {item.status === "downloading" && <div className="bar"><span style={{ width: `${item.progress || 4}%` }} /></div>}
                {item.files?.length ? <small className="files">{item.files.join(", ")}</small> : null}
                {item.error ? <small className="error-text">{item.error}</small> : null}
              </div>
              <div className="item-status">
                <span>{item.status}</span>
                {item.stage ? <small>{item.stage}</small> : null}
                {item.status === "failed" ? (
                  <button type="button" onClick={() => retryFetch(item)}>
                    <RefreshCcw size={14} strokeWidth={2} aria-hidden /> Retry
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>

      <footer className="app-footer">
        <div className="footer-main">
          <span className="footer-path-label">Save to</span>
          <span className="footer-path" title={outputRoot || undefined}>{outputRoot || "—"}</span>
        </div>
        <div className="footer-actions">
          <button type="button" className="btn btn-ghost btn-footer" onClick={() => window.rippo.openFolder(outputRoot)}>
            <FolderOpen size={18} strokeWidth={2} /> Open folder
          </button>
          <button type="button" className="btn btn-primary btn-footer" onClick={downloadReady} disabled={!totals.ready || busy}>
            {busy ? <Loader2 className="spin" size={18} strokeWidth={2} /> : <Download size={18} strokeWidth={2} />} Download{totals.ready ? ` ${totals.ready}` : ""}
          </button>
        </div>
      </footer>
    </main>
  );
}
