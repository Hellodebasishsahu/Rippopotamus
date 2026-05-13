import { useEffect, useMemo, useState } from "react";
import type { CookieSource, DownloadEvent, PresetOption, ProviderId, ProviderOption } from "../../../electron/types";
import type { DesktopClient } from "../client/desktopClient";
import { QUEUE_STATUS, type QueueItem } from "./downloadQueueModel";

export type { QueueItem } from "./downloadQueueModel";
export { queueStatusLabels, queueItemProgress, queueItemStatusText } from "./downloadQueueModel";

type UseDownloadQueueOptions = {
  desktop: DesktopClient | null;
  selectedFetchProvider: ProviderId | "auto";
  providerOptions: ProviderOption[];
  presetOptions: PresetOption[];
  cookieSource: CookieSource;
  outputRoot: string;
  consumerErrorMessage: (message: string, fallback?: string) => string;
  consumerNoticeMessage: (message: string) => string | null;
};

export function sourceUrl(item: QueueItem) {
  return item.metadata?.webpage_url || item.url;
}

export function providerForItem(item: QueueItem, presets: PresetOption[], providers: ProviderOption[]): ProviderId {
  return item.metadata?.provider || presets.find((preset) => preset.id === item.preset)?.provider || providers[0]?.id || "";
}

export function itemSupportsBrowserAccess(item: QueueItem, presets: PresetOption[], providers: ProviderOption[]): boolean {
  if (item.status === QUEUE_STATUS.queued || item.status === QUEUE_STATUS.fetching || item.status === QUEUE_STATUS.failed) return true;
  return providers.find((provider) => provider.id === providerForItem(item, presets, providers))?.supportsBrowserAccess === true;
}

export function presetsForItem(item: QueueItem, presets: PresetOption[], providers: ProviderOption[]) {
  const provider = providerForItem(item, presets, providers);
  return presets.filter((preset) => preset.provider === provider);
}

function defaultPresetForProvider(provider: ProviderId, providers: ProviderOption[]): string {
  return providers.find((option) => option.id === provider)?.defaultPreset || providers[0]?.defaultPreset || "";
}

function fetchErrorMessage(error: unknown, consumerErrorMessage: (message: string, fallback?: string) => string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  return consumerErrorMessage(message, "Could not read this link. Try another link.");
}

export function useDownloadQueue({
  desktop,
  selectedFetchProvider,
  providerOptions,
  presetOptions,
  cookieSource,
  outputRoot,
  consumerErrorMessage,
  consumerNoticeMessage,
}: UseDownloadQueueOptions) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!desktop) return undefined;
    return desktop.onDownloadEvent((event: DownloadEvent) => {
      setItems((current) => current.map((item) => {
        if (item.jobId !== event.jobId) return item;
        if (event.type === "notice") {
          const message = consumerNoticeMessage(event.message || "");
          if (!message) return item;
          const notice = { level: event.level || "warning", message };
          const notices = [...(item.notices || []), notice]
            .filter((candidate, index, list) => list.findIndex((other) => other.message === candidate.message) === index)
            .slice(-2);
          return { ...item, notices, finalizing: notice.level === "error" ? false : item.finalizing };
        }
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
        if (event.type === "success") return { ...item, status: QUEUE_STATUS.done, progress: 100, files: event.files, stage: "Saved", finalizing: false };
        if (event.type === "error") return { ...item, status: QUEUE_STATUS.failed, error: consumerErrorMessage(event.error || ""), finalizing: false, notices: [] };
        return item;
      }));
    });
  }, [desktop, consumerErrorMessage, consumerNoticeMessage]);

  const totals = useMemo(() => ({
    ready: items.filter((item) => item.status === QUEUE_STATUS.ready).length,
    done: items.filter((item) => item.status === QUEUE_STATUS.done).length,
    failed: items.filter((item) => item.status === QUEUE_STATUS.failed).length,
  }), [items]);

  async function queueUrls(urls: string[], providerOverride: ProviderId | "auto" = selectedFetchProvider) {
    if (!urls.length || !desktop || !providerOverride) return;
    const provider = providerOverride;
    const initialPreset = provider === "auto" ? "" : defaultPresetForProvider(provider, providerOptions);
    const initialCookieSource = cookieSource;

    const existing = new Set(items.map((item) => item.url));
    const fresh = urls
      .filter((url) => !existing.has(url))
      .map((url) => ({ localId: crypto.randomUUID().slice(0, 10), url, status: QUEUE_STATUS.queued, preset: initialPreset, cookieSource: initialCookieSource }));

    if (!fresh.length) return;

    setItems((current) => [...fresh, ...current]);

    for (const item of fresh) {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.fetching } : candidate));
      try {
        const result = await desktop.fetch(item.url, provider, item.cookieSource);
        if (result.ok) {
          const resolvedProvider = result.metadata.provider || (provider === "auto" ? providerOptions[0]?.id : provider) || "";
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.ready, preset: defaultPresetForProvider(resolvedProvider, providerOptions), metadata: result.metadata, error: undefined } : candidate));
        } else {
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(result.error, consumerErrorMessage) } : candidate));
        }
      } catch (error) {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(error, consumerErrorMessage) } : candidate));
      }
    }
  }

  async function downloadReady() {
    const ready = items.filter((item) => item.status === QUEUE_STATUS.ready);
    if (!ready.length || busy || !desktop) return;
    setBusy(true);
    for (const item of ready) {
      const jobId = item.localId;
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.downloading, progress: 0, error: undefined, jobId, phase: undefined, phaseIndex: 0, finalizing: false, stage: undefined, notices: [] } : candidate));
      try {
        const response = await desktop.download({
          url: item.url,
          preset: item.preset,
          outputRoot,
          itemId: item.localId,
          title: item.metadata?.title || item.localId,
          cookieSource: item.cookieSource,
        });
        const result = response.result as { type?: string; files?: string[] } | undefined;
        if (result?.type === "success") {
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.done, progress: 100, files: result.files, stage: "Saved", jobId: response.jobId } : candidate));
        } else {
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, jobId: response.jobId } : candidate));
        }
      } catch (error) {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: consumerErrorMessage(error instanceof Error ? error.message : String(error)), notices: [] } : candidate));
      }
    }
    setBusy(false);
  }

  async function refetch(item: QueueItem) {
    if (!desktop) return;
    const provider = providerForItem(item, presetOptions, providerOptions);
    if (!provider) return;
    setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.fetching, error: undefined, notices: [] } : candidate));
    try {
      const result = await desktop.fetch(item.url, provider, item.cookieSource);
      if (result.ok) {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.ready, preset: defaultPresetForProvider(result.metadata.provider || provider, providerOptions), metadata: result.metadata, error: undefined } : candidate));
      } else {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(result.error, consumerErrorMessage) } : candidate));
      }
    } catch (error) {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(error, consumerErrorMessage) } : candidate));
    }
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.localId !== id));
  }

  function setItemPreset(id: string, preset: string) {
    setItems((current) => current.map((item) => item.localId === id ? { ...item, preset } : item));
  }

  function setItemCookieSource(id: string, source: CookieSource) {
    setItems((current) => current.map((item) => item.localId === id ? { ...item, cookieSource: source } : item));
  }

  return {
    items,
    busy,
    totals,
    queueUrls,
    downloadReady,
    refetch,
    removeItem,
    setItemPreset,
    setItemCookieSource,
  };
}
