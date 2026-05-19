import { Download, FolderOpen, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserInfo, CookieSource, PresetOption, ProviderId, ProviderOption, SourceSearchResponse } from "../../../electron/types";
import { queueItemCanRefetch, queueItemCanRemove } from "../app/downloadQueueModel";
import { preferredPresetForProvider, presetsForProvider } from "../app/downloadQueuePrefs";
import {
  itemSupportsBrowserAccess,
  presetsForItem,
  providerForItem,
  queueItemProgress,
  type QueueItem,
} from "../app/useDownloadQueue";
import type { DesktopClient } from "../client/desktopClient";
import { IntakeBentDivider } from "../components/IntakeBentDivider";
import { QueueCard } from "../components/QueueCard";
import { QueueMenu } from "../components/QueueMenu";
import { SheetImportPanel } from "../components/SheetImportPanel";
import { SourceSearchPanel } from "../components/SourceSearchPanel";

export type ProjectIntakeViewProps = {
  desktop: DesktopClient | null;
  activeOutputRoot: string;
  cookieSource: CookieSource;
  libraryIndexRoot?: string;
  consumerErrorMessage: (message: string, fallback?: string) => string;
  consumerNoticeMessage: (message: string) => string | null;
  sourceSearch: SourceSearchResponse;
  sourceSearchBusy: boolean;
  input: string;
  pageProbeError: string | null;
  pageProbeNotice: string | null;
  items: QueueItem[];
  totals: { ready: number; done: number; failed: number };
  busy: boolean;
  showIntakeEmptyHint: boolean;
  browsers: BrowserInfo[];
  presetOptions: PresetOption[];
  providerOptions: ProviderOption[];
  selectedFetchProvider: ProviderId | "auto";
  preferredPresets: Partial<Record<ProviderId, string>>;
  setPreferredPreset: (provider: ProviderId, presetId: string) => void;
  downloadReady: () => Promise<void>;
  openSource: (item: QueueItem) => void;
  setItemPreset: (id: string, preset: string) => void;
  setItemCookieSource: (id: string, source: CookieSource) => void;
  refetch: (item: QueueItem) => Promise<void>;
  removeItem: (id: string) => void;
  bulkSetPreset: (ids: Iterable<string>, preset: string) => void;
};

export function ProjectIntakeView({
  desktop,
  activeOutputRoot,
  cookieSource,
  libraryIndexRoot,
  consumerErrorMessage,
  consumerNoticeMessage,
  sourceSearch,
  sourceSearchBusy,
  input,
  pageProbeError,
  pageProbeNotice,
  items,
  totals,
  busy,
  showIntakeEmptyHint,
  browsers,
  presetOptions,
  providerOptions,
  selectedFetchProvider,
  preferredPresets,
  setPreferredPreset,
  downloadReady,
  openSource,
  setItemPreset,
  setItemCookieSource,
  refetch,
  removeItem,
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

  const defaultQualityProvider: ProviderId = selectedFetchProvider === "auto" ? "yt-dlp" : selectedFetchProvider;
  const defaultQualityPresets = presetsForProvider(defaultQualityProvider, presetOptions);
  const defaultQualityValue = preferredPresetForProvider(defaultQualityProvider, presetOptions, providerOptions, preferredPresets);

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
  const bulkProvider = firstSelected ? providerForItem(firstSelected, presetOptions, providerOptions) : defaultQualityProvider;
  const bulkPresetList = presetsForProvider(bulkProvider || defaultQualityProvider, presetOptions).length
    ? presetsForProvider(bulkProvider || defaultQualityProvider, presetOptions)
    : defaultQualityPresets;

  const bulkMenuValue = useMemo(() => {
    if (!bulkPresetList.length) return "";
    if (!firstSelected) return bulkPresetList[0].id;
    const match = bulkPresetList.find((p) => p.id === firstSelected.preset);
    return match ? match.id : bulkPresetList[0].id;
  }, [bulkPresetList, firstSelected]);

  return (
    <section className={`intake${anySelected ? " intake-has-selection" : ""}`}>
      <div className="intake-main">
      {pageProbeError ? <p className="error-text">{consumerErrorMessage(pageProbeError, "Could not sniff this page.")}</p> : null}
      {pageProbeNotice ? <p className="hint-text">{pageProbeNotice}</p> : null}

      {items.length > 0 ? (
        <>
          <IntakeBentDivider />
          <div className={`queue-toolbar${anySelected ? " is-bulk" : ""}`}>
            {anySelected ? (
              <>
                <div className="queue-toolbar-left">
                  <span className="queue-toolbar-summary">{selectedIds.size} selected</span>
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
                <div className="queue-toolbar-right">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection} aria-label="Clear selection" title="Clear selection">
                    <X size={16} strokeWidth={2} aria-hidden />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="queue-toolbar-left">
                  <span className="queue-toolbar-summary">{totals.ready} ready · {totals.done} done{totals.failed ? ` · ${totals.failed} failed` : ""}</span>
                  {defaultQualityPresets.length ? (
                    <div className="queue-toolbar-default-quality">
                      <span className="queue-toolbar-label">Default quality</span>
                      <QueueMenu
                        value={defaultQualityValue}
                        options={defaultQualityPresets.map((p) => ({ id: p.id, label: p.label, detail: p.detail }))}
                        onChange={(id) => setPreferredPreset(defaultQualityProvider, id)}
                        ariaLabel="Default quality for new downloads"
                        className="queue-toolbar-menu"
                      />
                    </div>
                  ) : null}
                </div>
                <div className="queue-toolbar-right">
                  <button type="button" className="btn btn-ghost btn-fetch" onClick={() => desktop?.openFolder(activeOutputRoot)} disabled={!desktop} title={activeOutputRoot || undefined}>
                    <FolderOpen size={14} strokeWidth={2} aria-hidden />
                  </button>
                  <button type="button" className="btn btn-primary btn-fetch" onClick={() => void downloadReady()} disabled={!totals.ready || busy || !desktop}>
                    {busy ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <Download size={14} strokeWidth={2} aria-hidden />}
                    {totals.ready ? `Save ${totals.ready}` : "Save"}
                  </button>
                </div>
              </>
            )}
          </div>
          {items.map((item, index) => {
            const itemPresets = presetsForItem(item, presetOptions, providerOptions);
            const progress = queueItemProgress(item);
            const showBrowserAccess = browsers.length > 0 && itemSupportsBrowserAccess(item, presetOptions, providerOptions);
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
                browsers={browsers}
                progress={progress}
                showBrowserAccess={showBrowserAccess}
                visibleNotices={visibleNotices}
                selected={selectedIds.has(item.localId)}
                showSelectCheckbox={showCheckboxes}
                onSelectClick={(event) => handleSelectClick(event, item.localId, index)}
                openSource={openSource}
                setItemPreset={setItemPreset}
                setItemCookieSource={setItemCookieSource}
                refetch={refetch}
                removeItem={removeItem}
              />
            );
          })}
        </>
      ) : null}

      <SourceSearchPanel
        sourceSearch={sourceSearch}
        sourceSearchBusy={sourceSearchBusy}
        input={input}
        openExternal={(url) => desktop?.openExternal(url)}
      />
      </div>

      <footer className="intake-sheet-footer">
        <SheetImportPanel
          desktop={desktop}
          outputRoot={activeOutputRoot}
          cookieSource={cookieSource}
          libraryIndexRoot={libraryIndexRoot}
          formatError={consumerErrorMessage}
        />
      </footer>
    </section>
  );
}
