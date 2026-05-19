import { Cookie, Download, ExternalLink, FolderOpen, FolderSearch, Globe2, Loader2, Radar as RadarIcon, RefreshCcw, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppUpdateInfo, BrowserInfo, CookieSource, EngineHealth, GalleryDlUpdateInfo, IndexSearchResponse, IndexStatusResponse, OpenRouterModelCatalog, PageProbeCandidate, PresetOption, ProviderId, ProviderOption, YtDlpUpdateInfo } from "../../electron/types";
import { sourceUrl, useDownloadQueue } from "./app/useDownloadQueue";
import type { QueueItem } from "./app/useDownloadQueue";
import { useLibraryIndex } from "./app/useLibraryIndex";
import type { IndexBusy } from "./app/useLibraryIndex";
import { useSourceSearch } from "./app/useSourceSearch";
import { createDesktopClient } from "./client/desktopClient";
import { AppHeader } from "./components/AppHeader";
import { LibraryView } from "./views/LibraryView";
import { ProjectIntakeView } from "./views/ProjectIntakeView";
import { SettingsView } from "./views/SettingsView";
import { consumerErrorMessage, consumerNoticeMessage } from "./app/appFormatters";
import { indexStatusLine } from "./app/libraryDisplayUtils";
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
const NETWORK_ACCESS_OPTIONS = [
  {
    id: "proton",
    label: "Proton VPN Free",
    detail: "Free VPN app. Best normal-user option.",
    url: "https://protonvpn.com/free-vpn",
  },
  {
    id: "warp",
    label: "Cloudflare WARP",
    detail: "Free OS-level routing. Simple, less configurable.",
    url: "https://one.one.one.one/",
  },
  {
    id: "mullvad",
    label: "Mullvad",
    detail: "Cheap paid VPN. Cleanest serious pick.",
    url: "https://mullvad.net/",
  },
  {
    id: "tor",
    label: "Tor Browser",
    detail: "Browser-only fallback. Bad for big downloads.",
    url: "https://www.torproject.org/download/",
  },
] as const;

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

function isLikelyMediaPageUrl(input: string | undefined): boolean {
  if (!input) return false;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }
  const path = parsed.pathname.toLowerCase();
  if (/\.(?:m3u8|mpd|mp4|m4v|webm|mov|mkv|avi|3gp|ts|m4s|jpg|jpeg|png|gif|webp|avif|pdf)(?:$|[?#])/.test(path)) return false;
  if (/\/(?:search|tag|tags|category|categories|channels?|users?|models?|pornstars?|playlist|playlists|feed|latest|popular|sort|filter)(?:\/|$)/.test(path)) return false;
  return /\/(?:video|videos|watch|embed|view|post|posts|media|item|reel|reels|clip|clips|short|shorts)(?:\/|$)/.test(path);
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push(url);
  }
  return output;
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

function privateOutputRoot(root: string): string {
  const trimmed = root.trim();
  if (!trimmed) return "";
  const separator = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return `${trimmed.replace(/[\\/]+$/, "")}${separator}.rippo-private`;
}

const FETCH_WORKER_MIN = 1;
const FETCH_WORKER_MAX = 12;
const FETCH_WORKER_DEFAULT = 6;
const DOWNLOAD_WORKER_MIN = 1;
const DOWNLOAD_WORKER_MAX = 8;
const DOWNLOAD_WORKER_DEFAULT = 3;

function clampWorkerSetting(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readWorkerSetting(key: string, fallback: number, min: number, max: number): number {
  const value = Number(localStorage.getItem(key));
  return clampWorkerSetting(Number.isFinite(value) && value > 0 ? value : fallback, min, max);
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
  const [networkProxyDraft, setNetworkProxyDraft] = useState("");
  const [networkProxyStatus, setNetworkProxyStatus] = useState<"idle" | "saving" | "testing">("idle");
  const [networkProxyError, setNetworkProxyError] = useState<string | null>(null);
  const [networkProxyResult, setNetworkProxyResult] = useState<string | null>(null);
  const [ytDlpUpdate, setYtDlpUpdate] = useState<YtDlpUpdateInfo | null>(null);
  const [ytDlpStatus, setYtDlpStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [ytDlpError, setYtDlpError] = useState<string | null>(null);
  const [galleryDlUpdate, setGalleryDlUpdate] = useState<GalleryDlUpdateInfo | null>(null);
  const [galleryDlStatus, setGalleryDlStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [galleryDlError, setGalleryDlError] = useState<string | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [appUpdateStatus, setAppUpdateStatus] = useState<"idle" | "checking">("idle");
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);
  const [qbittorrentStatus, setQbittorrentStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [aria2cStatus, setAria2cStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [ffmpegStatus, setFfmpegStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [aiCatalog, setAiCatalog] = useState<OpenRouterModelCatalog | null>(null);
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "saving">("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"general" | "search" | "ingest" | "watch" | "access" | "tools" | "appearance">("general");
  const [fontSmoothing, setFontSmoothing] = useState(() => localStorage.getItem("rippo:appearance:fontSmoothing") !== "false");
  const [pageProbeBusy, setPageProbeBusy] = useState(false);
  const [pageProbeError, setPageProbeError] = useState<string | null>(null);
  const [pageProbeNotice, setPageProbeNotice] = useState<string | null>(null);
  const [pageProbeIncognito, setPageProbeIncognito] = useState(() => localStorage.getItem("rippo:sniff:incognito") === "true");
  const [fetchWorkerCount, setFetchWorkerCount] = useState(() => readWorkerSetting("rippo:queue:fetchWorkers", FETCH_WORKER_DEFAULT, FETCH_WORKER_MIN, FETCH_WORKER_MAX));
  const [downloadWorkerCount, setDownloadWorkerCount] = useState(() => readWorkerSetting("rippo:queue:downloadWorkers", DOWNLOAD_WORKER_DEFAULT, DOWNLOAD_WORKER_MIN, DOWNLOAD_WORKER_MAX));
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
    localStorage.setItem("rippo:sniff:incognito", String(pageProbeIncognito));
  }, [pageProbeIncognito]);

  useEffect(() => {
    localStorage.setItem("rippo:queue:fetchWorkers", String(fetchWorkerCount));
  }, [fetchWorkerCount]);

  useEffect(() => {
    localStorage.setItem("rippo:queue:downloadWorkers", String(downloadWorkerCount));
  }, [downloadWorkerCount]);

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
      setNetworkProxyDraft(nextHealth.networkProxy || "");
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

  async function saveNetworkProxy() {
    if (!desktop || typeof desktop.setNetworkProxy !== "function" || networkProxyStatus !== "idle") return;
    setNetworkProxyStatus("saving");
    setNetworkProxyError(null);
    setNetworkProxyResult(null);
    try {
      const result = await desktop.setNetworkProxy(networkProxyDraft);
      setNetworkProxyDraft(result.networkProxy);
      setHealth(result.health);
      if (result.health.outputRoot) setOutputRoot(result.health.outputRoot);
    } catch (error) {
      setNetworkProxyError(error instanceof Error ? error.message : String(error));
    } finally {
      setNetworkProxyStatus("idle");
    }
  }

  async function testNetworkProxy() {
    if (!desktop || typeof desktop.checkNetworkProxy !== "function" || networkProxyStatus !== "idle") return;
    setNetworkProxyStatus("testing");
    setNetworkProxyError(null);
    setNetworkProxyResult(null);
    try {
      const result = await desktop.checkNetworkProxy(networkProxyDraft);
      if (result.ok) setNetworkProxyResult(result.ip ? `Proxy works. Exit IP: ${result.ip}` : "Proxy works.");
      else setNetworkProxyError(result.error || "Proxy test failed.");
    } catch (error) {
      setNetworkProxyError(error instanceof Error ? error.message : String(error));
    } finally {
      setNetworkProxyStatus("idle");
    }
  }

  async function setPrivateMode(enabled: boolean) {
    setPageProbeIncognito(enabled);
    setPageProbeError(null);
    setPageProbeNotice(enabled ? "Private mode: sniff cache cleared, downloads go to hidden .rippo-private." : "Private mode closed: sniff cache cleared.");
    if (desktop && typeof desktop.clearSniffCache === "function") {
      await desktop.clearSniffCache().catch(() => undefined);
    }
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

  async function checkAppUpdate() {
    if (!desktop || appUpdateStatus !== "idle") return;
    if (typeof desktop.checkAppUpdate !== "function") {
      setAppUpdateError("Restart Rippopotamus to load the app update checker.");
      return;
    }
    setAppUpdateStatus("checking");
    setAppUpdateError(null);
    try {
      const result = await desktop.checkAppUpdate();
      setAppUpdate(result);
      setAppUpdateError(result.error || null);
    } catch (error) {
      setAppUpdateError(error instanceof Error ? error.message : String(error));
    } finally {
      setAppUpdateStatus("idle");
    }
  }

  async function downloadAppUpdate() {
    if (!desktop || !appUpdate?.dmgUrl) return;
    await desktop.openExternal(appUpdate.dmgUrl);
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
  const activeOutputRoot = pageProbeIncognito ? privateOutputRoot(outputRoot) : outputRoot;
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
    outputRoot: activeOutputRoot,
    fetchWorkerCount,
    downloadWorkerCount,
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

  async function sniffPage() {
    const url = inputUrls[0];
    if (!url || !desktop || typeof desktop.probePage !== "function" || pageProbeBusy) return;
    setPageProbeBusy(true);
    setPageProbeError(null);
    setPageProbeNotice(null);
    resetSourceSearch();
    try {
      const result = await desktop.probePage(url, { incognito: pageProbeIncognito });
      if (!result.ok) {
        setPageProbeError(result.error || "Could not sniff this page.");
        return;
      }

      // --- Candidate selection with sane priorities ---
      // The policy layer already rejects noise (segments, ads, thumbnails,
      // blob/data) and scores survivors on a 0-100 tier scale. We just need
      // to pick the right bucket to queue.

      const STRONG_SCORE = 40;
      const strongKinds = new Set(["playlist", "video", "audio", "torrent", "pdf"]);
      const strong = result.candidates.filter((c) => strongKinds.has(c.kind) && c.score >= STRONG_SCORE);
      const decent = result.candidates.filter((c) => c.score >= 20);
      const pageLinkUrls = uniqueUrls((result.pageLinks || []).map((l) => l.url));
      const sourcePageUrl = uniqueUrls([result.finalUrl, result.url, url]).find(isLikelyMediaPageUrl);

      // Priority 1: Strong direct media found → use it
      // Priority 2: Crawled links found media → use all decent candidates (they include crawl results)
      // Priority 3: Source page is itself a media page → send that URL to the fetcher
      // Priority 4: Page links to other media pages → send those
      // Priority 5: Any surviving candidates at all → use them
      let chosen: string[];
      let chosenType: string;

      if (strong.length > 0) {
        chosen = uniqueUrls(strong.map((c) => c.url));
        chosenType = "media";
      } else if (result.crawledLinks && decent.length > 0) {
        chosen = uniqueUrls(decent.map((c) => c.url));
        chosenType = "media";
      } else if (sourcePageUrl) {
        chosen = [sourcePageUrl];
        chosenType = "page";
      } else if (pageLinkUrls.length > 0) {
        chosen = pageLinkUrls;
        chosenType = "page";
      } else if (decent.length > 0) {
        chosen = uniqueUrls(decent.map((c) => c.url));
        chosenType = "candidate";
      } else {
        setPageProbeError("No downloadable media or result pages found on that page.");
        return;
      }

      setInput("");
      await queueUrls(chosen.slice(0, 40));

      const countLabel = `${chosen.length} ${chosenType}${chosen.length === 1 ? "" : "s"}`;
      const crawlLabel = result.crawledLinks ? `, crawled ${result.crawledLinks} link${result.crawledLinks === 1 ? "" : "s"}` : "";
      if (result.cached) setPageProbeNotice(`Used cached sniff: ${countLabel}${crawlLabel}.`);
      else if (pageProbeIncognito) setPageProbeNotice(`Private sniff: ${countLabel}${crawlLabel}, not cached.`);
      else if (result.elapsedMs) setPageProbeNotice(`Sniff done: ${countLabel}${crawlLabel} in ${(result.elapsedMs / 1000).toFixed(1)}s.`);
      else setPageProbeNotice(null);
    } catch (error) {
      setPageProbeError(error instanceof Error ? error.message : String(error));
    } finally {
      setPageProbeBusy(false);
    }
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

  function openNetworkAccessOption(url: string) {
    if (desktop) desktop.openExternal(url).catch(() => undefined);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  const showIntakeEmptyHint = items.length === 0 && !hasComposerText && !indexSearch.query && !indexError && indexBusy === "idle" && !sourceSearch.query && !sourceSearch.results.length && !sourceSearch.error && !sourceSearchBusy;

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
          pageProbeBusy={pageProbeBusy}
          setInput={setInput}
          clearIndexError={clearIndexError}
          runComposerAction={runComposerAction}
          sniffPage={sniffPage}
          chooseSearchScope={chooseSearchScope}
          setActiveSourcePack={setActiveSourcePack}
          setFetchProvider={setFetchProvider}
          openSettings={() => setSettingsOpen(true)}
          showHero={showIntakeEmptyHint}
        />

        <section className="workspace">
          {healthError ? <p className="error-text">{healthError}</p> : null}
          <LibraryView
            desktop={desktop}
            activeOutputRoot={activeOutputRoot}
            indexBusy={indexBusy}
            indexSearch={indexSearch}
            indexStatus={indexStatus}
            indexError={indexError}
            hasComposerText={hasComposerText}
            expandedLibraryId={expandedLibraryId}
            setExpandedLibraryId={setExpandedLibraryId}
            libraryThumbs={libraryThumbs}
            libraryMediaUrls={libraryMediaUrls}
            consumerErrorMessage={consumerErrorMessage}
          />
          <ProjectIntakeView
            desktop={desktop}
            activeOutputRoot={activeOutputRoot}
            cookieSource={cookieSource}
            libraryIndexRoot={health?.libraryIndexRoot}
            consumerErrorMessage={consumerErrorMessage}
            consumerNoticeMessage={consumerNoticeMessage}
            sourceSearch={sourceSearch}
            sourceSearchBusy={sourceSearchBusy}
            input={input}
            pageProbeError={pageProbeError}
            pageProbeNotice={pageProbeNotice}
            items={items}
            totals={totals}
            busy={busy}
            showIntakeEmptyHint={showIntakeEmptyHint}
            browsers={browsers}
            presetOptions={presetOptions}
            providerOptions={providerOptions}
            downloadReady={downloadReady}
            openSource={openSource}
            setItemPreset={setItemPreset}
            setItemCookieSource={setItemCookieSource}
            refetch={refetch}
            removeItem={removeItem}
          />
        </section>

      </div>
      {health && !health.ok && health.error ? <p className="error-text health-banner">{health.error}</p> : null}
      {settingsOpen ? (
        <SettingsView
          onClose={() => setSettingsOpen(false)}
          section={settingsSection}
          setSection={setSettingsSection}
        >
            {settingsSection === "general" && (
            <>
            <section className="settings-section">
              <div className="settings-row-head">
                <FolderOpen size={14} strokeWidth={2} aria-hidden />
                <h3 className="settings-row-title">Download location</h3>
              </div>
              <p className="settings-hint settings-path-display" title={outputRoot || undefined}>
                {outputRoot || "Will use ~/Downloads/Rippo"}
              </p>
              {pageProbeIncognito ? (
                <p className="settings-hint settings-path-display" title={activeOutputRoot || undefined}>
                  Private saves: {activeOutputRoot || "Set a download folder first"}
                </p>
              ) : null}
              <div className="settings-actions">
                <button type="button" className="btn btn-primary btn-footer" onClick={chooseOutputRoot} disabled={!desktop}>
                  <FolderSearch size={14} strokeWidth={2} aria-hidden /> Choose…
                </button>
                <button type="button" className="btn btn-ghost btn-footer" onClick={resetOutputRoot} disabled={!desktop} title="Reset to ~/Downloads/Rippo">
                  <RotateCcw size={14} strokeWidth={2} aria-hidden /> Default
                </button>
              </div>
            </section>
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
            </>
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
              <h3 className="settings-row-title">Index saved files</h3>
              <p className="settings-hint">Filenames and basic metadata only.</p>
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
              </div>
              <p className="settings-hint">
                Automated channel watching is not yet available in this build.
              </p>
            </section>
            )}

            {settingsSection === "access" && (
            <>
            <section className="settings-section">
              <div className="ingest-toggle-list">
                <div className="ingest-toggle-row">
                  <span>
                    <b>Private mode</b>
                    <small>Hidden .rippo-private saves, sandboxed sniffing, cache clears on close</small>
                  </span>
                  <button
                    type="button"
                    className={`ingest-toggle-btn ${pageProbeIncognito ? "is-active" : ""}`}
                    onClick={() => { void setPrivateMode(!pageProbeIncognito); }}
                    aria-pressed={pageProbeIncognito}
                  >
                    {pageProbeIncognito ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
            </section>
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
            <section className="settings-section">
              <div className="settings-row-head">
                <Globe2 size={14} strokeWidth={2} aria-hidden />
                <h3 className="settings-row-title">Network proxy</h3>
                <span className="settings-version">{health?.networkProxyEnabled ? "On" : "Off"}</span>
              </div>
              <p className="settings-hint">Use your own HTTP or SOCKS proxy for video, image, and Drive downloads. This does not change torrent routing.</p>
              <div className="settings-inline-control">
                <input
                  type="text"
                  className="settings-text-input"
                  value={networkProxyDraft}
                  onChange={(event) => setNetworkProxyDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") void saveNetworkProxy(); }}
                  placeholder="socks5://127.0.0.1:9050"
                  aria-label="Network proxy URL"
                  disabled={!desktop || networkProxyStatus !== "idle"}
                />
                <button type="button" className="btn btn-primary btn-footer" onClick={saveNetworkProxy} disabled={!desktop || networkProxyStatus !== "idle"}>
                  {networkProxyStatus === "saving" ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : null}
                  Save
                </button>
                <button type="button" className="btn btn-ghost btn-footer" onClick={testNetworkProxy} disabled={!desktop || networkProxyStatus !== "idle" || !networkProxyDraft.trim()}>
                  {networkProxyStatus === "testing" ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : null}
                  Test
                </button>
              </div>
              {networkProxyDraft ? <p className="settings-hint">Active after save: {networkProxyDraft}</p> : <p className="settings-hint">Leave blank for direct connection.</p>}
              {networkProxyResult ? <p className="settings-ok">{networkProxyResult}</p> : null}
              {networkProxyError ? <p className="settings-warning">{consumerErrorMessage(networkProxyError, "Could not save network proxy.")}</p> : null}
            </section>

            </>
            )}

            {settingsSection === "tools" && (
            <section className="settings-section">
              <div className="settings-row-head">
                <Download size={14} strokeWidth={2} aria-hidden />
                <h3 className="settings-row-title">Queue workers</h3>
                <span className="settings-version">{fetchWorkerCount} read · {downloadWorkerCount} save</span>
              </div>
              <div className="worker-control-list">
                <label className="worker-field">
                  <span className="worker-field-head">
                    <b>Metadata workers</b>
                    <strong>{fetchWorkerCount}</strong>
                  </span>
                  <input
                    type="range"
                    min={FETCH_WORKER_MIN}
                    max={FETCH_WORKER_MAX}
                    step={1}
                    value={fetchWorkerCount}
                    onChange={(event) => setFetchWorkerCount(clampWorkerSetting(Number(event.target.value), FETCH_WORKER_MIN, FETCH_WORKER_MAX))}
                    aria-label="Metadata workers"
                  />
                </label>
                <label className="worker-field">
                  <span className="worker-field-head">
                    <b>Download workers</b>
                    <strong>{downloadWorkerCount}</strong>
                  </span>
                  <input
                    type="range"
                    min={DOWNLOAD_WORKER_MIN}
                    max={DOWNLOAD_WORKER_MAX}
                    step={1}
                    value={downloadWorkerCount}
                    onChange={(event) => setDownloadWorkerCount(clampWorkerSetting(Number(event.target.value), DOWNLOAD_WORKER_MIN, DOWNLOAD_WORKER_MAX))}
                    aria-label="Download workers"
                  />
                </label>
              </div>
              <ul className="tool-list" role="list">

                <li className="tool-row">
                  <span className={`tool-dot ${appUpdate?.updateAvailable ? "tool-dot-ok" : "tool-dot-dim"}`} aria-hidden />
                  <div className="tool-body">
                    <span className="tool-name">Rippopotamus app</span>
                    <span className="tool-path">
                      {appUpdate?.latestVersion
                        ? `Current ${appUpdate.currentVersion} · Latest ${appUpdate.latestVersion}`
                        : appUpdate?.configured === false
                          ? "Set RIPPO_APP_UPDATE_MANIFEST_URL to enable DMG checks."
                          : `Current ${appUpdate?.currentVersion || "0.1.0"}`}
                    </span>
                    {appUpdate?.notes?.[0] ? <span className="tool-path">{appUpdate.notes[0]}</span> : null}
                    {appUpdateError ? <span className="tool-error">{consumerErrorMessage(appUpdateError)}</span> : null}
                  </div>
                  <div className="tool-actions">
                    {appUpdate?.updateAvailable && appUpdate.dmgUrl ? (
                      <button type="button" className="tool-btn tool-btn-primary" onClick={downloadAppUpdate} disabled={!desktop}>
                        <ExternalLink size={12} strokeWidth={2} aria-hidden />
                        Download
                      </button>
                    ) : (
                      <button type="button" className="tool-btn tool-btn-ghost" onClick={checkAppUpdate} disabled={!desktop || appUpdateStatus !== "idle"}>
                        {appUpdateStatus === "checking" ? <Loader2 className="spin" size={12} strokeWidth={2} aria-hidden /> : <RefreshCcw size={12} strokeWidth={2} aria-hidden />}
                        Check
                      </button>
                    )}
                  </div>
                </li>

                <li className="tool-row">
                  <span className={`tool-dot ${health?.python ? "tool-dot-ok" : "tool-dot-dim"}`} aria-hidden />
                  <div className="tool-body">
                    <span className="tool-name">Python</span>
                    {health?.python ? <span className="tool-path">{health.python}</span> : null}
                  </div>
                  <span className="tool-status">{pythonStatusText(health, healthError)}</span>
                </li>

                <li className="tool-row">
                  <span className={`tool-dot ${health?.ytDlp ? "tool-dot-ok" : "tool-dot-dim"}`} aria-hidden />
                  <div className="tool-body">
                    <span className="tool-name">yt-dlp</span>
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


        </SettingsView>
      ) : null}
    </main>
  );
}
