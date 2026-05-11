import { Cookie, Download, ExternalLink, FolderOpen, FolderSearch, ImageOff, Link2, Loader2, RefreshCcw, RotateCcw, Search, Settings, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BrowserInfo, CookieSource, DownloadEvent, EngineHealth, FetchResponse, GalleryDlUpdateInfo, OpenRouterModelCatalog, PresetOption, ProviderId, ProviderOption, SourceSearchPack, SourceSearchResponse, SourceSearchResult, YtDlpUpdateInfo } from "../../electron/types";
import { extractUrls } from "./urlParser";

type QueueItem = {
  localId: string;
  url: string;
  status: "queued" | "fetching" | "ready" | "downloading" | "done" | "failed";
  preset: string;
  metadata?: Extract<FetchResponse, { ok: true }>["metadata"];
  error?: string;
  progress?: number;
  stage?: string;
  phase?: string;
  phaseIndex?: number;
  finalizing?: boolean;
  files?: string[];
  jobId?: string;
  notices?: { level: "warning" | "error"; message: string }[];
  cookieSource: CookieSource;
};

type ComposerAction = {
  id: "idle" | "search" | "fetch";
  label: string;
  busyLabel: string;
  hint: string;
  icon: "search" | "none";
  disabled: boolean;
  countSuffix?: string;
};

const AUTO_PROVIDER = "auto";
const COOKIE_OFF: CookieSource = { mode: "off" };
const DEFAULT_SOURCE_PACKS: SourceSearchPack[] = [
  { id: "all", label: "All" },
  { id: "movies", label: "Movies and shows" },
  { id: "starter", label: "Best starting points" },
  { id: "public", label: "Public archives" },
  { id: "stock", label: "Free stock media" },
  { id: "tools", label: "Media tools" },
];
const EMPTY_SOURCE_SEARCH: SourceSearchResponse = {
  ok: false,
  query: "",
  pack: "all",
  packs: DEFAULT_SOURCE_PACKS,
  results: [],
};

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

function providerForItem(item: QueueItem, presets: PresetOption[], providers: ProviderOption[]): ProviderId {
  return item.metadata?.provider || presets.find((preset) => preset.id === item.preset)?.provider || providers[0]?.id || "";
}

function itemSupportsBrowserAccess(item: QueueItem, presets: PresetOption[], providers: ProviderOption[]): boolean {
  return item.status === "queued" || item.status === "fetching" || item.status === "failed" || providerForItem(item, presets, providers) === "yt-dlp";
}

function defaultPresetForProvider(provider: ProviderId, providers: ProviderOption[]): string {
  return providers.find((option) => option.id === provider)?.defaultPreset || providers[0]?.defaultPreset || "";
}

function presetsForItem(item: QueueItem, presets: PresetOption[], providers: ProviderOption[]) {
  const provider = providerForItem(item, presets, providers);
  return presets.filter((preset) => preset.provider === provider);
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

function sourceOpenUrl(source: SourceSearchResult): string {
  return source.openUrl || source.url;
}

function sourceActionLabel(source: SourceSearchResult): string {
  return source.actionLabel || (sourceOpenUrl(source) !== source.url ? "Search" : "Open");
}

function sourceStatusLabel(search: SourceSearchResponse, busy: boolean): string {
  if (busy) return "Searching live sources...";
  const actual = search.actualResultCount ?? search.results.filter((result) => result.resultKind === "item").length;
  const routes = search.routeResultCount ?? search.results.filter((result) => result.resultKind !== "item").length;
  if (actual > 0 && routes > 0) return `${actual} results · ${routes} source routes`;
  if (actual > 0) return `${actual} results`;
  return `${routes || search.results.length} source routes`;
}

function sourceBadgeLabel(source: SourceSearchResult): string {
  if (source.resultKind === "item") return `${source.sourceName || source.packLabel} result`;
  return "source route";
}

function sourceContextLabel(search: SourceSearchResponse, input: string): string {
  const intelligence = search.intelligence;
  if (intelligence?.enabled && intelligence.pack !== "all") {
    const evidence = intelligence.webEvidence;
    const evidenceCount = evidence?.resultCount ?? evidence?.results?.length ?? 0;
    if (evidence?.enabled && evidenceCount > 0) {
      return `AI routed to ${intelligence.packLabel} from ${evidence.label || evidence.source || "web evidence"}`;
    }
    return `AI routed to ${intelligence.packLabel}`;
  }
  return search.query || input.trim() || "search";
}

function searchEvidenceText(health: EngineHealth | null): string {
  const evidence = health?.searchEvidence;
  if (evidence?.configured && evidence.available === false) return `${evidence.label || evidence.provider || "Web context"} unavailable`;
  if (evidence?.configured) return evidence.label || evidence.provider || "Configured";
  return "No web context";
}

function updaterErrorMessage(error: unknown, tool: "yt-dlp" | "gallery-dl"): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("No handler registered") || message.includes("is not a function")) {
    return `Restart Rippopotamus to load the ${tool} updater.`;
  }
  return message;
}

function cookieSourceValue(source: CookieSource | null | undefined): string {
  return source?.mode === "browser" ? `browser:${source.browserId}` : "off";
}

function cookieSourceFromValue(value: string): CookieSource {
  if (value.startsWith("browser:")) return { mode: "browser", browserId: value.slice("browser:".length) };
  return COOKIE_OFF;
}

function cookieSourceFromResponse(source: CookieSource | undefined, selected: string | null | undefined): CookieSource {
  if (source) return source;
  return selected ? { mode: "browser", browserId: selected } : COOKIE_OFF;
}

function browserAccessLabel(source: CookieSource, browsers: BrowserInfo[]): string {
  if (source.mode === "off") return "No login";
  const browser = browsers.find((candidate) => candidate.id === source.browserId);
  return browser ? `${browser.label} login` : "Browser login";
}

function fetchErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  return consumerErrorMessage(message, "Could not read this link. Try another link.");
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

  if (/unsupported url/i.test(cleaned)) {
    return "This link is not supported yet.";
  }
  if (lower.includes("restart rippopotamus") && lower.includes("updater")) {
    return "Restart Rippopotamus to load the update tool.";
  }
  if (lower.includes("requested format is not available") || lower.includes("selected format is not available")) {
    return "This link does not have that format. Choose another format and try again.";
  }
  if (lower.includes("status=500") || lower.includes("response status is not successful") || lower.includes("source is having trouble")) {
    return "The source is having trouble right now. Try again later or use another link.";
  }
  if (lower.includes("download aborted") || lower.includes("download stopped before it finished")) {
    return "The download stopped before it finished. Try again later or use another link.";
  }
  if (lower.includes("dht routing table") || lower.includes("routing cache")) {
    return "The download needs a retry before it can start.";
  }
  if (lower.includes("http error 403") || lower.includes("access denied") || lower.includes("forbidden")) {
    return "This source blocked the download. Try browser login or another link.";
  }
  if (lower.includes("http error 404") || lower.includes("not found")) {
    return "This source is no longer available.";
  }
  if (lower.includes("missing required command") && lower.includes("aria2")) {
    return "Torrent support is not installed yet.";
  }
  if (lower.includes("qbittorrent") || lower.includes("torrent support needs")) {
    return "Torrent support is not installed yet.";
  }
  if (lower.includes("missing") && lower.includes("gallery-dl")) {
    return "Image support is not installed yet.";
  }
  if (lower.includes("missing") && lower.includes("yt-dlp")) {
    return "Video support is not installed yet.";
  }
  if (!cleaned || TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return fallback;
  }
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function consumerNoticeMessage(message: string): string | null {
  const cleaned = message.trim();
  const lower = cleaned.toLowerCase();
  if (!cleaned) return null;
  if (
    lower.includes("fresh torrent routing cache") ||
    lower.includes("torrent source returned an error") ||
    lower.includes("retrying if possible") ||
    lower.includes("dht routing table") ||
    lower.includes("status=500") ||
    lower.includes("download aborted") ||
    TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(cleaned))
  ) {
    return null;
  }
  return consumerErrorMessage(cleaned, "");
}

function ytDlpStatusText(health: EngineHealth | null, healthError: string | null): string {
  if (health?.ytDlp) return "Ready";
  if (healthError) return "Unavailable";
  return "Checking...";
}

function ytDlpPathText(update: YtDlpUpdateInfo | null, health: EngineHealth | null): string {
  if (update?.binaryPath || health?.ytDlpPath || health?.ytDlp) return "Ready to save videos and audio.";
  return "Install video support from here.";
}

function galleryDlStatusText(health: EngineHealth | null, healthError: string | null): string {
  if (health?.galleryDl) return "Ready";
  if (health?.galleryDlOk === false) return "Missing";
  if (healthError) return "Unavailable";
  return "Checking...";
}

function galleryDlPathText(update: GalleryDlUpdateInfo | null, health: EngineHealth | null): string {
  if (update?.binaryPath || health?.galleryDlPath || health?.galleryDl) return "Ready to save image galleries.";
  return "Install image support from here.";
}

function aria2cStatusText(health: EngineHealth | null, healthError: string | null): string {
  if (health?.torrentOk) return "Ready";
  if (health?.torrentOk === false) return "Missing";
  if (healthError) return "Unavailable";
  return "Checking...";
}

function aria2cPathText(health: EngineHealth | null): string {
  if (health?.torrentEngine === "qbittorrent") return "Ready with enhanced torrent support.";
  if (health?.torrentEngine === "aria2c") return "Ready to save magnet links and torrent files.";
  return "Install torrent support to save magnet links and torrent files.";
}

function openRouterModelText(catalog: OpenRouterModelCatalog | null, health: EngineHealth | null): string {
  if (catalog?.selectedModel) return catalog.selectedModel;
  return health?.openRouterModel || "openrouter/free";
}

function openRouterKeyText(catalog: OpenRouterModelCatalog | null, health: EngineHealth | null): string {
  const present = catalog?.apiKeyPresent ?? health?.openRouterKeyPresent;
  return present ? "Key connected" : "Set OPENROUTER_API_KEY";
}

function resolveComposerAction({
  hasText,
  urlCount,
  canUseDesktop,
  hasProvider,
  searchBusy,
}: {
  hasText: boolean;
  urlCount: number;
  canUseDesktop: boolean;
  hasProvider: boolean;
  searchBusy: boolean;
}): ComposerAction {
  if (!hasText) {
    return {
      id: "idle",
      label: "Go",
      busyLabel: "Working",
      hint: "Paste or type first",
      icon: "none",
      disabled: true,
    };
  }

  if (urlCount > 0) {
    return {
      id: "fetch",
      label: "Fetch",
      busyLabel: "Fetching",
      hint: "fetch",
      icon: "none",
      disabled: !canUseDesktop || !hasProvider,
      countSuffix: urlCount > 1 ? ` ${urlCount}` : "",
    };
  }

  return {
    id: "search",
    label: "Search",
    busyLabel: "Searching",
    hint: "search",
    icon: "search",
    disabled: !canUseDesktop || searchBusy,
  };
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

    window.rippo.loadThumbnail(urls).then((result) => {
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

  if (loading) {
    return <Loader2 className="thumb-spinner" size={26} strokeWidth={1.8} aria-hidden />;
  }

  if (failed || !src) {
    return <ImageOff size={28} strokeWidth={1.5} aria-hidden />;
  }

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

export function App() {
  const rippo = window.rippo;
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [activeSourcePack, setActiveSourcePack] = useState("all");
  const [sourceSearch, setSourceSearch] = useState<SourceSearchResponse>(EMPTY_SOURCE_SEARCH);
  const [sourceSearchBusy, setSourceSearchBusy] = useState(false);
  const [fetchProvider, setFetchProvider] = useState<ProviderId | typeof AUTO_PROVIDER>(AUTO_PROVIDER);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [outputRoot, setOutputRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([]);
  const [cookieSource, setCookieSource] = useState<CookieSource>(COOKIE_OFF);
  const [ytDlpUpdate, setYtDlpUpdate] = useState<YtDlpUpdateInfo | null>(null);
  const [ytDlpStatus, setYtDlpStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [ytDlpError, setYtDlpError] = useState<string | null>(null);
  const [galleryDlUpdate, setGalleryDlUpdate] = useState<GalleryDlUpdateInfo | null>(null);
  const [galleryDlStatus, setGalleryDlStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [galleryDlError, setGalleryDlError] = useState<string | null>(null);
  const [aiCatalog, setAiCatalog] = useState<OpenRouterModelCatalog | null>(null);
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "saving">("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen || !rippo || typeof rippo.listAiModels !== "function" || aiCatalog) return;
    void loadAiModels(false);
  }, [settingsOpen, rippo, aiCatalog]);

  useEffect(() => {
    if (!rippo) return;
    rippo.listBrowsers().then((result) => {
      setBrowsers(result.browsers);
      setCookieSource(cookieSourceFromResponse(result.source, result.selected));
    }).catch(() => undefined);
  }, [rippo]);

  async function changeDefaultCookieSource(value: string) {
    if (!rippo) return;
    const next = cookieSourceFromValue(value);
    const result = typeof rippo.setDefaultCookieSource === "function"
      ? await rippo.setDefaultCookieSource(next)
      : await rippo.setCookiesBrowser(next.mode === "browser" ? next.browserId : null);
    setCookieSource(cookieSourceFromResponse(result.source, result.selected));
    try {
      const nextHealth = await rippo.health();
      setHealth(nextHealth);
    } catch {
      undefined;
    }
  }

  async function chooseOutputRoot() {
    if (!rippo) return;
    try {
      const result = await rippo.chooseOutputRoot();
      if (!result.canceled) setOutputRoot(result.outputRoot);
    } catch {
      undefined;
    }
  }

  async function resetOutputRoot() {
    if (!rippo) return;
    try {
      const result = await rippo.resetOutputRoot();
      setOutputRoot(result.outputRoot);
    } catch {
      undefined;
    }
  }

  async function loadAiModels(refresh: boolean) {
    if (!rippo || typeof rippo.listAiModels !== "function" || aiStatus !== "idle") return;
    setAiStatus("loading");
    setAiError(null);
    try {
      const result = await rippo.listAiModels(refresh);
      setAiCatalog(result);
      if (result.error) setAiError(result.error);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiStatus("idle");
    }
  }

  async function changeAiModel(modelId: string) {
    if (!rippo || typeof rippo.setAiModel !== "function") return;
    setAiStatus("saving");
    setAiError(null);
    try {
      const result = await rippo.setAiModel(modelId);
      setHealth(result.health);
      setAiCatalog(result.catalog);
      if (result.catalog.error) setAiError(result.catalog.error);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiStatus("idle");
    }
  }

  async function checkYtDlpUpdate() {
    if (!rippo || ytDlpStatus !== "idle") return;
    if (typeof rippo.checkYtDlpUpdate !== "function") {
      setYtDlpError("Restart Rippopotamus to load the yt-dlp updater.");
      return;
    }
    setYtDlpStatus("checking");
    setYtDlpError(null);
    try {
      const result = await rippo.checkYtDlpUpdate();
      setYtDlpUpdate(result);
    } catch (error) {
      setYtDlpError(updaterErrorMessage(error, "yt-dlp"));
    } finally {
      setYtDlpStatus("idle");
    }
  }

  async function updateYtDlp() {
    if (!rippo || ytDlpStatus !== "idle") return;
    if (typeof rippo.updateYtDlp !== "function") {
      setYtDlpError("Restart Rippopotamus to load the yt-dlp updater.");
      return;
    }
    setYtDlpStatus("updating");
    setYtDlpError(null);
    try {
      const result = await rippo.updateYtDlp();
      setYtDlpUpdate(result);
      setHealth(result.health);
    } catch (error) {
      setYtDlpError(updaterErrorMessage(error, "yt-dlp"));
    } finally {
      setYtDlpStatus("idle");
    }
  }

  async function checkGalleryDlUpdate() {
    if (!rippo || galleryDlStatus !== "idle") return;
    if (typeof rippo.checkGalleryDlUpdate !== "function") {
      setGalleryDlError("Restart Rippopotamus to load the gallery-dl updater.");
      return;
    }
    setGalleryDlStatus("checking");
    setGalleryDlError(null);
    try {
      const result = await rippo.checkGalleryDlUpdate();
      setGalleryDlUpdate(result);
    } catch (error) {
      setGalleryDlError(updaterErrorMessage(error, "gallery-dl"));
    } finally {
      setGalleryDlStatus("idle");
    }
  }

  async function updateGalleryDl() {
    if (!rippo || galleryDlStatus !== "idle") return;
    if (typeof rippo.updateGalleryDl !== "function") {
      setGalleryDlError("Restart Rippopotamus to load the gallery-dl updater.");
      return;
    }
    setGalleryDlStatus("updating");
    setGalleryDlError(null);
    try {
      const result = await rippo.updateGalleryDl();
      setGalleryDlUpdate(result);
      setHealth(result.health);
    } catch (error) {
      setGalleryDlError(updaterErrorMessage(error, "gallery-dl"));
    } finally {
      setGalleryDlStatus("idle");
    }
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [input]);

  const inputUrls = useMemo(() => extractUrls(input), [input]);
  const detectedCount = inputUrls.length;
  const hasComposerText = input.trim().length > 0;
  const sourcePacks = useMemo(() => {
    const packs = [...DEFAULT_SOURCE_PACKS, ...sourceSearch.packs];
    return packs.filter((pack, index, list) => list.findIndex((candidate) => candidate.id === pack.id) === index);
  }, [sourceSearch.packs]);
  const providerOptions = health?.providers || [];
  const presetOptions = health?.presets || [];
  const selectedFetchProvider = fetchProvider || AUTO_PROVIDER;
  const composerAction = useMemo(() => resolveComposerAction({
    hasText: hasComposerText,
    urlCount: detectedCount,
    canUseDesktop: Boolean(rippo),
    hasProvider: Boolean(selectedFetchProvider),
    searchBusy: sourceSearchBusy,
  }), [detectedCount, hasComposerText, rippo, selectedFetchProvider, sourceSearchBusy]);

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
    if (!providerOptions.length) return;
    setFetchProvider((current) => current === AUTO_PROVIDER || providerOptions.some((provider) => provider.id === current) ? current : AUTO_PROVIDER);
  }, [providerOptions]);

  useEffect(() => {
    if (detectedCount > 0 && sourceSearch.query) setSourceSearch(EMPTY_SOURCE_SEARCH);
  }, [detectedCount, sourceSearch.query]);

  useEffect(() => {
    if (!rippo) return undefined;
    return rippo.onDownloadEvent((event: DownloadEvent) => {
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
        if (event.type === "success") return { ...item, status: "done", progress: 100, files: event.files, stage: "Saved", finalizing: false };
        if (event.type === "error") return { ...item, status: "failed", error: consumerErrorMessage(event.error || ""), finalizing: false, notices: [] };
        return item;
      }));
    });
  }, [rippo]);

  const totals = useMemo(() => ({
    ready: items.filter((item) => item.status === "ready").length,
    done: items.filter((item) => item.status === "done").length,
    failed: items.filter((item) => item.status === "failed").length,
  }), [items]);

  async function queueUrls(urls: string[], providerOverride: ProviderId | typeof AUTO_PROVIDER = selectedFetchProvider) {
    if (!urls.length || !rippo || !providerOverride) return;
    const provider = providerOverride;
    const initialPreset = provider === AUTO_PROVIDER ? "" : defaultPresetForProvider(provider, providerOptions);
    const initialCookieSource = cookieSource;

    const existing = new Set(items.map((item) => item.url));
    const fresh = urls
      .filter((url) => !existing.has(url))
      .map((url) => ({ localId: crypto.randomUUID().slice(0, 10), url, status: "queued" as const, preset: initialPreset, cookieSource: initialCookieSource }));

    if (!fresh.length) return;

    setItems((current) => [...fresh, ...current]);

    for (const item of fresh) {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "fetching" } : candidate));
      try {
        const result = await rippo.fetch(item.url, provider, item.cookieSource);
        if (result.ok) {
          const resolvedProvider = result.metadata.provider || (provider === AUTO_PROVIDER ? providerOptions[0]?.id : provider) || "";
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "ready", preset: defaultPresetForProvider(resolvedProvider, providerOptions), metadata: result.metadata, error: undefined } : candidate));
        } else {
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "failed", error: fetchErrorMessage(result.error) } : candidate));
        }
      } catch (error) {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "failed", error: fetchErrorMessage(error) } : candidate));
      }
    }
  }

  async function addAndFetch() {
    const urls = inputUrls;
    if (!urls.length) return;
    setInput("");
    setSourceSearch(EMPTY_SOURCE_SEARCH);
    await queueUrls(urls);
  }

  function openSourceResult(source: SourceSearchResult) {
    const url = sourceOpenUrl(source);
    if (rippo) rippo.openExternal(url).catch(() => undefined);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  async function searchSources() {
    const query = input.trim().slice(0, 120);
    if (!query || !rippo || typeof rippo.searchSources !== "function") {
      setSourceSearch({
        ...EMPTY_SOURCE_SEARCH,
        query,
        pack: activeSourcePack,
        error: "Source search runs inside the desktop app.",
      });
      return;
    }

    setSourceSearchBusy(true);
    try {
      const result = await rippo.searchSources(query, activeSourcePack);
      setSourceSearch(result);
    } catch (error) {
      setSourceSearch({
        ...EMPTY_SOURCE_SEARCH,
        query,
        pack: activeSourcePack,
        error: consumerErrorMessage(error instanceof Error ? error.message : String(error), "Could not search sources."),
      });
    } finally {
      setSourceSearchBusy(false);
    }
  }

  async function runComposerAction() {
    if (composerAction.id === "search") {
      await searchSources();
      return;
    }
    if (composerAction.id === "fetch") await addAndFetch();
  }

  async function downloadReady() {
    const ready = items.filter((item) => item.status === "ready");
    if (!ready.length || busy || !rippo) return;
    setBusy(true);
    for (const item of ready) {
      const jobId = item.localId;
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "downloading", progress: 0, error: undefined, jobId, phase: undefined, phaseIndex: 0, finalizing: false, stage: undefined, notices: [] } : candidate));
      try {
        const response = await rippo.download({
          url: item.url,
          preset: item.preset,
          outputRoot,
          itemId: item.localId,
          title: item.metadata?.title || item.localId,
          cookieSource: item.cookieSource,
        });
        const result = response.result as { type?: string; files?: string[] } | undefined;
        if (result?.type === "success") {
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "done", progress: 100, files: result.files, stage: "Saved", jobId: response.jobId } : candidate));
        } else {
          setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, jobId: response.jobId } : candidate));
        }
      } catch (error) {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "failed", error: consumerErrorMessage(error instanceof Error ? error.message : String(error)), notices: [] } : candidate));
      }
    }
    setBusy(false);
  }

  async function refetch(item: QueueItem) {
    if (!rippo) return;
    const provider = providerForItem(item, presetOptions, providerOptions);
    if (!provider) return;
    setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "fetching", error: undefined, notices: [] } : candidate));
    try {
      const result = await rippo.fetch(item.url, provider, item.cookieSource);
      if (result.ok) {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "ready", preset: defaultPresetForProvider(result.metadata.provider || provider, providerOptions), metadata: result.metadata, error: undefined } : candidate));
      } else {
        setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "failed", error: fetchErrorMessage(result.error) } : candidate));
      }
    } catch (error) {
      setItems((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, status: "failed", error: fetchErrorMessage(error) } : candidate));
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
              <button
                type="button"
                className="settings-btn"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                title="Settings"
              >
                <Settings size={18} strokeWidth={2} aria-hidden />
              </button>
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
                    runComposerAction();
                  }
                }}
                placeholder="Paste link(s) or search…"
                rows={1}
                aria-label="Links or search text"
              />
              <div className="composer-foot">
                <div className="composer-tools">
                  {composerAction.id === "search" ? (
                    <div className="pack-select-wrap">
                      <select
                        className="provider-select"
                        value={activeSourcePack}
                        onChange={(event) => setActiveSourcePack(event.target.value)}
                        aria-label="Search area"
                      >
                        {sourcePacks.map((pack) => (
                          <option key={pack.id} value={pack.id}>{pack.label}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <select
                      className="provider-select"
                      value={selectedFetchProvider}
                      onChange={(event) => setFetchProvider(event.target.value as ProviderId | typeof AUTO_PROVIDER)}
                      disabled={!providerOptions.length}
                      aria-label="Source type"
                    >
                      {providerOptions.length === 0 ? <option value="">Loading</option> : null}
                      {providerOptions.length > 0 ? <option value={AUTO_PROVIDER}>Auto</option> : null}
                      {providerOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  )}
                  {detectedCount > 1 ? <span className="link-count">{detectedCount} links</span> : <span className="composer-hint">⌘↵ to {composerAction.hint}</span>}
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-fetch"
                  onClick={runComposerAction}
                  disabled={composerAction.disabled}
                >
                  {sourceSearchBusy && composerAction.id === "search" ? <Loader2 className="spin" size={15} strokeWidth={2} aria-hidden /> : composerAction.icon === "search" ? <Search size={15} strokeWidth={2} aria-hidden /> : null}
                  {sourceSearchBusy && composerAction.id === "search" ? composerAction.busyLabel : `${composerAction.label}${composerAction.countSuffix || ""}`}
                </button>
              </div>
            </div>
          </div>
          <div className="hero-gradient" />
        </header>

        <section className="workspace">
          {healthError ? <p className="error-text">{healthError}</p> : null}
          {(sourceSearch.query || sourceSearch.results.length > 0 || sourceSearch.error || sourceSearchBusy) ? (
            <div className="search-panel">
              <div className="search-status">
                <span>{sourceStatusLabel(sourceSearch, sourceSearchBusy)}</span>
                <span>{sourceContextLabel(sourceSearch, input)}</span>
              </div>
              {sourceSearch.error ? <p className="error-text">{sourceSearch.error}</p> : null}
              <div className="source-results">
                {sourceSearch.results.map((source) => (
                  <article key={source.id} className="source-card">
                    <div className="source-main">
                      <div className="source-head">
                        <span className="source-pack-label">{source.packLabel}</span>
                        <h3 className="source-title">{source.title}</h3>
                      </div>
                      <p className="source-desc">{source.description}</p>
                      <div className="source-tags">
                        <span className="source-badge">{sourceBadgeLabel(source)}</span>
                        {source.mediaTypes.slice(0, 4).map((type) => <span key={type} className="source-tag">{type}</span>)}
                      </div>
                      {source.usage ? <p className="source-note">{source.usage}</p> : null}
                    </div>
                    <div className="source-actions">
                      <button type="button" className="btn btn-primary btn-source" onClick={() => openSourceResult(source)}>
                        <ExternalLink size={14} strokeWidth={2} aria-hidden /> {sourceActionLabel(source)}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {items.length > 0 && (
            <p className="queue-summary">{items.length} · {totals.ready} ready · {totals.done} saved{totals.failed ? ` · ${totals.failed} failed` : ""}</p>
          )}
          {items.length === 0 && !sourceSearch.query && !sourceSearch.results.length && !sourceSearch.error && !sourceSearchBusy ? (
            <div className="empty">Paste a link or search anything.</div>
          ) : (
            items.map((item) => {
              const itemPresets = presetsForItem(item, presetOptions, providerOptions);
              const progress = item.status === "downloading" ? Math.max(2, Math.round(item.progress || 0)) : null;
              let statusText: string;
              if (item.status === "downloading") {
                if (item.finalizing) statusText = item.stage || "Finalizing…";
                else if (item.phase) statusText = `${item.phase} · ${progress}%`;
                else statusText = `${progress}%`;
              } else {
                statusText = statusLabels[item.status];
              }
              const showBrowserAccess = browsers.length > 0 && itemSupportsBrowserAccess(item, presetOptions, providerOptions);
              const visibleNotices = item.error ? [] : (item.notices || []).flatMap((notice) => {
                const message = consumerNoticeMessage(notice.message);
                return message ? [{ ...notice, message }] : [];
              });
              return (
                <article key={item.localId} className={`queue-item ${item.status}`}>
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
                          disabled={item.status === "downloading" || item.status === "done"}
                          aria-label="Output format"
                          title={presetOptions.find((p) => p.id === item.preset)?.detail}
                        >
                          {itemPresets.map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      {showBrowserAccess ? (
                        <div className="access-chip" title={browserAccessLabel(item.cookieSource, browsers)}>
                          <select
                            value={cookieSourceValue(item.cookieSource)}
                            onChange={(event) => setItemCookieSource(item.localId, cookieSourceFromValue(event.target.value))}
                            disabled={item.status === "downloading" || item.status === "done"}
                            aria-label="Private-site access"
                          >
                            <option value="off">No login</option>
                            {browsers.map((browser) => (
                              <option key={browser.id} value={`browser:${browser.id}`}>{browser.label} login</option>
                            ))}
                          </select>
                        </div>
                      ) : null}
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
          <div className="footer-row footer-meta">
            <p className="footer-path" title={outputRoot || undefined}>{outputRoot || "Set output when engine connects."}</p>
          </div>
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
      {settingsOpen ? (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-panel" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
            <div className="settings-head">
              <h2 className="settings-title">Settings</h2>
              <button type="button" className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close settings" title="Close">
                <X size={16} strokeWidth={2} aria-hidden />
              </button>
            </div>

            <section className="settings-section">
              <div className="settings-row-head">
                <FolderOpen size={14} strokeWidth={2} aria-hidden />
                <h3 className="settings-row-title">Download location</h3>
              </div>
              <p className="settings-hint settings-path-display" title={outputRoot || undefined}>
                {outputRoot || "Will use ~/Downloads/Rippo"}
              </p>
              <div className="settings-actions">
                <button type="button" className="btn btn-primary btn-footer" onClick={chooseOutputRoot} disabled={!rippo}>
                  <FolderSearch size={14} strokeWidth={2} aria-hidden /> Choose…
                </button>
                <button type="button" className="btn btn-ghost btn-footer" onClick={resetOutputRoot} disabled={!rippo} title="Reset to ~/Downloads/Rippo">
                  <RotateCcw size={14} strokeWidth={2} aria-hidden /> Default
                </button>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-row-head">
                <Search size={14} strokeWidth={2} aria-hidden />
                <h3 className="settings-row-title">Search routing</h3>
                <span className="settings-version">{openRouterKeyText(aiCatalog, health)}</span>
              </div>
              <p className="settings-hint">Search-result context is read first when configured; OpenRouter then routes to the right source adapters.</p>
              <p className="settings-hint">Web context: {searchEvidenceText(health)}</p>
              <select
                className="settings-select"
                value={openRouterModelText(aiCatalog, health)}
                onChange={(event) => changeAiModel(event.target.value)}
                disabled={!rippo || aiStatus !== "idle"}
                aria-label="OpenRouter routing model"
              >
                {(aiCatalog?.models?.length ? aiCatalog.models : [{ id: openRouterModelText(aiCatalog, health), name: openRouterModelText(aiCatalog, health) }]).map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
              <div className="settings-actions">
                <button type="button" className="btn btn-ghost btn-footer" onClick={() => loadAiModels(true)} disabled={!rippo || aiStatus !== "idle"}>
                  {aiStatus === "loading" ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <RefreshCcw size={14} strokeWidth={2} aria-hidden />}
                  Refresh free models
                </button>
              </div>
              <p className="settings-hint">
                {aiCatalog?.models?.length ? `${aiCatalog.models.length} free text models cached. Selected: ${openRouterModelText(aiCatalog, health)}` : `Selected: ${openRouterModelText(aiCatalog, health)}`}
              </p>
              {aiError ? <p className="settings-warning">{consumerErrorMessage(aiError, "Could not refresh OpenRouter models.")}</p> : null}
            </section>

            <section className="settings-section">
              <div className="settings-row-head">
                <Cookie size={14} strokeWidth={2} aria-hidden />
                <h3 className="settings-row-title">Private sites</h3>
              </div>
              <p className="settings-hint">Choose a browser only for links that need your signed-in access. Cookies stay on this Mac.</p>
              <select
                className="settings-select"
                value={cookieSourceValue(cookieSource)}
                onChange={(event) => changeDefaultCookieSource(event.target.value)}
                disabled={!rippo}
                aria-label="Default private-site access"
              >
                <option value="off">No login</option>
                {browsers.map((browser) => (
                  <option key={browser.id} value={`browser:${browser.id}`}>Use {browser.label} login</option>
                ))}
              </select>
              {!browsers.length ? <p className="settings-hint">No supported browser was found.</p> : null}
              {health?.cookies?.status === "error" ? (
                <p className="settings-warning" title={health.cookies.message || undefined}>Browser login failed — {health.cookies.message}</p>
              ) : null}
            </section>

            <section className="settings-section">
              <div className="settings-row-head">
                <Download size={14} strokeWidth={2} aria-hidden />
                <h3 className="settings-row-title">Download support</h3>
              </div>
              <div className="settings-engine-list">
                <div className="settings-engine-row">
                  <div className="settings-engine-copy">
                    <p className="settings-engine-name">Video</p>
                    <p className="settings-hint">Videos and audio</p>
                  </div>
                  <span className="settings-version">{ytDlpStatusText(health, healthError)}</span>
                </div>
                <p className="settings-hint" title={ytDlpUpdate?.binaryPath || health?.ytDlpPath || undefined}>
                  {ytDlpPathText(ytDlpUpdate, health)}
                </p>
                <div className="settings-actions">
                  {ytDlpUpdate?.updateAvailable ? (
                    <button type="button" className="btn btn-primary btn-footer" onClick={updateYtDlp} disabled={!rippo || ytDlpStatus !== "idle"}>
                      {ytDlpStatus === "updating" ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : null}
                      {ytDlpUpdate.currentVersion ? "Update" : "Install"}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-footer" onClick={checkYtDlpUpdate} disabled={!rippo || ytDlpStatus !== "idle"}>
                      {ytDlpStatus === "checking" ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <RefreshCcw size={14} strokeWidth={2} aria-hidden />}
                      Check for updates
                    </button>
                  )}
                </div>
                {ytDlpError ? <p className="settings-warning">{consumerErrorMessage(ytDlpError)}</p> : null}
                {ytDlpUpdate && !ytDlpUpdate.updateAvailable && !ytDlpError ? (
                  <p className="settings-hint">Video support is up to date.</p>
                ) : null}
                <div className="settings-engine-row settings-engine-row-spaced">
                  <div className="settings-engine-copy">
                    <p className="settings-engine-name">Images</p>
                    <p className="settings-hint">Image galleries</p>
                  </div>
                  <span className="settings-version">{galleryDlStatusText(health, healthError)}</span>
                </div>
                <p className="settings-hint" title={galleryDlUpdate?.binaryPath || health?.galleryDlPath || undefined}>
                  {galleryDlPathText(galleryDlUpdate, health)}
                </p>
                <div className="settings-actions">
                  {galleryDlUpdate?.updateAvailable ? (
                    <button type="button" className="btn btn-primary btn-footer" onClick={updateGalleryDl} disabled={!rippo || galleryDlStatus !== "idle"}>
                      {galleryDlStatus === "updating" ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : null}
                      {galleryDlUpdate.currentVersion ? "Update" : "Install"}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-footer" onClick={checkGalleryDlUpdate} disabled={!rippo || galleryDlStatus !== "idle"}>
                      {galleryDlStatus === "checking" ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <RefreshCcw size={14} strokeWidth={2} aria-hidden />}
                      Check for updates
                    </button>
                  )}
                </div>
                {galleryDlError ? <p className="settings-warning">{consumerErrorMessage(galleryDlError)}</p> : null}
                {health?.galleryDlError && !galleryDlError ? <p className="settings-warning">{consumerErrorMessage(health.galleryDlError)}</p> : null}
                {galleryDlUpdate && !galleryDlUpdate.updateAvailable && !galleryDlError ? (
                  <p className="settings-hint">Image support is up to date.</p>
                ) : null}
                <div className="settings-engine-row settings-engine-row-spaced">
                  <div className="settings-engine-copy">
                    <p className="settings-engine-name">Torrents</p>
                    <p className="settings-hint">Magnet links and torrent files</p>
                  </div>
                  <span className="settings-version">{aria2cStatusText(health, healthError)}</span>
                </div>
                <p className="settings-hint" title={health?.qBittorrentPath || health?.aria2cPath || undefined}>
                  {aria2cPathText(health)}
                </p>
                {health?.torrentError ? <p className="settings-warning">{consumerErrorMessage(health.torrentError)}</p> : null}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </main>
  );
}
