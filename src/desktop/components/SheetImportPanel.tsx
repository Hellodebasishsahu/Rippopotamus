import { Loader2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CookieSource, SheetImportEvent, SheetImportRequest } from "../../../electron/types";
import type { DesktopClient } from "../client/desktopClient";
import { BrandIcon } from "./BrandIcon";

const SHEET_IMPORT_DONE_KEY = "rippo:sheetImport:completed";
const DEFAULT_PROJECT_NAME = "my-project";
const DEFAULT_SHEET_TAB = "Tracker";

type SheetImportPanelProps = {
  desktop: DesktopClient | null;
  outputRoot: string;
  cookieSource: CookieSource;
  formatError: (message: string, fallback?: string) => string;
};

function hasCompletedSheetImport(): boolean {
  try {
    return localStorage.getItem(SHEET_IMPORT_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markSheetImportCompleted(): void {
  try {
    localStorage.setItem(SHEET_IMPORT_DONE_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

export function SheetImportPanel({ desktop, outputRoot, cookieSource, formatError }: SheetImportPanelProps) {
  const formId = useId();
  const activeJobRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(hasCompletedSheetImport);
  const [sheetUrl, setSheetUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [sheetName, setSheetName] = useState(DEFAULT_SHEET_TAB);
  const [downloadMaster, setDownloadMaster] = useState(true);
  const [requireMaster, setRequireMaster] = useState(false);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolvedProjectName = projectName.trim() || DEFAULT_PROJECT_NAME;

  const canRun = useMemo(
    () => Boolean(desktop?.projects?.importSheet && outputRoot.trim() && sheetUrl.includes("spreadsheets/d/") && !busy),
    [desktop, outputRoot, sheetUrl, busy],
  );

  useEffect(() => {
    if (busy) setOpen(true);
  }, [busy]);

  useEffect(() => {
    if (!desktop?.projects?.onSheetImportEvent) return undefined;
    return desktop.projects.onSheetImportEvent((event: SheetImportEvent) => {
      const jid = activeJobRef.current;
      if (jid && event.jobId && event.jobId !== jid) return;
      const phase = typeof event.phase === "string" ? event.phase : "";
      if (phase === "complete") {
        markSheetImportCompleted();
        setShowAdvanced(true);
        setStatusLine(typeof event.projectRoot === "string" ? `Saved to ${event.projectRoot}` : "Project folder ready");
        setBusy(false);
      } else if (phase === "error") {
        setError(formatError(String(event.error || ""), "Could not import this sheet."));
        setBusy(false);
      } else if (phase === "downloading") {
        setStatusLine(`Downloading row ${event.row ?? "…"}`);
      } else if (phase === "parsed") {
        setStatusLine(`Found ${event.selectedRows ?? "?"} rows`);
      } else if (phase === "resolving") {
        setStatusLine("Reading your sheet…");
      } else if (phase) {
        setStatusLine("Working…");
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
      projectName: resolvedProjectName,
      sheetName: sheetName.trim() || DEFAULT_SHEET_TAB,
      jobId: jid,
      cookieSource,
      requireMaster,
      downloadMaster,
    };
    const lim = Number.parseInt(limit.trim(), 10);
    if (Number.isFinite(lim) && lim > 0) payload.limit = lim;
    try {
      const res = await desktop.projects.importSheet(payload);
      if (!res.ok) setError(formatError(res.error || "", "Could not import this sheet."));
    } catch (e) {
      setError(formatError(e instanceof Error ? e.message : String(e), "Could not import this sheet."));
    } finally {
      setBusy(false);
      activeJobRef.current = null;
    }
  }

  return (
    <details
      className="sheet-fold sheet-utility"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary id={`${formId}-title`} className="sheet-utility-summary">
        <BrandIcon brand="google-sheets" size={14} className="brand-icon" />
        <span className="sheet-utility-summary-label">Import from Google Sheet</span>
        <span className="sheet-utility-summary-chevron" aria-hidden />
      </summary>
      <div className="sheet-utility-body">
        <p className="sheet-utility-hint">Tracker URL → local project folder and manifest.</p>
        <label className="sheet-field">
          <span>Sheet URL</span>
          <input
            className="sheet-input sheet-input-utility"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            disabled={busy}
            autoComplete="off"
          />
        </label>
        <div className="sheet-utility-row">
          <label className="sheet-field sheet-field-inline">
            <span>Folder</span>
            <input
              className="sheet-input sheet-input-utility"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={DEFAULT_PROJECT_NAME}
              disabled={busy}
            />
          </label>
          <button type="button" className="btn btn-ghost btn-sm sheet-utility-submit" onClick={() => void runImport()} disabled={!canRun}>
            {busy ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : "Create project"}
          </button>
        </div>
        {!outputRoot.trim() ? (
          <p className="sheet-utility-note">Set output folder in Settings first.</p>
        ) : null}
        {showAdvanced ? (
          <details className="sheet-utility-advanced">
            <summary>More options</summary>
            <div className="sheet-utility-advanced-body">
              <label className="sheet-field">
                <span>Sheet tab</span>
                <input className="sheet-input" value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder={DEFAULT_SHEET_TAB} disabled={busy} />
              </label>
              <label className="sheet-field">
                <span>Row limit</span>
                <input className="sheet-input" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="All rows" disabled={busy} />
              </label>
              <label className="sheet-toggle">
                <input type="checkbox" checked={downloadMaster} onChange={(e) => setDownloadMaster(e.target.checked)} disabled={busy} />
                <BrandIcon brand="google-drive" size={14} className="brand-icon" />
                Download linked Drive files
              </label>
              <label className="sheet-toggle">
                <input type="checkbox" checked={requireMaster} onChange={(e) => setRequireMaster(e.target.checked)} disabled={busy} />
                Only rows with a master link
              </label>
            </div>
          </details>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {statusLine && !error ? <p className="sheet-status">{statusLine}</p> : null}
      </div>
    </details>
  );
}
