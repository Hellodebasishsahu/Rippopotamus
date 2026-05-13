import { Cookie, Download, ExternalLink, FileAudio, Film, FolderOpen, FolderSearch, Image as ImageIcon, Loader2, Monitor, Play, Radar as RadarIcon, RefreshCcw, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BrowserInfo, CookieSource, EngineHealth, GalleryDlUpdateInfo, IndexSearchResponse, IndexSearchResult, IndexStatusResponse, OpenRouterModelCatalog, PresetOption, ProviderId, ProviderOption, YtDlpUpdateInfo } from "../../electron/types";
import { itemSupportsBrowserAccess, presetsForItem, queueItemProgress, queueItemStatusText, sourceUrl, useDownloadQueue } from "./app/useDownloadQueue";
import type { QueueItem } from "./app/useDownloadQueue";
import { libraryPlayerState, libraryPreviewStart, nextExpandedLibraryId } from "./app/libraryPreview";
import { useLibraryIndex } from "./app/useLibraryIndex";
import type { IndexBusy } from "./app/useLibraryIndex";
import { useSourceSearch } from "./app/useSourceSearch";
import { createDesktopClient } from "./client/desktopClient";
import { AppHeader } from "./components/AppHeader";
import { QueueCard } from "./components/QueueCard";
import { SourceSearchPanel } from "./components/SourceSearchPanel";
import { extractUrls } from "./urlParser";

type ComposerAction = {
  id: "idle" | "search" | "fetch";
  label: string;
  busyLabel: string;
  hint: string;
  icon: "search" | "none";
  disabled: boolean;
  countSuffix?: string;
};

type SearchScope = "library" | "web";

const AUTO_PROVIDER = "auto";
const COOKIE_OFF: CookieSource = { mode: "off" };
function formatMomentTime(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return "";
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60).toString().padStart(hours ? 2 : 1, "0");
  const rest = (safe % 60).toString().padStart(2, "0");
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}

function momentRange(result: IndexSearchResult): string {
  const start = formatMomentTime(result.start);
  const end = formatMomentTime(result.end);
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return "Full file";
}

function folderForPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? filePath.slice(0, index) : filePath;
}

function indexStatusLine(status: IndexStatusResponse | null): string {
  if (!status) return "Not scanned yet";
  if (!status.assetCount && !status.momentCount) return "No saved footage scanned";
  return `${status.assetCount} files · filename index`;
}

function savedFootageBadge(status: IndexStatusResponse | null): string {
  if (!status || !status.assetCount) return "No saved footage";
  if (status.momentCount) return `${status.assetCount} files`;
  return "No moments";
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

function cookieAccessLabel(source: CookieSource, browsers: BrowserInfo[]): string {
  if (source.mode === "off") return "Public links only";
  const browser = browsers.find((candidate) => candidate.id === source.browserId);
  return browser ? browser.label : "Browser";
}

function siteAccessStatus(source: CookieSource, browsers: BrowserInfo[], health: EngineHealth | null): { state: "off" | "checking" | "ok" | "error"; label: string; detail: string } {
  if (source.mode === "off") {
    return {
      state: "off",
      label: "Public only",
      detail: "Rippo will not use a signed-in browser session.",
    };
  }

  const browser = browsers.find((candidate) => candidate.id === source.browserId);
  const browserName = browser?.label || "Browser";
  const current = health?.cookies;
  if (!current || current.browser !== source.browserId) {
    return {
      state: "checking",
      label: "Not checked yet",
      detail: `${browserName} is selected, but Rippo has not proved it can read that session yet.`,
    };
  }
  if (current.status === "ok") {
    return {
      state: "ok",
      label: "Readable",
      detail: `${browserName} session is readable for yt-dlp video/audio links.`,
    };
  }
  if (current.status === "error") {
    return {
      state: "error",
      label: "Not readable",
      detail: "Selected is not the same as working. Try Chrome, close the browser, or grant access.",
    };
  }
  return {
    state: "checking",
    label: "Not checked yet",
    detail: `${browserName} is selected, but access has not been checked yet.`,
  };
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
  if (lower.includes("gemini_api_key") || lower.includes("google_api_key") || lower.includes("gemini semantic ingestion")) {
    return "Video indexing needs an API key before it can scan saved clips.";
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

function binaryStatusText(ok: boolean | null | undefined, healthError: string | null): string {
  if (ok === true) return "Ready";
  if (ok === false) return "Missing";
  if (healthError) return "Unavailable";
  return "Checking...";
}

function pythonStatusText(health: EngineHealth | null, healthError: string | null): string {
  if (health?.python) return "Ready";
  if (healthError) return "Unavailable";
  return "Checking...";
}

function pythonPathText(health: EngineHealth | null): string {
  if (health?.python) return "Runs Rippo's local engine.";
  return "Python runtime was not reported by the engine.";
}

function aria2cPathText(health: EngineHealth | null): string {
  if (health?.aria2cOk) return health.torrentEngine === "aria2c" ? "Active torrent engine." : "Installed torrent fallback.";
  return "Install aria2c to use it as a torrent fallback.";
}

function qbittorrentPathText(health: EngineHealth | null): string {
  if (health?.qBittorrentOk) return health.torrentEngine === "qbittorrent" ? "Active torrent engine." : "Installed torrent engine.";
  return "Install qBittorrent-nox for enhanced torrent support.";
}

function ffmpegStatusText(health: EngineHealth | null, healthError: string | null): string {
  if (health?.ffmpegOk) return "Ready";
  if (health?.ffmpegOk === false) return "Missing";
  if (healthError) return "Unavailable";
  return "Checking...";
}

function ffmpegPathText(health: EngineHealth | null): string {
  if (health?.ffmpegOk) return "Ready to merge, convert, and prepare media files.";
  return "Bundled media processing is not available.";
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

function indexEmptyState(indexBusy: IndexBusy, indexSearch: IndexSearchResponse, indexStatus: IndexStatusResponse | null, hasComposerText: boolean): { title: string; detail: string } {
  if (indexBusy === "searching") {
    return { title: "Searching saved footage...", detail: "Looking through the saved folder." };
  }
  if (indexSearch.query) {
    return { title: `No filename matches for "${indexSearch.query}"`, detail: "Visual scene search is not wired yet. Right now Rippo only searches file names and basic metadata." };
  }
  if (hasComposerText) {
    return { title: "Ready to search saved files", detail: "Hit Search to match filenames and basic metadata." };
  }
  if (indexStatus?.assetCount) {
    return { title: "Search saved files", detail: "Filename search is available. Visual scene search is a later rebuild." };
  }
  return { title: "No saved footage scanned yet", detail: "Use Settings > Ingest when you want to add saved videos." };
}

export function App() {
  const desktop = useMemo(() => createDesktopClient(window.rippo), []);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("library");
  const [fetchProvider, setFetchProvider] = useState<ProviderId | typeof AUTO_PROVIDER>(AUTO_PROVIDER);
  const [outputRoot, setOutputRoot] = useState("");
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([]);
  const [cookieSource, setCookieSource] = useState<CookieSource>(COOKIE_OFF);
  const [ytDlpUpdate, setYtDlpUpdate] = useState<YtDlpUpdateInfo | null>(null);
  const [ytDlpStatus, setYtDlpStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [ytDlpError, setYtDlpError] = useState<string | null>(null);
  const [galleryDlUpdate, setGalleryDlUpdate] = useState<GalleryDlUpdateInfo | null>(null);
  const [galleryDlStatus, setGalleryDlStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [galleryDlError, setGalleryDlError] = useState<string | null>(null);
  const [qbittorrentStatus, setQbittorrentStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [aria2cStatus, setAria2cStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [ffmpegStatus, setFfmpegStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [aiCatalog, setAiCatalog] = useState<OpenRouterModelCatalog | null>(null);
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "saving">("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"general" | "search" | "ingest" | "watch" | "access" | "tools" | "appearance">("general");
  const [fontSmoothing, setFontSmoothing] = useState(() => localStorage.getItem("rippo:appearance:fontSmoothing") !== "false");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    activeSourcePack,
    setActiveSourcePack,
    sourcePacks,
    sourceSearch,
    sourceSearchBusy,
    resetSourceSearch,
    searchSources: searchSourceQuery,
  } = useSourceSearch({ desktop, consumerErrorMessage });
  const {
    indexStatus,
    indexSearch,
    indexBusy,
    indexError,
    libraryThumbs,
    expandedLibraryId,
    libraryMediaUrls,
    setExpandedLibraryId,
    resetIndexSearch,
    clearIndexError,
    indexSavedFolder,
    searchSavedFootage,
  } = useLibraryIndex({
    desktop,
    outputRoot,
    consumerErrorMessage,
  });

  useEffect(() => {
    document.documentElement.classList.toggle("no-font-smoothing", !fontSmoothing);
    localStorage.setItem("rippo:appearance:fontSmoothing", String(fontSmoothing));
  }, [fontSmoothing]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen || !desktop || typeof desktop.listAiModels !== "function" || aiCatalog) return;
    void loadAiModels(false);
  }, [settingsOpen, desktop, aiCatalog]);

  useEffect(() => {
    if (!desktop) return;
    desktop.listBrowsers().then((result) => {
      setBrowsers(result.browsers);
      setCookieSource(cookieSourceFromResponse(result.source, result.selected));
    }).catch(() => undefined);
  }, [desktop]);

  async function refreshHealth() {
    if (!desktop) return null;
    try {
      const nextHealth = await desktop.health();
      setHealth(nextHealth);
      if (nextHealth.outputRoot) setOutputRoot(nextHealth.outputRoot);
      setHealthError(null);
      return nextHealth;
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function changeDefaultCookieSource(value: string) {
    if (!desktop) return;
    const next = cookieSourceFromValue(value);
    const result = typeof desktop.setDefaultCookieSource === "function"
      ? await desktop.setDefaultCookieSource(next)
      : await desktop.setCookiesBrowser(next.mode === "browser" ? next.browserId : null);
    setCookieSource(cookieSourceFromResponse(result.source, result.selected));
    await refreshHealth();
  }

  function chooseSearchScope(scope: SearchScope) {
    setSearchScope(scope);
    if (scope === "library") resetSourceSearch();
    else resetIndexSearch();
  }

  async function chooseOutputRoot() {
    if (!desktop) return;
    try {
      const result = await desktop.chooseOutputRoot();
      if (!result.canceled) setOutputRoot(result.outputRoot);
    } catch {
      undefined;
    }
  }

  async function resetOutputRoot() {
    if (!desktop) return;
    try {
      const result = await desktop.resetOutputRoot();
      setOutputRoot(result.outputRoot);
    } catch {
      undefined;
    }
  }

  async function loadAiModels(refresh: boolean) {
    if (!desktop || typeof desktop.listAiModels !== "function" || aiStatus !== "idle") return;
    setAiStatus("loading");
    setAiError(null);
    try {
      const result = await desktop.listAiModels(refresh);
      setAiCatalog(result);
      if (result.error) setAiError(result.error);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiStatus("idle");
    }
  }

  async function changeAiModel(modelId: string) {
    if (!desktop || typeof desktop.setAiModel !== "function") return;
    setAiStatus("saving");
    setAiError(null);
    try {
      const result = await desktop.setAiModel(modelId);
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
    if (!desktop || ytDlpStatus !== "idle") return;
    if (typeof desktop.checkYtDlpUpdate !== "function") {
      setYtDlpError("Restart Rippopotamus to load the yt-dlp updater.");
      return;
    }
    setYtDlpStatus("checking");
    setYtDlpError(null);
    try {
      const result = await desktop.checkYtDlpUpdate();
      setYtDlpUpdate(result);
    } catch (error) {
      setYtDlpError(updaterErrorMessage(error, "yt-dlp"));
    } finally {
      setYtDlpStatus("idle");
    }
  }

  async function updateYtDlp() {
    if (!desktop || ytDlpStatus !== "idle") return;
    if (typeof desktop.updateYtDlp !== "function") {
      setYtDlpError("Restart Rippopotamus to load the yt-dlp updater.");
      return;
    }
    setYtDlpStatus("updating");
    setYtDlpError(null);
    try {
      const result = await desktop.updateYtDlp();
      setYtDlpUpdate(result);
      setHealth(result.health);
    } catch (error) {
      setYtDlpError(updaterErrorMessage(error, "yt-dlp"));
    } finally {
      setYtDlpStatus("idle");
    }
  }

  async function checkGalleryDlUpdate() {
    if (!desktop || galleryDlStatus !== "idle") return;
    if (typeof desktop.checkGalleryDlUpdate !== "function") {
      setGalleryDlError("Restart Rippopotamus to load the gallery-dl updater.");
      return;
    }
    setGalleryDlStatus("checking");
    setGalleryDlError(null);
    try {
      const result = await desktop.checkGalleryDlUpdate();
      setGalleryDlUpdate(result);
    } catch (error) {
      setGalleryDlError(updaterErrorMessage(error, "gallery-dl"));
    } finally {
      setGalleryDlStatus("idle");
    }
  }

  async function updateGalleryDl() {
    if (!desktop || galleryDlStatus !== "idle") return;
    if (typeof desktop.updateGalleryDl !== "function") {
      setGalleryDlError("Restart Rippopotamus to load the gallery-dl updater.");
      return;
    }
    setGalleryDlStatus("updating");
    setGalleryDlError(null);
    try {
      const result = await desktop.updateGalleryDl();
      setGalleryDlUpdate(result);
      setHealth(result.health);
    } catch (error) {
      setGalleryDlError(updaterErrorMessage(error, "gallery-dl"));
    } finally {
      setGalleryDlStatus("idle");
    }
  }

  async function checkQbittorrentUpdate() {
    if (!desktop || qbittorrentStatus !== "idle") return;
    setQbittorrentStatus("checking");
    try {
      await refreshHealth();
    } finally {
      setQbittorrentStatus("idle");
    }
  }

  async function checkAria2cUpdate() {
    if (!desktop || aria2cStatus !== "idle") return;
    setAria2cStatus("checking");
    try {
      await refreshHealth();
    } finally {
      setAria2cStatus("idle");
    }
  }

  async function checkFfmpegUpdate() {
    if (!desktop || ffmpegStatus !== "idle") return;
    setFfmpegStatus("checking");
    try {
      await refreshHealth();
    } finally {
      setFfmpegStatus("idle");
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
  const providerOptions = health?.providers || [];
  const presetOptions = health?.presets || [];
  const defaultSiteAccess = siteAccessStatus(cookieSource, browsers, health);
  const selectedFetchProvider = fetchProvider || AUTO_PROVIDER;
  const {
    items,
    busy,
    totals,
    queueUrls,
    downloadReady,
    refetch,
    removeItem,
    setItemPreset,
    setItemCookieSource,
  } = useDownloadQueue({
    desktop,
    selectedFetchProvider,
    providerOptions,
    presetOptions,
    cookieSource,
    outputRoot,
    consumerErrorMessage,
    consumerNoticeMessage,
  });
  const composerAction = useMemo(() => resolveComposerAction({
      hasText: hasComposerText,
      urlCount: detectedCount,
      canUseDesktop: Boolean(desktop),
      hasProvider: Boolean(selectedFetchProvider),
      searchBusy: searchScope === "library" ? indexBusy === "searching" : sourceSearchBusy,
    }), [detectedCount, hasComposerText, indexBusy, desktop, searchScope, selectedFetchProvider, sourceSearchBusy]);
  const activeSearchBusy = composerAction.id === "search" && (searchScope === "library" ? indexBusy === "searching" : sourceSearchBusy);

  useEffect(() => {
    if (!desktop) {
      setHealthError("Desktop engine IPC is not available.");
      return;
    }
    void refreshHealth();
  }, [desktop]);

  useEffect(() => {
    if (!providerOptions.length) return;
    setFetchProvider((current) => current === AUTO_PROVIDER || providerOptions.some((provider) => provider.id === current) ? current : AUTO_PROVIDER);
  }, [providerOptions]);

  useEffect(() => {
    if (detectedCount > 0 && sourceSearch.query) resetSourceSearch();
  }, [detectedCount, sourceSearch.query, resetSourceSearch]);

  async function addAndFetch() {
    const urls = inputUrls;
    if (!urls.length) return;
    setInput("");
    resetSourceSearch();
    await queueUrls(urls);
  }

  async function runComposerAction() {
    if (composerAction.id === "search") {
      if (searchScope === "library") await searchSavedFootage(input);
      else await searchSourceQuery(input);
      return;
    }
    if (composerAction.id === "fetch") await addAndFetch();
  }

  function openSource(item: QueueItem) {
    if (desktop) desktop.openExternal(sourceUrl(item)).catch(() => undefined);
    else window.open(sourceUrl(item), "_blank", "noopener,noreferrer");
  }

  return (
    <main className="app">
      <div className="layout">
        <AppHeader
          input={input}
          textareaRef={textareaRef}
          searchScope={searchScope}
          sourcePacks={sourcePacks}
          activeSourcePack={activeSourcePack}
          detectedCount={detectedCount}
          indexStatus={indexStatus}
          selectedFetchProvider={selectedFetchProvider}
          providerOptions={providerOptions}
          composerAction={composerAction}
          activeSearchBusy={activeSearchBusy}
          setInput={setInput}
          clearIndexError={clearIndexError}
          runComposerAction={runComposerAction}
          chooseSearchScope={chooseSearchScope}
          setActiveSourcePack={setActiveSourcePack}
          setFetchProvider={setFetchProvider}
          openSettings={() => setSettingsOpen(true)}
        />

        <section className="workspace">
          {healthError ? <p className="error-text">{healthError}</p> : null}
          {(indexSearch.query || indexSearch.results.length > 0 || indexError || indexBusy === "searching") ? (
            <div className="index-panel">
              <div className="index-head">
                <div className="index-title-block">
                  <p className="index-eyebrow">Saved footage</p>
                  <h2 className="index-title">Search your saved videos.</h2>
                </div>
              </div>
              <div className="index-meta-row">
                <span>{indexStatusLine(indexStatus)}</span>
                <span title={outputRoot || undefined}>{outputRoot || "Saved folder not ready"}</span>
              </div>
              {indexError ? <p className="error-text">{consumerErrorMessage(indexError, "Could not search saved footage.")}</p> : null}
              {indexSearch.results.length > 0 ? (
                <div className="index-results">
                  <div className="index-results-head">
                    <span>{indexSearch.resultCount} moments</span>
                    <span>{indexSearch.query}</span>
                  </div>
                  {indexSearch.results.map((result) => {
                    const KindIcon = result.kind === "image" ? ImageIcon : result.kind === "audio" ? FileAudio : Film;
                    const isExpanded = expandedLibraryId === result.id;
                    const thumbUrl = libraryThumbs[result.id];
                    const mediaUrl = libraryMediaUrls[result.id];
                    const playableMediaUrl = typeof mediaUrl === "string" ? mediaUrl : undefined;
                    const playerState = libraryPlayerState(result, expandedLibraryId, mediaUrl);
                    const isPlayable = playerState !== "closed" || nextExpandedLibraryId(expandedLibraryId, result) !== expandedLibraryId;
                    const toggleExpand = () => {
                      setExpandedLibraryId(nextExpandedLibraryId(expandedLibraryId, result));
                    };
                    return (
                      <article key={result.id} className={`index-result kind-${result.kind} ${isExpanded ? "is-expanded" : ""}`}>
                        <button
                          type="button"
                          className="index-thumb"
                          onClick={toggleExpand}
                          disabled={!isPlayable}
                          aria-label={isPlayable ? (isExpanded ? "Collapse preview" : "Preview moment") : "No preview available"}
                          aria-expanded={isExpanded}
                        >
                          {thumbUrl ? (
                            <img className="index-thumb-img" src={thumbUrl} alt="" loading="lazy" decoding="async" />
                          ) : thumbUrl === null ? (
                            <KindIcon size={22} strokeWidth={1.6} className="index-thumb-icon" aria-hidden />
                          ) : (
                            <Loader2 size={18} strokeWidth={2} className="spin index-thumb-icon" aria-hidden />
                          )}
                          {isPlayable ? (
                            <span className="index-thumb-play" aria-hidden>
                              <Play size={14} strokeWidth={2.5} />
                            </span>
                          ) : null}
                          <span className="index-thumb-time" aria-hidden>{momentRange(result)}</span>
                        </button>
                        <div className="index-result-body">
                          <div className="index-result-top">
                            <h3 className="index-result-title" title={result.title || result.file}>{result.title || result.file}</h3>
                            <span className={`index-match index-match-${result.matchType}`}>{result.matchType}</span>
                          </div>
                          {result.description ? <p className="index-result-desc" title={result.description}>{result.description}</p> : null}
                          <p className="index-result-path" title={result.file}>{result.file}</p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-reveal"
                          onClick={() => desktop?.openFolder(folderForPath(result.path))}
                          disabled={!desktop}
                          title="Reveal in folder"
                        >
                          <FolderOpen size={13} strokeWidth={2} aria-hidden /> Reveal
                        </button>
                        {isExpanded ? (
                          <div className="index-player">
                            {playerState === "video" ? (
                                <video
                                  className="index-player-video"
                                  src={playableMediaUrl}
                                  controls
                                  autoPlay
                                  preload="metadata"
                                  onLoadedMetadata={(event) => {
                                    const start = libraryPreviewStart(result);
                                    if (start > 0) (event.currentTarget as HTMLVideoElement).currentTime = start;
                                  }}
                                />
                            ) : playerState === "audio" ? (
                              <audio className="index-player-audio" src={playableMediaUrl} controls autoPlay preload="metadata" />
                            ) : playerState === "image" ? (
                              <img className="index-player-image" src={playableMediaUrl} alt={result.title || result.file} />
                            ) : playerState === "missing" ? (
                              <p className="index-player-empty">Couldn't open the file. It may have been moved.</p>
                            ) : (
                              <div className="index-player-loading"><Loader2 size={16} strokeWidth={2} className="spin" /> Loading preview…</div>
                            )}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="index-empty">
                  {(() => {
                    const empty = indexEmptyState(indexBusy, indexSearch, indexStatus, hasComposerText);
                    return (
                      <>
                        <b>{empty.title}</b>
                        <span>{empty.detail}</span>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          ) : null}
          <SourceSearchPanel
            sourceSearch={sourceSearch}
            sourceSearchBusy={sourceSearchBusy}
            input={input}
            openExternal={(url) => desktop?.openExternal(url)}
          />

          {items.length > 0 && (
            <div className="queue-summary-row">
              <p className="queue-summary">{items.length} · {totals.ready} ready · {totals.done} saved{totals.failed ? ` · ${totals.failed} failed` : ""}</p>
              <div className="queue-summary-actions">
                <button type="button" className="btn btn-ghost btn-footer" onClick={() => desktop?.openFolder(outputRoot)} disabled={!desktop} title={outputRoot || undefined}>
                  <FolderOpen size={14} strokeWidth={2} aria-hidden /> Open folder
                </button>
                <button type="button" className="btn btn-primary btn-footer" onClick={downloadReady} disabled={!totals.ready || busy || !desktop}>
                  {busy ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <Download size={14} strokeWidth={2} aria-hidden />} Download{totals.ready ? ` ${totals.ready}` : ""}
                </button>
              </div>
            </div>
          )}
          {items.length === 0 && !hasComposerText && !indexSearch.query && !indexError && indexBusy === "idle" && !sourceSearch.query && !sourceSearch.results.length && !sourceSearch.error && !sourceSearchBusy ? (
            <div className="empty">
              <span>Paste a link or search anything.</span>
            </div>
          ) : (
            items.map((item) => {
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
            })
          )}
        </section>

      </div>
      {health && !health.ok && health.error ? <p className="error-text health-banner">{health.error}</p> : null}
      {settingsOpen ? (
        <div className="settings-fullscreen" role="dialog" aria-label="Settings" aria-modal="true">
          <div className="settings-panel">
            <nav className="settings-rail" aria-label="Settings sections">
              <button
                type="button"
                className="settings-back"
                onClick={() => setSettingsOpen(false)}
                aria-label="Back to app"
              >
                <X size={14} strokeWidth={2} aria-hidden /> Back to app
              </button>
              {([
                { id: "general",    label: "General",    icon: FolderOpen },
                { id: "search",     label: "Search",     icon: Search },
                { id: "ingest",     label: "Ingest",     icon: FolderSearch },
                { id: "watch",      label: "Watch",      icon: RadarIcon },
                { id: "access",     label: "Access",     icon: Cookie },
                { id: "tools",      label: "Tools",      icon: Download },
                { id: "appearance", label: "Appearance", icon: Monitor },
              ] as const).map((item) => {
                const Icon = item.icon;
                const active = settingsSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-rail-item ${active ? "is-active" : ""}`}
                    onClick={() => setSettingsSection(item.id)}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={14} strokeWidth={2} aria-hidden />
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <div className="settings-pane">
              <div className="settings-head">
                <h2 className="settings-title">
                  {settingsSection === "general"    ? "General"    :
                   settingsSection === "search"     ? "Search"     :
                   settingsSection === "ingest"     ? "Ingest"     :
                   settingsSection === "watch"      ? "Watch"      :
                   settingsSection === "access"     ? "Access"     :
                   settingsSection === "appearance" ? "Appearance" : "Tools"}
                </h2>
                <p className="settings-subtitle">
                  {settingsSection === "general"    ? "Where Rippo saves what you download." :
                   settingsSection === "search"     ? "How Rippo finds links across the web." :
                   settingsSection === "ingest"     ? "How saved footage is indexed." :
                   settingsSection === "watch"      ? "Channels and feeds Rippo monitors for new finds." :
                   settingsSection === "access"     ? "Use your browser session for video links that need it." :
                   settingsSection === "appearance" ? "Fonts, cursors, and display preferences." :
                                                     "Engines Rippo uses to save and prepare files."}
                </p>
              </div>

            {settingsSection === "general" && (
            <section className="settings-section">
              <div className="settings-row-head">
                <FolderOpen size={14} strokeWidth={2} aria-hidden />
                <h3 className="settings-row-title">Download location</h3>
              </div>
              <p className="settings-hint settings-path-display" title={outputRoot || undefined}>
                {outputRoot || "Will use ~/Downloads/Rippo"}
              </p>
              <div className="settings-actions">
                <button type="button" className="btn btn-primary btn-footer" onClick={chooseOutputRoot} disabled={!desktop}>
                  <FolderSearch size={14} strokeWidth={2} aria-hidden /> Choose…
                </button>
                <button type="button" className="btn btn-ghost btn-footer" onClick={resetOutputRoot} disabled={!desktop} title="Reset to ~/Downloads/Rippo">
                  <RotateCcw size={14} strokeWidth={2} aria-hidden /> Default
                </button>
              </div>
            </section>
            )}

            {settingsSection === "search" && (
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
                disabled={!desktop || aiStatus !== "idle"}
                aria-label="OpenRouter routing model"
              >
                {(aiCatalog?.models?.length ? aiCatalog.models : [{ id: openRouterModelText(aiCatalog, health), name: openRouterModelText(aiCatalog, health) }]).map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
              <div className="settings-actions">
                <button type="button" className="btn btn-ghost btn-footer" onClick={() => loadAiModels(true)} disabled={!desktop || aiStatus !== "idle"}>
                  {aiStatus === "loading" ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <RefreshCcw size={14} strokeWidth={2} aria-hidden />}
                  Refresh free models
                </button>
              </div>
              <p className="settings-hint">
                {aiCatalog?.models?.length ? `${aiCatalog.models.length} free text-only models cached. Selected: ${openRouterModelText(aiCatalog, health)}` : `Selected: ${openRouterModelText(aiCatalog, health)}`}
              </p>
              {aiError ? <p className="settings-warning">{consumerErrorMessage(aiError, "Could not refresh OpenRouter models.")}</p> : null}
            </section>
            )}

            {settingsSection === "ingest" && (
            <section className="settings-section ingest-section">
              <div className="ingest-compact-head">
                <div>
                  <h3 className="settings-row-title">Index saved files</h3>
                  <p className="settings-hint">Adds real files to the local library using filenames and basic media metadata only.</p>
                </div>
                <span className="ingest-cost-pill">No AI scan<small>visual search gap</small></span>
              </div>
              <p className="ingest-current-line">This deliberately does not run embeddings, captions, transcript, or object detection. Scene search like women, mic, stage, crowd is not available until we rebuild that layer properly.</p>
              <div className="settings-actions ingest-actions">
                <button type="button" className="btn btn-primary btn-footer" onClick={indexSavedFolder} disabled={!desktop || indexBusy !== "idle"}>
                  {indexBusy === "ingesting" ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <FolderSearch size={14} strokeWidth={2} aria-hidden />}
                  Index folder
                </button>
                <span className="settings-version">
                  {`${indexStatus?.assetCount || 0} files indexed`}
                </span>
              </div>
              {indexError ? <p className="settings-warning">{consumerErrorMessage(indexError, "Could not index this folder.")}</p> : null}
            </section>
            )}

            {settingsSection === "watch" && (
            <section className="settings-section">
              <div className="settings-row-head">
                <RadarIcon size={14} strokeWidth={2} aria-hidden />
                <h3 className="settings-row-title">Watching</h3>
                <span className="settings-version">2 channels</span>
              </div>
              <p className="settings-hint">
                Paste a channel or feed URL. Rippo checks it on a schedule and drops new finds into your queue.
              </p>
              <div className="watch-add-row">
                <input
                  type="text"
                  className="watch-add-input"
                  placeholder="https://… channel, feed, or playlist"
                  aria-label="Channel URL"
                  disabled
                />
                <button type="button" className="btn btn-primary btn-footer" disabled>Add</button>
              </div>
              <ul className="watch-list" aria-label="Watched channels">
                <li className="watch-row">
                  <div className="watch-row-body">
                    <p className="watch-row-url">youtube.com/@example-channel</p>
                    <p className="watch-row-meta">last scan 4m ago · <b>3</b> new this week</p>
                  </div>
                  <button type="button" className="icon-btn icon-btn-danger" disabled aria-label="Remove" title="Remove">
                    <Trash2 size={14} strokeWidth={2} aria-hidden />
                  </button>
                </li>
                <li className="watch-row">
                  <div className="watch-row-body">
                    <p className="watch-row-url">vimeo.com/example/feed</p>
                    <p className="watch-row-meta">last scan 22m ago · no new finds yet</p>
                  </div>
                  <button type="button" className="icon-btn icon-btn-danger" disabled aria-label="Remove" title="Remove">
                    <Trash2 size={14} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              </ul>
              <p className="settings-hint">Scanning every 30 minutes when Rippo is open.</p>
            </section>
            )}

            {settingsSection === "access" && (
            <section className="settings-section">
              <div className="settings-row-head">
                <Cookie size={14} strokeWidth={2} aria-hidden />
                <h3 className="settings-row-title">Site access</h3>
              </div>
              <p className="settings-hint">Pick Chrome only when a video link needs your signed-in session. Rippo passes local browser data to yt-dlp; it does not open or control your account.</p>
              <select
                className="settings-select"
                value={cookieSourceValue(cookieSource)}
                onChange={(event) => changeDefaultCookieSource(event.target.value)}
                disabled={!desktop}
                aria-label="Default site access"
              >
                <option value="off">Public links only</option>
                {browsers.map((browser) => (
                  <option key={browser.id} value={`browser:${browser.id}`}>{browser.label}</option>
                ))}
              </select>
              <div className={`access-status access-status-${defaultSiteAccess.state}`}>
                <span className="status-glyph" aria-hidden />
                <div className="access-status-copy">
                  <b>{defaultSiteAccess.label}</b>
                  <span>{defaultSiteAccess.detail}</span>
                </div>
                <button type="button" className="btn btn-ghost btn-footer" onClick={() => refreshHealth()} disabled={!desktop}>
                  Check
                </button>
              </div>
              {!browsers.length ? <p className="settings-hint">No supported browser was found.</p> : null}
              {health?.cookies?.status === "error" ? (
                <p className="settings-warning">Could not read that browser session. Try Chrome, close the browser, or grant access.</p>
              ) : null}
            </section>
            )}

            {settingsSection === "tools" && (
            <section className="settings-section">
              <ul className="tool-list" role="list">

                <li className="tool-row">
                  <span className={`tool-dot ${health?.python ? "tool-dot-ok" : "tool-dot-dim"}`} aria-hidden />
                  <div className="tool-body">
                    <span className="tool-name">Python</span>
                    <span className="tool-desc">Runs the local Rippo engine</span>
                    {health?.python ? <span className="tool-path">{health.python}</span> : null}
                  </div>
                  <span className="tool-status">{pythonStatusText(health, healthError)}</span>
                </li>

                <li className="tool-row">
                  <span className={`tool-dot ${health?.ytDlp ? "tool-dot-ok" : "tool-dot-dim"}`} aria-hidden />
                  <div className="tool-body">
                    <span className="tool-name">yt-dlp</span>
                    <span className="tool-desc">Video, audio, thumbnails, and site metadata</span>
                    {(ytDlpUpdate?.binaryPath || health?.ytDlpPath) ? <span className="tool-path">{ytDlpUpdate?.binaryPath || health?.ytDlpPath}</span> : null}
                    {ytDlpError ? <span className="tool-error">{consumerErrorMessage(ytDlpError)}</span> : null}
                  </div>
                  <div className="tool-actions">
                    {ytDlpUpdate?.updateAvailable ? (
                      <button type="button" className="tool-btn tool-btn-primary" onClick={updateYtDlp} disabled={!desktop || ytDlpStatus !== "idle"}>
                        {ytDlpStatus === "updating" ? <Loader2 className="spin" size={12} strokeWidth={2} aria-hidden /> : null}
                        {ytDlpUpdate.currentVersion ? "Update" : "Install"}
                      </button>
                    ) : (
                      <button type="button" className="tool-btn tool-btn-ghost" onClick={checkYtDlpUpdate} disabled={!desktop || ytDlpStatus !== "idle"}>
                        {ytDlpStatus === "checking" ? <Loader2 className="spin" size={12} strokeWidth={2} aria-hidden /> : <RefreshCcw size={12} strokeWidth={2} aria-hidden />}
                        Check
                      </button>
                    )}
                  </div>
                </li>

                <li className="tool-row">
                  <span className={`tool-dot ${health?.galleryDl ? "tool-dot-ok" : "tool-dot-dim"}`} aria-hidden />
                  <div className="tool-body">
                    <span className="tool-name">gallery-dl</span>
                    <span className="tool-desc">Image galleries and creator pages</span>
                    {(galleryDlUpdate?.binaryPath || health?.galleryDlPath) ? <span className="tool-path">{galleryDlUpdate?.binaryPath || health?.galleryDlPath}</span> : null}
                    {galleryDlError ? <span className="tool-error">{consumerErrorMessage(galleryDlError)}</span> : null}
                    {health?.galleryDlError && !galleryDlError ? <span className="tool-error">{consumerErrorMessage(health.galleryDlError)}</span> : null}
                  </div>
                  <div className="tool-actions">
                    {galleryDlUpdate?.updateAvailable ? (
                      <button type="button" className="tool-btn tool-btn-primary" onClick={updateGalleryDl} disabled={!desktop || galleryDlStatus !== "idle"}>
                        {galleryDlStatus === "updating" ? <Loader2 className="spin" size={12} strokeWidth={2} aria-hidden /> : null}
                        {galleryDlUpdate.currentVersion ? "Update" : "Install"}
                      </button>
                    ) : (
                      <button type="button" className="tool-btn tool-btn-ghost" onClick={checkGalleryDlUpdate} disabled={!desktop || galleryDlStatus !== "idle"}>
                        {galleryDlStatus === "checking" ? <Loader2 className="spin" size={12} strokeWidth={2} aria-hidden /> : <RefreshCcw size={12} strokeWidth={2} aria-hidden />}
                        Check
                      </button>
                    )}
                  </div>
                </li>

                <li className="tool-row">
                  <span className={`tool-dot ${health?.qBittorrentOk ? "tool-dot-ok" : "tool-dot-dim"}`} aria-hidden />
                  <div className="tool-body">
                    <span className="tool-name">qBittorrent-nox</span>
                    <span className="tool-desc">Preferred torrent engine for magnet links</span>
                    {health?.qBittorrentPath ? <span className="tool-path">{health.qBittorrentPath}</span> : null}
                    {health?.qBittorrentError ? <span className="tool-error">{consumerErrorMessage(health.qBittorrentError)}</span> : null}
                  </div>
                  <div className="tool-actions">
                    <button type="button" className="tool-btn tool-btn-ghost" onClick={checkQbittorrentUpdate} disabled={!desktop || qbittorrentStatus !== "idle"}>
                      {qbittorrentStatus === "checking" ? <Loader2 className="spin" size={12} strokeWidth={2} aria-hidden /> : <RefreshCcw size={12} strokeWidth={2} aria-hidden />}
                      Check
                    </button>
                  </div>
                </li>

                <li className="tool-row">
                  <span className={`tool-dot ${health?.aria2cOk ? "tool-dot-ok" : "tool-dot-dim"}`} aria-hidden />
                  <div className="tool-body">
                    <span className="tool-name">aria2c</span>
                    <span className="tool-desc">Torrent fallback for magnet links and torrent files</span>
                    {health?.aria2cPath ? <span className="tool-path">{health.aria2cPath}</span> : null}
                    {health?.aria2cError ? <span className="tool-error">{consumerErrorMessage(health.aria2cError)}</span> : null}
                  </div>
                  <div className="tool-actions">
                    <button type="button" className="tool-btn tool-btn-ghost" onClick={checkAria2cUpdate} disabled={!desktop || aria2cStatus !== "idle"}>
                      {aria2cStatus === "checking" ? <Loader2 className="spin" size={12} strokeWidth={2} aria-hidden /> : <RefreshCcw size={12} strokeWidth={2} aria-hidden />}
                      Check
                    </button>
                  </div>
                </li>

                <li className="tool-row">
                  <span className={`tool-dot ${health?.ffmpegOk ? "tool-dot-ok" : "tool-dot-dim"}`} aria-hidden />
                  <div className="tool-body">
                    <span className="tool-name">ffmpeg</span>
                    <span className="tool-desc">Merge, convert, and clean saved media</span>
                    {health?.ffmpeg ? <span className="tool-path">{health.ffmpeg}</span> : null}
                  </div>
                  <div className="tool-actions">
                    <button type="button" className="tool-btn tool-btn-ghost" onClick={checkFfmpegUpdate} disabled={!desktop || ffmpegStatus !== "idle"}>
                      {ffmpegStatus === "checking" ? <Loader2 className="spin" size={12} strokeWidth={2} aria-hidden /> : <RefreshCcw size={12} strokeWidth={2} aria-hidden />}
                      Check
                    </button>
                  </div>
                </li>

              </ul>
            </section>
            )}

            {settingsSection === "appearance" && (
            <section className="settings-section">
              <div className="ingest-toggle-list">
                <div className="ingest-toggle-row">
                  <span>
                    <b>Font smoothing</b>
                    <small>Use native macOS font anti-aliasing</small>
                  </span>
                  <button
                    type="button"
                    className={`ingest-toggle-btn ${fontSmoothing ? "is-active" : ""}`}
                    onClick={() => setFontSmoothing(!fontSmoothing)}
                    aria-pressed={fontSmoothing}
                  >
                    {fontSmoothing ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
            </section>
            )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
