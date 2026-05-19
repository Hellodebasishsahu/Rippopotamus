import { Download, FolderOpen, Loader2 } from "lucide-react";
import type { BrowserInfo, CookieSource, PresetOption, ProviderOption, SourceSearchResponse } from "../../../electron/types";
import { itemSupportsBrowserAccess, presetsForItem, queueItemProgress, queueItemStatusText, sourceUrl, type QueueItem } from "../app/useDownloadQueue";
import type { DesktopClient } from "../client/desktopClient";
import { QueueCard } from "../components/QueueCard";
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
  downloadReady: () => Promise<void>;
  openSource: (item: QueueItem) => void;
  setItemPreset: (id: string, preset: string) => void;
  setItemCookieSource: (id: string, source: CookieSource) => void;
  refetch: (item: QueueItem) => Promise<void>;
  removeItem: (id: string) => void;
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
  downloadReady,
  openSource,
  setItemPreset,
  setItemCookieSource,
  refetch,
  removeItem,
}: ProjectIntakeViewProps) {
  return (
    <section className="intake">
      {pageProbeError ? <p className="error-text">{consumerErrorMessage(pageProbeError, "Could not sniff this page.")}</p> : null}
      {pageProbeNotice ? <p className="hint-text">{pageProbeNotice}</p> : null}

      {items.length > 0 ? (
        <>
          <div className="queue-bar">
            <span className="queue-summary">{totals.ready} ready · {totals.done} done{totals.failed ? ` · ${totals.failed} failed` : ""}</span>
            <div className="queue-bar-actions">
              <button type="button" className="btn btn-ghost btn-fetch" onClick={() => desktop?.openFolder(activeOutputRoot)} disabled={!desktop} title={activeOutputRoot || undefined}>
                <FolderOpen size={14} strokeWidth={2} aria-hidden />
              </button>
              <button type="button" className="btn btn-primary btn-fetch" onClick={() => void downloadReady()} disabled={!totals.ready || busy || !desktop}>
                {busy ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <Download size={14} strokeWidth={2} aria-hidden />}
                {totals.ready ? `Save ${totals.ready}` : "Save"}
              </button>
            </div>
          </div>
          {items.map((item) => {
            const itemPresets = presetsForItem(item, presetOptions, providerOptions);
            const progress = queueItemProgress(item);
            const statusText = queueItemStatusText(item);
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
                statusText={statusText}
                showBrowserAccess={showBrowserAccess}
                visibleNotices={visibleNotices}
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

      <SheetImportPanel
        desktop={desktop}
        outputRoot={activeOutputRoot}
        cookieSource={cookieSource}
        libraryIndexRoot={libraryIndexRoot}
        formatError={consumerErrorMessage}
        defaultOpen={showIntakeEmptyHint}
      />
    </section>
  );
}
