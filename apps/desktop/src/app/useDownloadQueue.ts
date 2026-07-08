import { useEffect, useMemo, useState } from "react";
import type { CookieSource, DownloadEvent, PresetOption, ProviderId, ProviderOption } from "../types/desktop";
import type { DesktopClient } from "../client/desktopClient";
import { QUEUE_STATUS, queueItemCanChangeOutput, type QueueItem } from "./downloadQueueModel";
import { defaultPresetForProvider } from "./downloadQueuePrefs";

export type { QueueItem } from "./downloadQueueModel";
export { queueStatusLabels, queueItemProgress, queueItemStatusText, queueItemStatusParts } from "./downloadQueueModel";

const FETCH_PROVIDER = "auto" as const;

const FETCH_CONCURRENCY = 6;
const DOWNLOAD_CONCURRENCY = 3;

type UseDownloadQueueOptions = {
  desktop: DesktopClient | null;
  providerOptions: ProviderOption[];
  presetOptions: PresetOption[];
  cookieSource: CookieSource;
  outputRoot: string;
  fetchWorkerCount?: number;
  downloadWorkerCount?: number;
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
  if (item.status === QUEUE_STATUS.queued || item.status === QUEUE_STATUS.resolving || item.status === QUEUE_STATUS.failed) return true;
  return providers.find((provider) => provider.id === providerForItem(item, presets, providers))?.supportsBrowserAccess === true;
}

export function presetsForItem(item: QueueItem, presets: PresetOption[], providers: ProviderOption[]) {
  const provider = providerForItem(item, presets, providers);
  return presets.filter((preset) => preset.provider === provider);
}

function resolvePresetAfterFetch(
  item: QueueItem,
  resolvedProvider: ProviderId,
  presetOptions: PresetOption[],
  providerOptions: ProviderOption[],
): string {
  if (item.presetUserSet) return item.preset;
  const validPreset = Boolean(item.preset && presetOptions.some((p) => p.id === item.preset && p.provider === resolvedProvider));
  if (validPreset) return item.preset;
  return defaultPresetForProvider(resolvedProvider, providerOptions);
}

function workerCount(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value || fallback));
}

function isRefreshableStatus(status: QueueItem["status"]): boolean {
  return status === QUEUE_STATUS.ready || status === QUEUE_STATUS.failed || status === QUEUE_STATUS.resolving || status === QUEUE_STATUS.queued;
}

function isSiteRootUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

function fetchErrorMessage(error: unknown, consumerErrorMessage: (message: string, fallback?: string) => string, url?: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  if (/^Engine exited with code \d+$/i.test(message)) {
    return "Download failed before Rippo received details. Retry the source page or use Sniff page.";
  }
  if (url && isSiteRootUrl(url)) {
    return "This looks like a site homepage. Use Sniff page or paste a video page.";
  }
  return consumerErrorMessage(message, "Could not read this link. Try another link.");
}

async function runWithConcurrency<T>(values: T[], limit: number, worker: (value: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) {
      const current = values[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(workers);
}

export function useDownloadQueue({
  desktop,
  providerOptions,
  presetOptions,
  cookieSource,
  outputRoot,
  fetchWorkerCount,
  downloadWorkerCount,
  consumerErrorMessage,
  consumerNoticeMessage,
}: UseDownloadQueueOptions) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function refreshFullMetadata(item: QueueItem, provider: ProviderId | "auto") {
    if (!desktop || !item.metadata?.provisional) return;
    try {
      const result = await desktop.fetchFull(item.url, provider, item.cookieSource);
      if (!result.ok) {
        setItems((current) => current.map((candidate) => {
          if (candidate.localId !== item.localId || !candidate.metadata?.provisional || !isRefreshableStatus(candidate.status)) return candidate;
          return { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(result.error, consumerErrorMessage, item.url) };
        }));
        return;
      }
      setItems((current) => current.map((candidate) => {
        if (candidate.localId !== item.localId || !isRefreshableStatus(candidate.status)) return candidate;
        const resolvedProvider = result.metadata.provider || providerForItem(candidate, presetOptions, providerOptions);
        const nextPreset = resolvePresetAfterFetch(candidate, resolvedProvider, presetOptions, providerOptions);
        return { ...candidate, preset: nextPreset, metadata: result.metadata };
      }));
    } catch {
      undefined;
    }
  }

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
          return {
            ...item,
            progress: event.percent ?? item.progress,
            speed: event.speed ?? null,
            eta: event.eta ?? null,
            stage: event.speed ? `${event.speed}${event.eta ? `, ${event.eta} left` : ""}` : item.stage,
          };
        }
        if (event.type === "stage") {
          return {
            ...item,
            stage: event.message,
            speed: null,
            eta: null,
            finalizing: event.finalizing ? true : item.finalizing,
            progress: event.finalizing ? 100 : item.progress,
          };
        }
        if (event.type === "success") {
          return {
            ...item,
            status: QUEUE_STATUS.done,
            progress: 100,
            files: event.files,
            stage: "Saved",
            speed: null,
            eta: null,
            finalizing: false,
          };
        }
        if (event.type === "canceled") {
          return {
            ...item,
            status: QUEUE_STATUS.canceled,
            progress: undefined,
            stage: "Canceled",
            speed: null,
            eta: null,
            finalizing: false,
            notices: [],
          };
        }
        if (event.type === "error") return { ...item, status: QUEUE_STATUS.failed, error: fetchErrorMessage(event.error || "", consumerErrorMessage, item.url), finalizing: false, notices: [] };
        return item;
      }));
    });
  }, [desktop, consumerErrorMessage, consumerNoticeMessage]);

  const totals = useMemo(() => ({
    ready: items.filter((item) => item.status === QUEUE_STATUS.ready).length,
    downloading: items.filter((item) => item.status === QUEUE_STATUS.downloading).length,
    done: items.filter((item) => item.status === QUEUE_STATUS.done).length,
    interrupted: items.filter((item) => item.status === QUEUE_STATUS.failed || item.status === QUEUE_STATUS.canceled).length,
    failed: items.filter((item) => item.status === QUEUE_STATUS.failed).length,
    canceled: items.filter((item) => item.status === QUEUE_STATUS.canceled).length,
  }), [items]);

  function startSniff(url: string): string {
    const localId = crypto.randomUUID().slice(0, 10);
    setItems((current) => [{
      localId,
      url,
      status: QUEUE_STATUS.resolving,
      stage: "Sniffing page...",
      preset: "",
      cookieSource,
    }, ...current]);
    return localId;
  }

  function completeSniff(localId: string) {
    setItems((current) => current.filter((item) => item.localId !== localId));
  }

  function failSniff(localId: string, error: string) {
    setItems((current) => current.map((item) => (
      item.localId === localId
        ? { ...item, status: QUEUE_STATUS.failed, error, stage: undefined }
        : item
    )));
  }

  async function queueUrls(urls: string[], providerOverride: ProviderId | "auto" = FETCH_PROVIDER) {
    if (!urls.length || !desktop) return;
    const provider = providerOverride;
    const initialCookieSource = cookieSource;

    const seen = new Set(items.map((item) => item.url));
    const fresh: QueueItem[] = [];
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      fresh.push({ localId: crypto.randomUUID().slice(0, 10), url, status: QUEUE_STATUS.queued, preset: "", cookieSource: initialCookieSource, fetchProvider: provider });
    }

    if (!fresh.length) return;

    setItems((current) => [...fresh, ...current]);

    await runWithConcurrency(fresh, workerCount(fetchWorkerCount, FETCH_CONCURRENCY), async (item) => {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.resolving } : candidate));
      try {
        const result = await desktop.fetch(item.url, provider, item.cookieSource);
        if (result.ok) {
          const resolvedProvider = result.metadata.provider || (provider === "auto" ? providerOptions[0]?.id : provider) || "";
          setItems((current) => current.map((candidate) => {
            if (candidate.localId !== item.localId) return candidate;
            const nextPreset = resolvePresetAfterFetch(candidate, resolvedProvider, presetOptions, providerOptions);
            return { ...candidate, status: QUEUE_STATUS.ready, preset: nextPreset, metadata: result.metadata, error: undefined };
          }));
          void refreshFullMetadata({ ...item, metadata: result.metadata }, provider);
        } else {
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(result.error, consumerErrorMessage, item.url) } : candidate));
        }
      } catch (error) {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(error, consumerErrorMessage, item.url) } : candidate));
      }
    });
  }

  async function downloadReady() {
    const ready = items.filter((item) => item.status === QUEUE_STATUS.ready);
    if (!ready.length || busy || !desktop) return;
    setBusy(true);

    await runWithConcurrency(ready, workerCount(downloadWorkerCount, DOWNLOAD_CONCURRENCY), async (item) => {
      await startDownload(item);
    });
    setBusy(false);
  }

  // Resolve a usable preset. Items that never fetched successfully (e.g. a
  // provider that errored) keep preset: "" — sending that to the engine throws
  // `Unknown preset \`\``. Fall back to the provider's default preset, then the
  // first preset available for that provider.
  function effectivePreset(item: QueueItem): string {
    if (item.preset) return item.preset;
    const provider = providerForItem(item, presetOptions, providerOptions);
    const providerDefault = providerOptions.find((p) => p.id === provider)?.defaultPreset;
    if (providerDefault) return providerDefault;
    return presetsForItem(item, presetOptions, providerOptions)[0]?.id || presetOptions[0]?.id || "";
  }

  async function startDownload(item: QueueItem) {
    if (!desktop) return;
    const preset = effectivePreset(item);
    const jobId = item.localId;
    setItems((current) => current.map((candidate) => candidate.localId === item.localId ? {
      ...candidate,
      status: QUEUE_STATUS.downloading,
      progress: 0,
      error: undefined,
      jobId,
      phase: undefined,
      phaseIndex: 0,
      finalizing: false,
      stage: undefined,
      notices: [],
    } : candidate));
    try {
      const response = await desktop.download({
        url: item.url,
        preset,
        outputRoot,
        itemId: item.localId,
        title: item.metadata?.title || item.localId,
        cookieSource: item.cookieSource,
      });
      const result = response.result as { type?: string; files?: QueueItem["files"]; error?: string; message?: string } | undefined;
      if (result?.type === "success") {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.done, progress: 100, files: result.files, stage: "Saved", jobId: response.jobId } : candidate));
      } else if (result?.type === "canceled") {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.canceled, progress: undefined, stage: result.message || "Canceled", finalizing: false, jobId: response.jobId } : candidate));
      } else if (result?.type === "error") {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(result.error || "Download failed.", consumerErrorMessage, item.url), notices: [], finalizing: false, jobId: response.jobId } : candidate));
      } else {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, jobId: response.jobId } : candidate));
      }
    } catch (error) {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(error, consumerErrorMessage, item.url), notices: [] } : candidate));
    }
  }

  async function resumeDownload(item: QueueItem) {
    if (!desktop || item.status === QUEUE_STATUS.downloading || item.status === QUEUE_STATUS.resolving) return;
    await startDownload(item);
  }

  async function refetch(item: QueueItem) {
    if (!desktop) return;
    const provider = providerForItem(item, presetOptions, providerOptions);
    if (!provider) return;
    setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.resolving, error: undefined, notices: [] } : candidate));
    try {
      const result = await desktop.fetch(item.url, provider, item.cookieSource);
      if (result.ok) {
        setItems((current) => current.map((candidate) => {
          if (candidate.localId !== item.localId) return candidate;
          const resolvedProvider = result.metadata.provider || provider || "";
          const nextPreset = resolvePresetAfterFetch(candidate, resolvedProvider, presetOptions, providerOptions);
          return { ...candidate, status: QUEUE_STATUS.ready, preset: nextPreset, metadata: result.metadata, error: undefined };
        }));
        void refreshFullMetadata({ ...item, metadata: result.metadata }, provider);
      } else {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(result.error, consumerErrorMessage, item.url) } : candidate));
      }
    } catch (error) {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: fetchErrorMessage(error, consumerErrorMessage, item.url) } : candidate));
    }
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.localId !== id));
  }

  async function cancelDownload(item: QueueItem) {
    if (!desktop || item.status !== QUEUE_STATUS.downloading || !item.jobId) return;
    setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, stage: "Canceling...", finalizing: false } : candidate));
    const result = await desktop.cancelDownload(item.jobId);
    if (!result.ok) {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: QUEUE_STATUS.failed, error: result.error || "Could not cancel this download.", finalizing: false } : candidate));
    }
  }

  async function cancelActiveDownloads() {
    const active = items.filter((item) => item.status === QUEUE_STATUS.downloading && item.jobId);
    await Promise.all(active.map((item) => cancelDownload(item)));
  }

  async function resumeInterrupted() {
    const interrupted = items.filter((item) => item.status === QUEUE_STATUS.failed || item.status === QUEUE_STATUS.canceled);
    await runWithConcurrency(interrupted, workerCount(downloadWorkerCount, DOWNLOAD_CONCURRENCY), async (item) => {
      await startDownload(item);
    });
  }

  function setItemPreset(id: string, preset: string) {
    setItems((current) => current.map((item) => item.localId === id ? { ...item, preset, presetUserSet: true } : item));
  }

  function bulkSetPreset(ids: Iterable<string>, preset: string) {
    const idSet = new Set(ids);
    setItems((current) => current.map((item) => (idSet.has(item.localId) && queueItemCanChangeOutput(item) ? { ...item, preset, presetUserSet: true } : item)));
  }

  function setItemCookieSource(id: string, source: CookieSource) {
    setItems((current) => current.map((item) => item.localId === id ? { ...item, cookieSource: source } : item));
  }

  return {
    items,
    busy,
    totals,
    startSniff,
    completeSniff,
    failSniff,
    queueUrls,
    downloadReady,
    startDownload,
    refetch,
    removeItem,
    cancelDownload,
    cancelActiveDownloads,
    resumeDownload,
    resumeInterrupted,
    setItemPreset,
    setItemCookieSource,
    bulkSetPreset,
  };
}
