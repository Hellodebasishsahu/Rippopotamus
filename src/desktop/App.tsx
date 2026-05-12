import { Cookie, Download, ExternalLink, FileAudio, Film, FolderOpen, FolderSearch, Image as ImageIcon, Loader2, Monitor, Play, Radar as RadarIcon, RefreshCcw, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BrowserInfo, CookieSource, DownloadEvent, EngineHealth, FetchResponse, GalleryDlUpdateInfo, IndexIngestLimits, IndexIngestSettings, IndexSearchResponse, IndexSearchResult, IndexStatusResponse, OpenRouterModelCatalog, PresetOption, ProviderId, ProviderOption, SourceSearchPack, SourceSearchResponse, SourceSearchResult, YtDlpUpdateInfo } from "../../electron/types";
import { AppHeader } from "./components/AppHeader";
import { QueueCard } from "./components/QueueCard";
import { SourceSearchPanel } from "./components/SourceSearchPanel";
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

type SearchScope = "library" | "web";

const AUTO_PROVIDER = "auto";
const COOKIE_OFF: CookieSource = { mode: "off" };
const DEFAULT_INDEX_INGEST_LIMITS: IndexIngestLimits = {
  provider: "gemini",
  label: "Gemini Embedding 2",
  model: "gemini-embedding-2",
  videoSeconds: 120,
  recommendedDimensions: [768, 1536, 3072],
  chunkDuration: { min: 5, max: 120, step: 5, default: 30 },
  overlap: { min: 0, max: 29, step: 1, default: 5 },
  targetResolution: { min: 144, max: 1080, step: 16, default: 480 },
  targetFps: { min: 1, max: 15, step: 1, default: 5 },
};
const DEFAULT_INDEX_INGEST_SETTINGS: IndexIngestSettings = {
  provider: "gemini",
  chunkDuration: 30,
  overlap: 5,
  preprocess: true,
  skipStill: true,
  targetResolution: 480,
  targetFps: 5,
};
const GEMINI_VIDEO_EMBED_USD_PER_FRAME = 0.00079;
const USD_TO_INR_ESTIMATE = 94.4;

function estimateIngestCostPerHour(settings: Pick<IndexIngestSettings, "chunkDuration" | "overlap" | "targetFps">): number {
  const step = Math.max(1, settings.chunkDuration - settings.overlap);
  const overlapMultiplier = settings.chunkDuration / step;
  return 3600 * settings.targetFps * GEMINI_VIDEO_EMBED_USD_PER_FRAME * overlapMultiplier;
}

function formatCostPerHour(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  const inr = value * USD_TO_INR_ESTIMATE;
  if (inr >= 1000) return `~₹${(inr / 1000).toFixed(1)}k/hr`;
  if (inr < 100) return `~₹${Math.round(inr)}/hr`;
  return `~₹${Math.round(inr / 10) * 10}/hr`;
}

function formatUsdPerHour(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return `$${value.toFixed(value >= 10 ? 0 : 2)}/hr`;
}

function presetDetail(settings: Pick<IndexIngestSettings, "chunkDuration" | "overlap" | "targetResolution" | "targetFps">): string {
  return `${formatCostPerHour(estimateIngestCostPerHour(settings))} · ${settings.targetResolution}p/${settings.targetFps}fps`;
}

const INGEST_PRESETS: Array<{
  id: string;
  name: string;
  description: string;
  settings: Pick<IndexIngestSettings, "chunkDuration" | "overlap" | "targetResolution" | "targetFps" | "preprocess" | "skipStill">;
}> = [
  {
    id: "quick",
    name: "Quick scan",
    description: "Good for rough search across lots of footage.",
    settings: { chunkDuration: 60, overlap: 5, targetResolution: 360, targetFps: 3, preprocess: true, skipStill: true },
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Best default for normal clips and saved downloads.",
    settings: { chunkDuration: 30, overlap: 5, targetResolution: 480, targetFps: 5, preprocess: true, skipStill: true },
  },
  {
    id: "detail",
    name: "Detail search",
    description: "Better for faces, signs, text, and small objects.",
    settings: { chunkDuration: 15, overlap: 5, targetResolution: 720, targetFps: 8, preprocess: true, skipStill: true },
  },
  {
    id: "motion",
    name: "Fast action",
    description: "Use when quick cuts or gestures matter.",
    settings: { chunkDuration: 10, overlap: 4, targetResolution: 720, targetFps: 12, preprocess: true, skipStill: false },
  },
];
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
const EMPTY_INDEX_SEARCH: IndexSearchResponse = {
  ok: false,
  query: "",
  indexRoot: "",
  assetCount: 0,
  momentCount: 0,
  embeddedMomentCount: 0,
  embeddingEndpointConfigured: false,
  results: [],
  resultCount: 0,
};

function formatDuration(seconds?: number) {
  if (!seconds) return "Unknown length";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

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
  if (status.momentCount && !status.embeddedMomentCount) return `${status.assetCount} files · scan needed`;
  return `${status.assetCount} files · ${status.momentCount} moments`;
}

function savedFootageBadge(status: IndexStatusResponse | null): string {
  if (!status || !status.assetCount) return "No saved footage";
  if (status.momentCount && !status.embeddedMomentCount) return "Scan needed";
  if (status.momentCount) return `${status.momentCount} moments`;
  return "No moments";
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

function thumbnailUrls(item: QueueItem): string[] {
  const candidates = [
    item.metadata?.thumbnail,
    ...(item.metadata?.thumbnails || []),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(candidates));
}

function currentIngestPreset(settings: IndexIngestSettings): string {
  const match = INGEST_PRESETS.find((preset) => (
    preset.settings.chunkDuration === settings.chunkDuration &&
    preset.settings.overlap === settings.overlap &&
    preset.settings.targetResolution === settings.targetResolution &&
    preset.settings.targetFps === settings.targetFps &&
    preset.settings.preprocess === settings.preprocess &&
    preset.settings.skipStill === settings.skipStill
  ));
  return match?.id || "custom";
}

function indexEmptyState(indexBusy: "idle" | "ingesting" | "searching", indexSearch: IndexSearchResponse, indexStatus: IndexStatusResponse | null, hasComposerText: boolean): { title: string; detail: string } {
  if (indexBusy === "searching") {
    return { title: "Searching saved footage...", detail: "Looking through the saved folder." };
  }
  if (indexStatus?.momentCount && !indexStatus.embeddedMomentCount) {
    return {
      title: "Scan needed to search inside videos",
      detail: indexSearch.query ? `Right now Rippo only knows file names. Use Settings > Ingest to search for "${indexSearch.query}" visually.` : "Right now Rippo only knows file names. Use Settings > Ingest to search scenes and speech.",
    };
  }
  if (indexSearch.query) {
    return { title: `No matches for "${indexSearch.query}"`, detail: "Try a simpler scene, object, person, or spoken phrase." };
  }
  if (hasComposerText) {
    return { title: "Ready to search saved footage", detail: "Hit Search to look inside your saved folder." };
  }
  if (indexStatus?.momentCount) {
    return { title: "Search saved footage", detail: "Try a scene, object, person, or spoken words." };
  }
  return { title: "No saved footage scanned yet", detail: "Use Settings > Ingest when you want to add saved videos." };
}

export function App() {
  const rippo = window.rippo;
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("library");
  const [activeSourcePack, setActiveSourcePack] = useState("all");
  const [sourceSearch, setSourceSearch] = useState<SourceSearchResponse>(EMPTY_SOURCE_SEARCH);
  const [sourceSearchBusy, setSourceSearchBusy] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatusResponse | null>(null);
  const [indexSearch, setIndexSearch] = useState<IndexSearchResponse>(EMPTY_INDEX_SEARCH);
  const [indexBusy, setIndexBusy] = useState<"idle" | "ingesting" | "searching">("idle");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [libraryThumbs, setLibraryThumbs] = useState<Record<string, string | null>>({});
  const [expandedLibraryId, setExpandedLibraryId] = useState<string | null>(null);
  const [libraryMediaUrls, setLibraryMediaUrls] = useState<Record<string, string | null>>({});
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
  const [qbittorrentStatus, setQbittorrentStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [aria2cStatus, setAria2cStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [ffmpegStatus, setFfmpegStatus] = useState<"idle" | "checking" | "updating">("idle");
  const [aiCatalog, setAiCatalog] = useState<OpenRouterModelCatalog | null>(null);
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "saving">("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"general" | "search" | "ingest" | "watch" | "access" | "tools" | "appearance">("general");
  const [fontSmoothing, setFontSmoothing] = useState(() => localStorage.getItem("rippo:appearance:fontSmoothing") !== "false");
  const [indexIngestSettings, setIndexIngestSettings] = useState<IndexIngestSettings>(DEFAULT_INDEX_INGEST_SETTINGS);
  const [indexIngestLimits, setIndexIngestLimits] = useState<IndexIngestLimits>(DEFAULT_INDEX_INGEST_LIMITS);
  const [indexSettingsStatus, setIndexSettingsStatus] = useState<"idle" | "saving">("idle");
  const [indexSettingsError, setIndexSettingsError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    if (!settingsOpen || !rippo || typeof rippo.listAiModels !== "function" || aiCatalog) return;
    void loadAiModels(false);
  }, [settingsOpen, rippo, aiCatalog]);

  useEffect(() => {
    if (!rippo || typeof rippo.getIndexIngestSettings !== "function") return;
    rippo.getIndexIngestSettings().then((result) => {
      setIndexIngestSettings({ ...DEFAULT_INDEX_INGEST_SETTINGS, ...result });
      setIndexIngestLimits(result.limits || DEFAULT_INDEX_INGEST_LIMITS);
    }).catch(() => undefined);
  }, [rippo]);

  useEffect(() => {
    if (!rippo) return;
    rippo.listBrowsers().then((result) => {
      setBrowsers(result.browsers);
      setCookieSource(cookieSourceFromResponse(result.source, result.selected));
    }).catch(() => undefined);
  }, [rippo]);

  useEffect(() => {
    if (!rippo || typeof rippo.libraryThumbnail !== "function") return;
    let cancelled = false;
    const pending = indexSearch.results.filter((r) => !(r.id in libraryThumbs));
    if (pending.length === 0) return;
    (async () => {
      for (const result of pending) {
        if (cancelled) return;
        try {
          const res = await rippo.libraryThumbnail({ path: result.path, time: result.start ?? 0 });
          if (cancelled) return;
          setLibraryThumbs((prev) => ({ ...prev, [result.id]: res?.url || null }));
        } catch {
          if (!cancelled) setLibraryThumbs((prev) => ({ ...prev, [result.id]: null }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [indexSearch.results, rippo, libraryThumbs]);

  useEffect(() => {
    if (!expandedLibraryId || !rippo || typeof rippo.libraryMediaUrl !== "function") return;
    if (expandedLibraryId in libraryMediaUrls) return;
    const result = indexSearch.results.find((r) => r.id === expandedLibraryId);
    if (!result) return;
    let cancelled = false;
    rippo.libraryMediaUrl({ path: result.path }).then((res) => {
      if (cancelled) return;
      setLibraryMediaUrls((prev) => ({ ...prev, [expandedLibraryId]: res?.url || null }));
    }).catch(() => {
      if (!cancelled) setLibraryMediaUrls((prev) => ({ ...prev, [expandedLibraryId]: null }));
    });
    return () => { cancelled = true; };
  }, [expandedLibraryId, rippo, indexSearch.results, libraryMediaUrls]);

  useEffect(() => {
    setLibraryThumbs({});
    setLibraryMediaUrls({});
    setExpandedLibraryId(null);
  }, [indexSearch.query, indexSearch.indexRoot]);

  async function refreshHealth() {
    if (!rippo) return null;
    try {
      const nextHealth = await rippo.health();
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
    if (!rippo) return;
    const next = cookieSourceFromValue(value);
    const result = typeof rippo.setDefaultCookieSource === "function"
      ? await rippo.setDefaultCookieSource(next)
      : await rippo.setCookiesBrowser(next.mode === "browser" ? next.browserId : null);
    setCookieSource(cookieSourceFromResponse(result.source, result.selected));
    await refreshHealth();
  }

  async function saveIndexIngestSettings(patch: Partial<IndexIngestSettings>) {
    const optimistic = { ...indexIngestSettings, ...patch };
    setIndexIngestSettings(optimistic);
    if (!rippo || typeof rippo.setIndexIngestSettings !== "function") return;
    setIndexSettingsStatus("saving");
    setIndexSettingsError(null);
    try {
      const saved = await rippo.setIndexIngestSettings(patch);
      setIndexIngestSettings({ ...DEFAULT_INDEX_INGEST_SETTINGS, ...saved });
      setIndexIngestLimits(saved.limits || DEFAULT_INDEX_INGEST_LIMITS);
    } catch (error) {
      setIndexSettingsError(consumerErrorMessage(error instanceof Error ? error.message : String(error), "Could not save ingest settings."));
    } finally {
      setIndexSettingsStatus("idle");
    }
  }

  function chooseIngestPreset(presetId: string) {
    const preset = INGEST_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    void saveIndexIngestSettings(preset.settings);
  }

  function chooseSearchScope(scope: SearchScope) {
    setSearchScope(scope);
    if (scope === "library") setSourceSearch(EMPTY_SOURCE_SEARCH);
    else {
      setIndexSearch(EMPTY_INDEX_SEARCH);
      setIndexError(null);
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

  async function checkQbittorrentUpdate() {
    if (!rippo || qbittorrentStatus !== "idle") return;
    setQbittorrentStatus("checking");
    try {
      await refreshHealth();
    } finally {
      setQbittorrentStatus("idle");
    }
  }

  async function checkAria2cUpdate() {
    if (!rippo || aria2cStatus !== "idle") return;
    setAria2cStatus("checking");
    try {
      await refreshHealth();
    } finally {
      setAria2cStatus("idle");
    }
  }

  async function checkFfmpegUpdate() {
    if (!rippo || ffmpegStatus !== "idle") return;
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
  const sourcePacks = useMemo(() => {
    const packs = [...DEFAULT_SOURCE_PACKS, ...sourceSearch.packs];
    return packs.filter((pack, index, list) => list.findIndex((candidate) => candidate.id === pack.id) === index);
  }, [sourceSearch.packs]);
  const providerOptions = health?.providers || [];
  const presetOptions = health?.presets || [];
  const defaultSiteAccess = siteAccessStatus(cookieSource, browsers, health);
  const selectedFetchProvider = fetchProvider || AUTO_PROVIDER;
  const composerAction = useMemo(() => resolveComposerAction({
      hasText: hasComposerText,
      urlCount: detectedCount,
      canUseDesktop: Boolean(rippo),
      hasProvider: Boolean(selectedFetchProvider),
      searchBusy: searchScope === "library" ? indexBusy === "searching" : sourceSearchBusy,
    }), [detectedCount, hasComposerText, indexBusy, rippo, searchScope, selectedFetchProvider, sourceSearchBusy]);
  const activeSearchBusy = composerAction.id === "search" && (searchScope === "library" ? indexBusy === "searching" : sourceSearchBusy);

  useEffect(() => {
    if (!rippo) {
      setHealthError("Desktop engine IPC is not available.");
      return;
    }
    void refreshHealth();
  }, [rippo]);

  useEffect(() => {
    if (!providerOptions.length) return;
    setFetchProvider((current) => current === AUTO_PROVIDER || providerOptions.some((provider) => provider.id === current) ? current : AUTO_PROVIDER);
  }, [providerOptions]);

  useEffect(() => {
    if (!rippo || typeof rippo.indexStatus !== "function" || !outputRoot) return;
    let cancelled = false;
    rippo.indexStatus(outputRoot).then((result) => {
      if (!cancelled) setIndexStatus(result);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rippo, outputRoot]);

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

  async function indexSavedFolder() {
    if (!rippo || !outputRoot) {
      setIndexError("Index runs inside the desktop app.");
      return;
    }

    setIndexBusy("ingesting");
    setIndexError(null);
    try {
      const result = typeof rippo.indexSemanticIngest === "function"
        ? await rippo.indexSemanticIngest({
            indexRoot: outputRoot,
            paths: [outputRoot],
            provider: indexIngestSettings.provider,
            chunkDuration: indexIngestSettings.chunkDuration,
            overlap: indexIngestSettings.overlap,
            preprocess: indexIngestSettings.preprocess,
            skipStill: indexIngestSettings.skipStill,
            targetResolution: indexIngestSettings.targetResolution,
            targetFps: indexIngestSettings.targetFps,
          })
        : await rippo.indexIngest({ indexRoot: outputRoot, paths: [outputRoot] });
      if (result.ok) setIndexStatus(result);
      else setIndexError(consumerErrorMessage(result.error || "", "Could not index this folder."));
    } catch (error) {
      setIndexError(consumerErrorMessage(error instanceof Error ? error.message : String(error), "Could not index this folder."));
    } finally {
      setIndexBusy("idle");
    }
  }

  async function searchSavedFootage(query = input.trim().slice(0, 240)) {
    if (!query) return;
    if (!rippo || typeof rippo.indexSearch !== "function" || !outputRoot) {
      setIndexSearch({ ...EMPTY_INDEX_SEARCH, query, indexRoot: outputRoot });
      setIndexError("Index search runs inside the desktop app.");
      return;
    }

    setIndexBusy("searching");
    setIndexError(null);
    try {
      const result = await rippo.indexSearch({ indexRoot: outputRoot, query, limit: 24 });
      setIndexSearch(result);
      setIndexStatus(result);
      if (!result.ok) setIndexError(consumerErrorMessage(result.error || "", "Could not search saved footage."));
    } catch (error) {
      setIndexSearch({ ...EMPTY_INDEX_SEARCH, query, indexRoot: outputRoot });
      setIndexError(consumerErrorMessage(error instanceof Error ? error.message : String(error), "Could not search the index."));
    } finally {
      setIndexBusy("idle");
    }
  }

  async function runComposerAction() {
    if (composerAction.id === "search") {
      if (searchScope === "library") await searchSavedFootage();
      else await searchSources();
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
          clearIndexError={() => {
            if (indexError) setIndexError(null);
          }}
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
                    const isVideo = result.kind === "video";
                    const isImage = result.kind === "image";
                    const isExpanded = expandedLibraryId === result.id;
                    const thumbUrl = libraryThumbs[result.id];
                    const mediaUrl = libraryMediaUrls[result.id];
                    const isPlayable = isVideo || result.kind === "audio" || isImage;
                    const toggleExpand = () => {
                      if (!isPlayable) return;
                      setExpandedLibraryId(isExpanded ? null : result.id);
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
                          onClick={() => rippo?.openFolder(folderForPath(result.path))}
                          disabled={!rippo}
                          title="Reveal in folder"
                        >
                          <FolderOpen size={13} strokeWidth={2} aria-hidden /> Reveal
                        </button>
                        {isExpanded ? (
                          <div className="index-player">
                            {mediaUrl ? (
                              isVideo ? (
                                <video
                                  className="index-player-video"
                                  src={mediaUrl}
                                  controls
                                  autoPlay
                                  preload="metadata"
                                  onLoadedMetadata={(event) => {
                                    const start = result.start ?? 0;
                                    if (start > 0) (event.currentTarget as HTMLVideoElement).currentTime = start;
                                  }}
                                />
                              ) : result.kind === "audio" ? (
                                <audio className="index-player-audio" src={mediaUrl} controls autoPlay preload="metadata" />
                              ) : (
                                <img className="index-player-image" src={mediaUrl} alt={result.title || result.file} />
                              )
                            ) : mediaUrl === null ? (
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
            openExternal={(url) => rippo?.openExternal(url)}
          />

          {items.length > 0 && (
            <div className="queue-summary-row">
              <p className="queue-summary">{items.length} · {totals.ready} ready · {totals.done} saved{totals.failed ? ` · ${totals.failed} failed` : ""}</p>
              <div className="queue-summary-actions">
                <button type="button" className="btn btn-ghost btn-footer" onClick={() => rippo?.openFolder(outputRoot)} disabled={!rippo} title={outputRoot || undefined}>
                  <FolderOpen size={14} strokeWidth={2} aria-hidden /> Open folder
                </button>
                <button type="button" className="btn btn-primary btn-footer" onClick={downloadReady} disabled={!totals.ready || busy || !rippo}>
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
                <button type="button" className="btn btn-primary btn-footer" onClick={chooseOutputRoot} disabled={!rippo}>
                  <FolderSearch size={14} strokeWidth={2} aria-hidden /> Choose…
                </button>
                <button type="button" className="btn btn-ghost btn-footer" onClick={resetOutputRoot} disabled={!rippo} title="Reset to ~/Downloads/Rippo">
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
                {aiCatalog?.models?.length ? `${aiCatalog.models.length} free text-only models cached. Selected: ${openRouterModelText(aiCatalog, health)}` : `Selected: ${openRouterModelText(aiCatalog, health)}`}
              </p>
              {aiError ? <p className="settings-warning">{consumerErrorMessage(aiError, "Could not refresh OpenRouter models.")}</p> : null}
            </section>
            )}

            {settingsSection === "ingest" && (
            <section className="settings-section ingest-section">
              <div className="ingest-compact-head">
                <div>
                  <h3 className="settings-row-title">Scan saved videos</h3>
                  <p className="settings-hint">Pick how hard Rippo should scan your saved folder before you search it.</p>
                </div>
                <span className="ingest-cost-pill">
                  {formatCostPerHour(estimateIngestCostPerHour(indexIngestSettings))}
                  <small>{formatUsdPerHour(estimateIngestCostPerHour(indexIngestSettings))} per source hour</small>
                </span>
              </div>
              <div className="ingest-preset-bar" role="group" aria-label="Index quality presets">
                {INGEST_PRESETS.map((preset) => {
                  const active = currentIngestPreset(indexIngestSettings) === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`ingest-preset-tab ${active ? "is-active" : ""}`}
                      onClick={() => chooseIngestPreset(preset.id)}
                    >
                      <span>{preset.name}</span>
                      <small>{presetDetail(preset.settings)}</small>
                    </button>
                  );
                })}
              </div>
              <p className="ingest-current-line">
                {(() => {
                  const preset = INGEST_PRESETS.find((item) => item.id === currentIngestPreset(indexIngestSettings));
                  return preset
                    ? `${preset.name}: ${preset.description}`
                    : `Custom: ${indexIngestSettings.chunkDuration}s clips, ${indexIngestSettings.overlap}s overlap, ${indexIngestSettings.targetResolution}p, ${indexIngestSettings.targetFps}fps.`;
                })()}
                {" "}Cost mostly follows frames per second.
              </p>
              <div className="ingest-grid">
                <label className="ingest-field">
                  <span className="ingest-field-head">
                    <span>Clip length</span>
                    <b>{indexIngestSettings.chunkDuration}s</b>
                  </span>
                  <input
                    type="range"
                    min={indexIngestLimits.chunkDuration.min}
                    max={indexIngestLimits.chunkDuration.max}
                    step={indexIngestLimits.chunkDuration.step}
                    value={indexIngestSettings.chunkDuration}
                    onChange={(event) => saveIndexIngestSettings({ chunkDuration: Number(event.target.value) })}
                  />
                  <span className="ingest-range-info">{indexIngestLimits.chunkDuration.min}s - {indexIngestLimits.chunkDuration.max}s</span>
                  <span className="ingest-help">Lower seconds means more exact results. Higher seconds means cheaper scanning.</span>
                </label>
                <label className="ingest-field">
                  <span className="ingest-field-head">
                    <span>Overlap</span>
                    <b>{indexIngestSettings.overlap}s</b>
                  </span>
                  <input
                    type="range"
                    min={indexIngestLimits.overlap.min}
                    max={Math.min(indexIngestLimits.overlap.max, Math.max(0, indexIngestSettings.chunkDuration - 1))}
                    step={indexIngestLimits.overlap.step}
                    value={indexIngestSettings.overlap}
                    onChange={(event) => saveIndexIngestSettings({ overlap: Number(event.target.value) })}
                  />
                  <span className="ingest-range-info">{indexIngestLimits.overlap.min}s - {Math.min(indexIngestLimits.overlap.max, Math.max(0, indexIngestSettings.chunkDuration - 1))}s</span>
                  <span className="ingest-help">Keeps moments from getting split between clips. More safety costs more.</span>
                </label>
                <label className="ingest-field">
                  <span className="ingest-field-head">
                    <span>Video size</span>
                    <b>{indexIngestSettings.targetResolution}p</b>
                  </span>
                  <input
                    type="range"
                    min={indexIngestLimits.targetResolution.min}
                    max={indexIngestLimits.targetResolution.max}
                    step={indexIngestLimits.targetResolution.step}
                    value={indexIngestSettings.targetResolution}
                    onChange={(event) => saveIndexIngestSettings({ targetResolution: Number(event.target.value) })}
                  />
                  <span className="ingest-range-info">{indexIngestLimits.targetResolution.min}p - {indexIngestLimits.targetResolution.max}p</span>
                  <span className="ingest-help">Higher detail helps signs, faces, and small objects. Frame count drives the bill more than size.</span>
                </label>
                <label className="ingest-field">
                  <span className="ingest-field-head">
                    <span>Frames per second</span>
                    <b>{indexIngestSettings.targetFps}</b>
                  </span>
                  <input
                    type="range"
                    min={indexIngestLimits.targetFps.min}
                    max={indexIngestLimits.targetFps.max}
                    step={indexIngestLimits.targetFps.step}
                    value={indexIngestSettings.targetFps}
                    onChange={(event) => saveIndexIngestSettings({ targetFps: Number(event.target.value) })}
                  />
                  <span className="ingest-range-info">{indexIngestLimits.targetFps.min} - {indexIngestLimits.targetFps.max} fps</span>
                  <span className="ingest-help">Main cost lever. Higher helps fast cuts, gestures, and action.</span>
                </label>
              </div>
              <div className="ingest-toggle-list">
                <div className="ingest-toggle-row">
                  <span>
                    <b>Preprocess chunks</b>
                    <small>Downscale before embedding to keep calls lighter.</small>
                  </span>
                  <button
                    type="button"
                    className={`ingest-toggle-btn ${indexIngestSettings.preprocess ? "is-active" : ""}`}
                    onClick={() => saveIndexIngestSettings({ preprocess: !indexIngestSettings.preprocess })}
                    aria-pressed={indexIngestSettings.preprocess}
                  >
                    {indexIngestSettings.preprocess ? "On" : "Off"}
                  </button>
                </div>
                <div className="ingest-toggle-row">
                  <span>
                    <b>Skip still chunks</b>
                    <small>Ignore video sections that look like a frozen frame.</small>
                  </span>
                  <button
                    type="button"
                    className={`ingest-toggle-btn ${indexIngestSettings.skipStill ? "is-active" : ""}`}
                    onClick={() => saveIndexIngestSettings({ skipStill: !indexIngestSettings.skipStill })}
                    aria-pressed={indexIngestSettings.skipStill}
                  >
                    {indexIngestSettings.skipStill ? "On" : "Off"}
                  </button>
                </div>
              </div>
              <div className="settings-actions ingest-actions">
                <button type="button" className="btn btn-primary btn-footer" onClick={indexSavedFolder} disabled={!rippo || indexBusy !== "idle"}>
                  {indexBusy === "ingesting" ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <FolderSearch size={14} strokeWidth={2} aria-hidden />}
                  Scan folder
                </button>
                <span className="settings-version">
                  {indexSettingsStatus === "saving"
                    ? "Saving..."
                    : `${indexIngestSettings.chunkDuration}s clips · ${indexIngestSettings.overlap}s overlap · ${indexIngestSettings.targetFps}fps`}
                </span>
              </div>
              {indexSettingsError ? <p className="settings-warning">{indexSettingsError}</p> : null}
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
                disabled={!rippo}
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
                <button type="button" className="btn btn-ghost btn-footer" onClick={() => refreshHealth()} disabled={!rippo}>
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
                      <button type="button" className="tool-btn tool-btn-primary" onClick={updateYtDlp} disabled={!rippo || ytDlpStatus !== "idle"}>
                        {ytDlpStatus === "updating" ? <Loader2 className="spin" size={12} strokeWidth={2} aria-hidden /> : null}
                        {ytDlpUpdate.currentVersion ? "Update" : "Install"}
                      </button>
                    ) : (
                      <button type="button" className="tool-btn tool-btn-ghost" onClick={checkYtDlpUpdate} disabled={!rippo || ytDlpStatus !== "idle"}>
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
                      <button type="button" className="tool-btn tool-btn-primary" onClick={updateGalleryDl} disabled={!rippo || galleryDlStatus !== "idle"}>
                        {galleryDlStatus === "updating" ? <Loader2 className="spin" size={12} strokeWidth={2} aria-hidden /> : null}
                        {galleryDlUpdate.currentVersion ? "Update" : "Install"}
                      </button>
                    ) : (
                      <button type="button" className="tool-btn tool-btn-ghost" onClick={checkGalleryDlUpdate} disabled={!rippo || galleryDlStatus !== "idle"}>
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
                    <button type="button" className="tool-btn tool-btn-ghost" onClick={checkQbittorrentUpdate} disabled={!rippo || qbittorrentStatus !== "idle"}>
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
                    <button type="button" className="tool-btn tool-btn-ghost" onClick={checkAria2cUpdate} disabled={!rippo || aria2cStatus !== "idle"}>
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
                    <button type="button" className="tool-btn tool-btn-ghost" onClick={checkFfmpegUpdate} disabled={!rippo || ffmpegStatus !== "idle"}>
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
