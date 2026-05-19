import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CookieSource, SheetImportEvent, SheetImportRequest } from "../../../electron/types";
import type { DesktopClient } from "../client/desktopClient";
import { BrandIcon } from "./BrandIcon";

type SheetImportPanelProps = {
  desktop: DesktopClient | null;
  outputRoot: string;
  cookieSource: CookieSource;
  libraryIndexRoot?: string;
  formatError: (message: string, fallback?: string) => string;
  /** Expanded by default on the idle hero screen. */
  defaultOpen?: boolean;
};

export function SheetImportPanel({ desktop, outputRoot, cookieSource, libraryIndexRoot, formatError, defaultOpen = false }: SheetImportPanelProps) {
  const formId = useId();
  const activeJobRef = useRef<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [projectName, setProjectName] = useState("sheet-import");
  const [sheetName, setSheetName] = useState("Tracker");
  const [downloadMaster, setDownloadMaster] = useState(true);
  const [indexToLibrary, setIndexToLibrary] = useState(true);
  const [requireMaster, setRequireMaster] = useState(false);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun = useMemo(
    () => Boolean(desktop?.projects?.importSheet && outputRoot.trim() && sheetUrl.includes("spreadsheets/d/") && !busy),
    [desktop, outputRoot, sheetUrl, busy],
  );

  useEffect(() => {
    if (!desktop?.projects?.onSheetImportEvent) return undefined;
    return desktop.projects.onSheetImportEvent((event: SheetImportEvent) => {
      const jid = activeJobRef.current;
      if (jid && event.jobId && event.jobId !== jid) return;
      const phase = typeof event.phase === "string" ? event.phase : "";
      if (phase === "complete") {
        setStatusLine(typeof event.projectRoot === "string" ? event.projectRoot : "Done");
        setBusy(false);
      } else if (phase === "error") {
        setError(formatError(String(event.error || ""), "Sheet import failed."));
        setBusy(false);
      } else if (phase === "downloading") {
        setStatusLine(`Row ${event.row ?? "…"}`);
      } else if (phase === "parsed") {
        setStatusLine(`${event.selectedRows ?? "?"} rows`);
      } else if (phase) {
        setStatusLine(phase);
      }
    });
  }, [desktop, formatError]);

  async function runImport() {
    if (!desktop?.projects?.importSheet || !canRun) return;
    setBusy(true);
    setError(null);
    setStatusLine("Starting…");
    const jid = crypto.randomUUID();
    activeJobRef.current = jid;
    const payload: SheetImportRequest = {
      sheetUrl: sheetUrl.trim(),
      outputRoot: outputRoot.trim(),
      projectName: projectName.trim() || "sheet-import",
      sheetName: sheetName.trim() || "Tracker",
      jobId: jid,
      cookieSource,
      requireMaster,
      downloadMaster,
      indexToLibrary: Boolean(indexToLibrary && libraryIndexRoot),
    };
    const lim = Number.parseInt(limit.trim(), 10);
    if (Number.isFinite(lim) && lim > 0) payload.limit = lim;
    try {
      const res = await desktop.projects.importSheet(payload);
      if (!res.ok) setError(formatError(res.error || "", "Sheet import failed."));
    } catch (e) {
      setError(formatError(e instanceof Error ? e.message : String(e), "Sheet import failed."));
    } finally {
      setBusy(false);
      activeJobRef.current = null;
    }
  }

  return (
    <details className="sheet-fold sheet-fold-hero" open={busy || defaultOpen}>
      <summary id={`${formId}-title`} className="sheet-fold-summary">
        <BrandIcon brand="google-sheets" className="brand-icon" />
        <span>Sheet → project</span>
      </summary>
      <div className="sheet-fold-body">
        <input
          className="sheet-input"
          value={sheetUrl}
          onChange={(e) => setSheetUrl(e.target.value)}
          placeholder="Google Sheet URL"
          disabled={busy}
          aria-label="Sheet URL"
        />
        <div className="sheet-fold-row">
          <input
            className="sheet-input"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Project name"
            disabled={busy}
            aria-label="Project name"
          />
          <button type="button" className="btn btn-primary btn-fetch" onClick={() => void runImport()} disabled={!canRun}>
            {busy ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : "Import"}
          </button>
        </div>
        <details className="sheet-fold-advanced">
          <summary>Options</summary>
          <div className="sheet-fold-advanced-body">
            <label className="sheet-field">
              <span>Tab</span>
              <input className="sheet-input" value={sheetName} onChange={(e) => setSheetName(e.target.value)} disabled={busy} />
            </label>
            <label className="sheet-field">
              <span>Row limit</span>
              <input className="sheet-input" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="All" disabled={busy} />
            </label>
            <label className="sheet-toggle">
              <input type="checkbox" checked={downloadMaster} onChange={(e) => setDownloadMaster(e.target.checked)} disabled={busy} />
              <BrandIcon brand="google-drive" size={14} className="brand-icon" />
              Drive masters
            </label>
            <label className="sheet-toggle">
              <input type="checkbox" checked={requireMaster} onChange={(e) => setRequireMaster(e.target.checked)} disabled={busy} />
              Master link required
            </label>
            <label className="sheet-toggle">
              <input type="checkbox" checked={indexToLibrary} onChange={(e) => setIndexToLibrary(e.target.checked)} disabled={busy || !libraryIndexRoot} />
              Index to library
            </label>
          </div>
        </details>
        {error ? <p className="error-text">{error}</p> : null}
        {statusLine && !error ? <p className="sheet-status">{statusLine}</p> : null}
      </div>
    </details>
  );
}
