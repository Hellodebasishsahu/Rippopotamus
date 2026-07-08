import { Download, FolderOpen, Loader2, X, Link2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserInfo, CookieSource, PresetOption, ProviderOption } from "../types/desktop";
import { queueItemCanRefetch, queueItemCanRemove } from "../app/downloadQueueModel";
import { presetsForProvider } from "../app/downloadQueuePrefs";
import {
  presetsForItem,
  providerForItem,
  queueItemProgress,
  type QueueItem,
} from "../app/useDownloadQueue";
import type { DesktopClient } from "../client/desktopClient";
import { resolveIntakeStatus } from "../app/intakeStatus";
import { IntakeStatusBar } from "../components/IntakeStatusBar";
import { QueueCard } from "../components/QueueCard";
import { QueueMenu } from "../components/QueueMenu";


export type ProjectIntakeViewProps = {
  desktop: DesktopClient | null;
  activeOutputRoot: string;
  cookieSource: CookieSource;
  consumerErrorMessage: (message: string, fallback?: string) => string;
  consumerNoticeMessage: (message: string) => string | null;
  input: string;
  detectedCount: number;
  pageProbeError: string | null;
  items: QueueItem[];
  totals: { ready: number; downloading: number; done: number; interrupted: number; failed: number; canceled: number };
  busy: boolean;
  browsers: BrowserInfo[];
  presetOptions: PresetOption[];
  providerOptions: ProviderOption[];
  downloadReady: () => Promise<void>;
  startDownload: (item: QueueItem) => Promise<void>;
  openSource: (item: QueueItem) => void;
  setItemPreset: (id: string, preset: string) => void;
  setItemQuality: (id: string, preset: string, maxHeight?: number) => void;
  setItemCookieSource: (id: string, source: CookieSource) => void;
  refetch: (item: QueueItem) => Promise<void>;
  removeItem: (id: string) => void;
  cancelDownload: (item: QueueItem) => Promise<void>;
  cancelActiveDownloads: () => Promise<void>;
  resumeDownload: (item: QueueItem) => Promise<void>;
  resumeInterrupted: () => Promise<void>;
  bulkSetPreset: (ids: Iterable<string>, preset: string) => void;
};

export function ProjectIntakeView({
  desktop,
  activeOutputRoot,
  consumerErrorMessage,
  consumerNoticeMessage,
  input,
  detectedCount,
  pageProbeError,
  items,
  totals,
  busy,
  presetOptions,
  providerOptions,
  downloadReady,
  startDownload,
  setItemPreset,
  setItemQuality,
  refetch,
  removeItem,
  cancelDownload,
  cancelActiveDownloads,
  resumeDownload,
  resumeInterrupted,
  bulkSetPreset,
}: ProjectIntakeViewProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const lastAnchorIndexRef = useRef<number | null>(null);

  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(items.map((i) => i.localId));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed && next.size === prev.size) return prev;
      return next;
    });
  }, [items]);

  const anySelected = selectedIds.size > 0;
  const showCheckboxes = true;

  const handleSelectClick = useCallback((event: React.MouseEvent, localId: string, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && lastAnchorIndexRef.current !== null) {
      const from = Math.min(lastAnchorIndexRef.current, index);
      const to = Math.max(lastAnchorIndexRef.current, index);
      const slice = items.slice(from, to + 1).map((i) => i.localId);
      setSelectedIds(new Set(slice));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(localId)) next.delete(localId);
        else next.add(localId);
        return next;
      });
      lastAnchorIndexRef.current = index;
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
    lastAnchorIndexRef.current = index;
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastAnchorIndexRef.current = null;
  }, []);

  const bulkRefetch = useCallback(async () => {
    for (const id of selectedIds) {
      const item = items.find((i) => i.localId === id);
      if (item && queueItemCanRefetch(item)) await refetch(item);
    }
  }, [items, refetch, selectedIds]);

  const bulkRemove = useCallback(() => {
    for (const id of selectedIds) {
      const item = items.find((i) => i.localId === id);
      if (item && queueItemCanRemove(item)) removeItem(id);
    }
    clearSelection();
  }, [clearSelection, items, removeItem, selectedIds]);

  const firstSelected = items.find((i) => selectedIds.has(i.localId));
  const bulkProvider = firstSelected ? providerForItem(firstSelected, presetOptions, providerOptions) : providerOptions[0]?.id;
  const bulkPresetList = presetsForProvider(bulkProvider || providerOptions[0]?.id || "yt-dlp", presetOptions);

  const bulkMenuValue = useMemo(() => {
    if (!bulkPresetList.length) return "";
    if (!firstSelected) return bulkPresetList[0].id;
    const match = bulkPresetList.find((p) => p.id === firstSelected.preset);
    return match ? match.id : bulkPresetList[0].id;
  }, [bulkPresetList, firstSelected]);

  const intakeStatus = useMemo(() => resolveIntakeStatus({
    input,
    detectedCount,
    pageProbeError,
    formatError: consumerErrorMessage,
  }), [input, detectedCount, pageProbeError, consumerErrorMessage]);

  return (
    <section className={`intake${anySelected ? " intake-has-selection" : ""}`}>
      <div className="intake-main">
      {items.length === 0 ? (
        <div className={`intake-empty intake-empty-${intakeStatus.tone}`}>
          <div className="intake-empty-card">
            <div className="intake-empty-icon-wrapper">
              {intakeStatus.tone === "error" || intakeStatus.tone === "warning" ? (
                <AlertCircle size={28} className="intake-empty-icon" aria-hidden />
              ) : intakeStatus.tone === "success" ? (
                <CheckCircle2 size={28} className="intake-empty-icon" aria-hidden />
              ) : (
                <Link2 size={28} className="intake-empty-icon" aria-hidden />
              )}
            </div>
            <h3 className="intake-empty-title">
              {intakeStatus.tone === "idle" ? "Queue" :
               intakeStatus.tone === "info" ? "Link Detected" :
               intakeStatus.tone === "warning" ? "Invalid Link" :
               intakeStatus.tone === "error" ? "Intake Error" : "Ready"}
            </h3>
            <p className="intake-empty-body">
              {intakeStatus.message}
            </p>
          </div>
        </div>
      ) : pageProbeError ? (
        <IntakeStatusBar status={intakeStatus} />
      ) : null}

      {items.length > 0 ? (
        <div className="queue-section">
          <div className="queue-scroll">
            <div className="queue-list">
              {items.map((item, index) => {
                const itemPresets = presetsForItem(item, presetOptions, providerOptions);
                const progress = queueItemProgress(item);
                const visibleNotices = item.error ? [] : (item.notices || []).flatMap((notice) => {
                  const message = consumerNoticeMessage(notice.message);
                  return message ? [{ ...notice, message }] : [];
                });
                return (
                  <QueueCard
                    key={item.localId}
                    item={item}
                    itemPresets={itemPresets}
                    presetOptions={presetOptions}
                    desktop={desktop}
                    outputRoot={activeOutputRoot}
                    progress={progress}
                    visibleNotices={visibleNotices}
                    selected={selectedIds.has(item.localId)}
                    showSelectCheckbox={showCheckboxes}
                    onSelectClick={(event) => handleSelectClick(event, item.localId, index)}
                    setItemPreset={setItemPreset}
                    setItemQuality={setItemQuality}
                    startDownload={startDownload}
                    removeItem={removeItem}
                    cancelDownload={cancelDownload}
                    resumeDownload={resumeDownload}
                  />
                );
              })}
            </div>
          </div>

          <div className={`queue-dock${anySelected ? " is-bulk" : ""}`}>
            {anySelected ? (
              <>
                <div className="queue-dock-left">
                  <span className="queue-dock-label">{selectedIds.size} selected</span>
                  <QueueMenu
                    value={bulkMenuValue}
                    options={bulkPresetList.map((p) => ({ id: p.id, label: p.label, detail: p.detail }))}
                    onChange={(id) => {
                      bulkSetPreset(selectedIds, id);
                    }}
                    disabled={!bulkPresetList.length}
                    ariaLabel="Set quality for selected"
                    triggerText="Set quality"
                    className="queue-toolbar-menu"
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void bulkRefetch()}>
                    Refetch all
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={bulkRemove}>
                    Remove all
                  </button>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection} aria-label="Clear selection" title="Clear selection">
                  <X size={16} strokeWidth={2} aria-hidden />
                </button>
              </>
            ) : (
              <>
                <div className="queue-dock-left">
                  <span className="queue-dock-stat is-ready"><b>{totals.ready}</b> ready</span>
                  <span className="queue-dock-stat is-active"><b>{totals.downloading}</b> active</span>
                  <span className="queue-dock-stat is-done"><b>{totals.done}</b> done</span>
                  {totals.interrupted ? (
                    <span className="queue-dock-stat is-interrupted"><b>{totals.interrupted}</b> interrupted</span>
                  ) : null}
                </div>
                <div className="queue-dock-right">
                  <button type="button" className="btn btn-ghost btn-fetch" onClick={() => desktop?.openFolder(activeOutputRoot)} disabled={!desktop} title={activeOutputRoot || undefined}>
                    <FolderOpen size={14} strokeWidth={2} aria-hidden />
                  </button>
                  {totals.downloading ? (
                    <button type="button" className="btn btn-ghost btn-fetch btn-danger-text" onClick={() => void cancelActiveDownloads()} disabled={!desktop}>
                      Cancel active
                    </button>
                  ) : null}
                  {totals.interrupted ? (
                    <button type="button" className="btn btn-ghost btn-fetch" onClick={() => void resumeInterrupted()} disabled={!desktop} title="Resume interrupted downloads">
                      Resume
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-primary btn-fetch" onClick={() => void downloadReady()} disabled={!totals.ready || busy || !desktop}>
                    {busy ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <Download size={14} strokeWidth={2} aria-hidden />}
                    {totals.ready ? `Save ${totals.ready}` : "Save"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      </div>
    </section>
  );
}
