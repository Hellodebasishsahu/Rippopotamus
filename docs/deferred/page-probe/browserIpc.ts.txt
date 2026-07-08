import { BrowserWindow, ipcMain, session } from "electron";
import { randomUUID } from "node:crypto";
import {
  addProbeCandidate,
  candidateKind,
  firstHeaderValue,
  hasStrongMedia,
  isAllowedProbePageUrl,
  isLikelyAdOrTrackingUrl,
  isRejectedUrl,
  probePageContentKey,
  sortedProbeCandidates,
  validateProbeUrl,
  type PageProbeCandidate,
  type PageProbeCandidateKind,
  type PendingProbeCandidate,
} from "./pageProbePolicy";
import { runEngine } from "./engineProcess";
import { fromElectronDetails } from "@ghostery/adblocker-electron";
import { getAdBlocker } from "./adBlocker";

type PageProbeResponse = {
  ok: true;
  url: string;
  finalUrl: string;
  candidates: PageProbeCandidate[];
  pageLinks?: ProbePageLink[];
  crawledLinks?: number;
  timedOut: boolean;
  fastSettled?: boolean;
  elapsedMs?: number;
  cached?: boolean;
  cachedAt?: number;
} | {
  ok: false;
  url: string;
  error: string;
  candidates: PageProbeCandidate[];
  pageLinks?: ProbePageLink[];
  crawledLinks?: number;
  timedOut?: boolean;
  fastSettled?: boolean;
  elapsedMs?: number;
  cached?: boolean;
  cachedAt?: number;
};

type PageProbeOptions = {
  incognito?: boolean;
};

type SearchEvidenceResult = {
  title: string;
  url: string;
  displayUrl?: string;
  snippet?: string;
  position?: number;
};

type SearchEvidencePayload = {
  enabled: boolean;
  source: string;
  provider: string;
  label: string;
  query: string;
  requestedPack: string;
  results: SearchEvidenceResult[];
  resultCount: number;
  reason: string;
  error?: string;
};

type DomProbeCandidate = {
  url: string;
  label?: string;
  contentType?: string;
};

type ProbePageLink = {
  url: string;
  text?: string;
};

type ProbeBeforeRequestListener = (
  details: Electron.OnBeforeRequestListenerDetails,
  callback: (response: Electron.CallbackResponse) => void,
) => void;

type ProbeHeadersReceivedListener = (
  details: Electron.OnHeadersReceivedListenerDetails,
  callback: (response: Electron.HeadersReceivedResponse) => void,
) => void;

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

const PAGE_PROBE_TIMEOUT_MS = 18_000;
const PAGE_PROBE_FAST_SETTLE_MS = 450;
const PAGE_PROBE_DEEPLINK_LIMIT = 40;
const PAGE_PROBE_DEEPLINK_CRAWL_LIMIT = 12;
const PAGE_PROBE_DEEPLINK_CONCURRENCY = 3;
const PAGE_PROBE_CACHE_VERSION = 3;
const PAGE_PROBE_CACHE_TTL_MS = 10 * 60_000;
const PAGE_PROBE_CACHE_MAX = 80;
const SERP_SCOUT_TIMEOUT_MS = 18_000;
const PAGE_PROBE_MAX_TRACKED_REQUESTS = 1_000;
// Embedded-player resolution: only the top-level page resolves embeds, and only
// a bounded set, since each one spawns the engine (yt-dlp/gallery-dl).
const PAGE_PROBE_EMBED_LIMIT = 6;
const PAGE_PROBE_EMBED_CONCURRENCY = 2;
const PAGE_PROBE_EMBED_TIMEOUT_MS = 12_000;
// How long to wait after provoking playback for lazy HLS/DASH manifests to fire.
const PAGE_PROBE_PROVOKE_WAIT_MS = 1_400;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let activePageProbe: Promise<PageProbeResponse> | null = null;
let activePageProbeKey = "";
const pageProbeCache = new Map<string, { storedAt: number; response: PageProbeResponse }>();

// ---------------------------------------------------------------------------
// DOM extraction script — injected into the probed page
// ---------------------------------------------------------------------------
// This is the single biggest leverage point for finding media. We extract:
//   1. Standard media elements: <video>, <audio>, <source>, <track>
//   2. Link elements: <a href>, <link>
//   3. Open Graph / Twitter Card meta tags (og:video, og:audio, twitter:player:stream)
//   4. JSON-LD structured data (VideoObject, AudioObject, MusicRecording)
//   5. <iframe> / <embed> / <object> src attributes
//   6. Data attributes on common player containers (data-src, data-video-url, etc.)
//   7. URLs embedded in <script> content (JSON strings, JS assignments)
// ---------------------------------------------------------------------------

const DOM_EXTRACT_SCRIPT = `(() => {
  const media = [];
  const links = [];
  const embeds = [];
  const push = (url, label, contentType) => {
    if (typeof url === "string" && url.trim()) media.push({ url: url.trim(), label, contentType });
  };

  // 1. Standard media elements
  for (const el of document.querySelectorAll("video, audio, source, track")) {
    push(el.currentSrc || el.src, el.tagName.toLowerCase(), el.type || "");
    if (el.srcset) {
      for (const part of el.srcset.split(",")) push(part.trim().split(/\\s+/)[0], "srcset", "");
    }
  }

  // 2. Links and images
  for (const el of document.querySelectorAll("a[href], link[href]")) {
    const href = el.href || el.getAttribute("href") || "";
    push(href, el.tagName.toLowerCase(), el.type || "");
    if (el.tagName === "A") {
      const text = (el.innerText || el.getAttribute("aria-label") || el.title || "").trim();
      if (href) links.push({ url: href, text });
    }
  }
  for (const el of document.querySelectorAll("img[src]")) {
    push(el.currentSrc || el.src, "img", "");
    if (el.srcset) {
      for (const part of el.srcset.split(",")) push(part.trim().split(/\\s+/)[0], "srcset", "");
    }
  }

  // 3. Open Graph / Twitter Card meta tags
  const metaSelectors = [
    'meta[property="og:video"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video:secure_url"]',
    'meta[property="og:audio"]',
    'meta[property="og:audio:url"]',
    'meta[property="og:audio:secure_url"]',
    'meta[name="twitter:player:stream"]',
    'meta[name="twitter:player"]',
    'meta[property="og:image"]',
    'link[rel="video_src"]',
    'link[rel="audio_src"]',
  ];
  for (const sel of metaSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      push(el.content || el.href, "meta:" + sel.split('"')[1], "");
    }
  }

  // 4. JSON-LD structured data
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (obj) => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) { obj.forEach(walk); return; }
        const type = (obj["@type"] || "").toLowerCase();
        if (type === "videoobject" || type === "audioobject" || type === "musicrecording" || type === "mediaobject") {
          for (const key of ["contentUrl", "embedUrl", "url", "encodingUrl"]) {
            if (typeof obj[key] === "string") push(obj[key], "jsonld:" + type, "");
          }
          if (Array.isArray(obj.encoding)) {
            for (const enc of obj.encoding) {
              if (typeof enc?.contentUrl === "string") push(enc.contentUrl, "jsonld:encoding", enc.encodingFormat || "");
            }
          }
        }
        for (const v of Object.values(obj)) walk(v);
      };
      walk(JSON.parse(script.textContent || ""));
    } catch {}
  }

  // 5. Iframes, embeds, objects
  for (const el of document.querySelectorAll("iframe[src], embed[src], object[data]")) {
    const src = el.src || el.getAttribute("src") || el.getAttribute("data") || "";
    push(src, el.tagName.toLowerCase(), el.type || "");
    links.push({ url: src, text: "" });
    if (typeof src === "string" && src.trim()) embeds.push(src.trim());
  }

  // 6. Data attributes on player containers
  const dataAttrs = ["data-src", "data-video-url", "data-video-src", "data-stream-url", "data-hls", "data-dash", "data-file", "data-mp4", "data-source"];
  for (const attr of dataAttrs) {
    for (const el of document.querySelectorAll("[" + attr + "]")) {
      push(el.getAttribute(attr), "data:" + attr, "");
    }
  }

  // 7. Script-embedded URLs
  const cleanUrl = (url) => String(url || "")
    .replace(/\\\\\\/\\//g, "/")
    .replace(/\\\\u0026/g, "&")
    .replace(/&amp;/g, "&");

  for (const script of document.querySelectorAll("script:not([type='application/ld+json'])")) {
    const text = script.textContent || "";
    if (text.length > 500000) continue;
    for (const match of text.matchAll(/https?:\\\\?\\/\\\\?\\/[^"'<>\\s\\\\]{10,}/g)) {
      const url = cleanUrl(match[0]);
      if (/\\.(?:m3u8|mpd|mp4|m4v|webm|mov|mkv|mp3|m4a|aac|ogg|opus|flac|torrent)(?:[?#&]|$)/i.test(url)) {
        push(url, "script", "");
      }
    }
    for (const match of text.matchAll(/"(?:url|src|file|source|stream|video_url|audio_url|hls_url|dash_url|manifest_url|playback_url|content_url)"\\s*:\\s*"(https?:[^"]+)"/gi)) {
      push(cleanUrl(match[1]), "script:json", "");
    }
    links.push(...Array.from(text.matchAll(/https?:\\\\?\\/\\\\?\\/[^"'<>\\s\\\\]+/g)).map((m) => ({ url: cleanUrl(m[0]) })));
  }

  return { media, links, embeds };
})()`;

// ---------------------------------------------------------------------------
// Playback provocation — injected to surface lazy-loaded streams
// ---------------------------------------------------------------------------
// Many sites only request the master .m3u8/.mpd after a play gesture. We mute
// and call play() on every media element, and click likely play controls
// (skipping anchors so we don't navigate away from the page).
// ---------------------------------------------------------------------------

const PLAY_PROVOKE_SCRIPT = `(() => {
  try {
    for (const m of document.querySelectorAll("video, audio")) {
      try { m.muted = true; const p = m.play(); if (p && p.catch) p.catch(() => {}); } catch {}
    }
    const selector = '[class*="play" i], [aria-label*="play" i], [title*="play" i], button.ytp-large-play-button, .vjs-big-play-button';
    let clicks = 0;
    for (const el of document.querySelectorAll(selector)) {
      if (clicks >= 8) break;
      if (el.tagName === "A" && el.getAttribute("href")) continue;
      try { el.click(); clicks += 1; } catch {}
    }
  } catch {}
  return true;
})()`;

// ---------------------------------------------------------------------------
// Probe engine
// ---------------------------------------------------------------------------

export function browserSerpEnabled(): boolean {
  const provider = (process.env.RIPPO_SEARCH_PROVIDER || "").trim().toLowerCase();
  if (provider === "electron_google") return true;
  if (provider && provider !== "electron_google") return false;
  return ["1", "true", "yes", "on"].includes((process.env.RIPPO_SERP_BROWSER || "").trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Embedded-player resolution via the engine (yt-dlp / gallery-dl)
// ---------------------------------------------------------------------------

type EngineFetchResult = {
  ok?: boolean;
  metadata?: {
    title?: string;
    extractor?: string;
    webpage_url?: string;
    duration?: number;
    // Set when the engine only scraped OpenGraph/title tags rather than
    // confirming a downloadable extraction — not a real media embed.
    provisional?: boolean;
  };
};

function runEngineWithTimeout(args: string[], timeoutMs: number): Promise<unknown> {
  let cancel: (() => void) | null = null;
  const run = runEngine(args, undefined, {}, (fn) => {
    cancel = fn;
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      cancel?.();
      reject(new Error("Embed resolution timed out."));
    }, timeoutMs).unref();
  });
  return Promise.race([run, timeout]);
}

// For each discovered <iframe>/<embed>, ask the engine whether yt-dlp/gallery-dl
// can extract it. A success means it's a real, directly-downloadable embed —
// add it as a strong candidate (the headline "embedded player → its media").
async function resolveEmbedCandidates(
  embeds: string[],
  pageUrl: string,
  candidates: Map<string, PendingProbeCandidate>,
): Promise<void> {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const raw of embeds) {
    let absolute: string;
    try {
      absolute = new URL(raw, pageUrl).toString();
    } catch {
      continue;
    }
    if (!isAllowedProbePageUrl(absolute)) continue;
    if (isLikelyAdOrTrackingUrl(absolute)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    targets.push(absolute);
    if (targets.length >= PAGE_PROBE_EMBED_LIMIT) break;
  }

  await runWithConcurrency(targets, PAGE_PROBE_EMBED_CONCURRENCY, async (embedUrl) => {
    try {
      // --full skips the OpenGraph preview shortcut and forces a real
      // yt-dlp/gallery-dl extraction, which is what confirms a downloadable
      // embed (e.g. a youtube.com/embed iframe → the actual watch URL).
      const payload = (await runEngineWithTimeout(
        ["fetch", "--url", embedUrl, "--provider", "auto", "--full"],
        PAGE_PROBE_EMBED_TIMEOUT_MS,
      )) as EngineFetchResult;
      if (!payload?.ok || !payload.metadata) return;
      const meta = payload.metadata;
      // Provisional = OG/title scrape only; not a confirmed downloadable embed.
      if (meta.provisional) return;
      const target = meta.webpage_url || embedUrl;
      const label = meta.title
        ? `${meta.extractor || "Embed"}: ${meta.title}`.slice(0, 140)
        : meta.extractor || "Embedded media";
      const kind: PageProbeCandidateKind = "video";
      addProbeCandidate(candidates, target, "embed", "GET", undefined, label, kind);
    } catch {
      // Unsupported URL, private, or timed out — not a resolvable embed.
      undefined;
    }
  });
}

async function probePage(inputUrl: unknown, timeoutMs = PAGE_PROBE_TIMEOUT_MS, options: { fastSettle?: boolean; provoke?: boolean; loadImages?: boolean; resolveEmbeds?: boolean } = {}): Promise<PageProbeResponse> {
  const startedAt = Date.now();
  let targetUrl = "";
  const candidates = new Map<string, PendingProbeCandidate>();
  const links: ProbePageLink[] = [];
  let win: BrowserWindow | null = null;
  let timedOut = false;
  let fastSettled = false;
  let finishWait: (() => void) | null = null;
  let fastSettleTimer: NodeJS.Timeout | null = null;
  const partition = `rippo-page-probe:${randomUUID()}`;
  const probeSession = session.fromPartition(partition, { cache: false });
  const requestMethods = new Map<string, string>();
  const filter = { urls: ["http://*/*", "https://*/*"] };

  try {
    targetUrl = validateProbeUrl(inputUrl);

    const checkFastSettle = () => {
      if (options.fastSettle === false || !finishWait) return;
      if (!hasStrongMedia(sortedProbeCandidates(candidates))) return;
      if (fastSettleTimer) clearTimeout(fastSettleTimer);
      fastSettleTimer = setTimeout(() => {
        fastSettled = true;
        finishWait?.();
      }, PAGE_PROBE_FAST_SETTLE_MS);
    };

    const blocker = getAdBlocker();
    const onBeforeRequest: ProbeBeforeRequestListener = (details, callback) => {
      if (!isAllowedProbePageUrl(details.url)) {
        callback({ cancel: true });
        return;
      }
      if (blocker) {
        const { match } = blocker.match(fromElectronDetails(details));
        if (match) {
          callback({ cancel: true });
          return;
        }
      }
      if (isRejectedUrl(details.url)) {
        callback({});
        return;
      }
      if (requestMethods.size < PAGE_PROBE_MAX_TRACKED_REQUESTS) {
        requestMethods.set(details.url, details.method || "GET");
      }
      addProbeCandidate(candidates, details.url, "network", details.method || "GET");
      checkFastSettle();
      callback({});
    };
    const onHeadersReceived: ProbeHeadersReceivedListener = (details, callback) => {
      const contentType = firstHeaderValue(details.responseHeaders, "content-type");
      if (!isRejectedUrl(details.url, contentType)) {
        addProbeCandidate(candidates, details.url, "network", requestMethods.get(details.url) || details.method || "GET", contentType);
        checkFastSettle();
      }
      requestMethods.delete(details.url);
      callback({ responseHeaders: details.responseHeaders });
    };

    probeSession.webRequest.onBeforeRequest(filter, onBeforeRequest);
    probeSession.webRequest.onHeadersReceived(filter, onHeadersReceived);
    probeSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    probeSession.setPermissionCheckHandler(() => false);

    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Top-level scans load images so preview/thumbnail media is captured;
        // deeplink children stay image-free for speed.
        images: options.loadImages === true,
        javascript: true,
      },
    });

    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, navigationUrl) => {
      if (!isAllowedProbePageUrl(navigationUrl)) event.preventDefault();
    });

    const waitForPage = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        finish();
      }, timeoutMs);

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (fastSettleTimer) clearTimeout(fastSettleTimer);
        resolve();
      };
      finishWait = finish;

      win?.webContents.once("did-finish-load", finish);
      win?.webContents.once("did-stop-loading", finish);
      win?.webContents.once("did-fail-load", (_event, _errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (isMainFrame) {
          clearTimeout(timeout);
          if (fastSettleTimer) clearTimeout(fastSettleTimer);
          reject(new Error(errorDescription || `Failed to load ${validatedUrl || targetUrl}`));
        }
      });
    });

    const loadPage = win.loadURL(targetUrl).then(() => undefined);
    await Promise.race([loadPage, waitForPage]);
    if (timedOut && !win.isDestroyed()) win.webContents.stop();
    if (!fastSettled) await new Promise((resolve) => setTimeout(resolve, 650));

    // Provoke playback so lazy-loaded HLS/DASH manifests are requested (and
    // captured by the network listeners above) before we read the DOM.
    if (options.provoke && !timedOut && win && !win.isDestroyed()) {
      try {
        await win.webContents.executeJavaScript(PLAY_PROVOKE_SCRIPT, true);
        await new Promise((resolve) => setTimeout(resolve, PAGE_PROBE_PROVOKE_WAIT_MS));
      } catch {
        undefined;
      }
    }

    if (!win.isDestroyed()) {
      try {
        const domResult = await win.webContents.executeJavaScript(DOM_EXTRACT_SCRIPT, true) as {
          media?: DomProbeCandidate[];
          links?: ProbePageLink[];
          embeds?: string[];
        };
        const pageUrl = win.webContents.getURL();
        for (const candidate of domResult.media || []) {
          try {
            const absolute = new URL(candidate.url, pageUrl).toString();
            const source = candidate.label?.startsWith("meta:") || candidate.label?.startsWith("jsonld:") ? "meta" as const : "dom" as const;
            addProbeCandidate(candidates, absolute, source, "GET", candidate.contentType || undefined, candidate.label);
          } catch {
            undefined;
          }
        }
        for (const link of domResult.links || []) {
          try {
            const absolute = new URL(link.url, pageUrl).toString();
            links.push({ url: absolute, text: link.text });
          } catch {
            undefined;
          }
        }
        if (options.resolveEmbeds) {
          // Resolve the page itself plus any iframes. Resolving the page URL is
          // what makes direct-provider pages (xHamster, YouTube watch pages, and
          // ~1800 other sites) work reliably without depending on network
          // sniffing — the video is often the page's own player, not an iframe.
          await resolveEmbedCandidates([pageUrl, ...(domResult.embeds || [])], pageUrl, candidates);
        }
      } catch {
        undefined;
      }
    }

    return {
      ok: true,
      url: targetUrl,
      finalUrl: win?.webContents.getURL() || targetUrl,
      candidates: sortedProbeCandidates(candidates),
      pageLinks: collectProbePageLinks(targetUrl, links),
      timedOut,
      fastSettled,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      url: targetUrl || String(inputUrl ?? ""),
      error: error instanceof Error ? error.message : String(error),
      candidates: sortedProbeCandidates(candidates),
      pageLinks: targetUrl ? collectProbePageLinks(targetUrl, links) : [],
      timedOut,
      fastSettled,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    finishWait = null;
    if (fastSettleTimer) clearTimeout(fastSettleTimer);
    probeSession.webRequest.onBeforeRequest(filter, null);
    probeSession.webRequest.onHeadersReceived(filter, null);
    if (win && !win.isDestroyed()) win.destroy();
    await probeSession.clearStorageData().catch(() => undefined);
    requestMethods.clear();
  }
}

// ---------------------------------------------------------------------------
// Page link collection (for deeplink crawling)
// ---------------------------------------------------------------------------

function collectProbePageLinks(sourceUrl: string, links: ProbePageLink[]): ProbePageLink[] {
  let source: URL;
  try {
    source = new URL(sourceUrl);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const seenContentKeys = new Set<string>();
  const sourceContentKey = probePageContentKey(source);
  if (sourceContentKey) seenContentKeys.add(sourceContentKey);
  const scored: Array<{ score: number; order: number; link: ProbePageLink }> = [];
  links.forEach((raw, order) => {
    let parsed: URL;
    try {
      parsed = new URL(raw.url, source);
    } catch {
      return;
    }
    parsed.hash = "";
    if (!isAllowedProbePageUrl(parsed)) return;
    if (parsed.hostname !== source.hostname && !parsed.hostname.endsWith(`.${source.hostname}`)) return;
    if (candidateKind(parsed.toString(), "")) return;
    const url = parsed.toString();
    if (url === source.toString() || seen.has(url)) return;
    const contentKey = probePageContentKey(parsed);
    if (contentKey && seenContentKeys.has(contentKey)) return;
    if (contentKey) seenContentKeys.add(contentKey);
    seen.add(url);
    const path = parsed.pathname.toLowerCase();
    const text = (raw.text || "").trim().toLowerCase();
    let score = 0;
    if (/\/(?:video|videos|watch|post|posts|media|item|view|reel|reels|clip|clips|gallery|galleries|photo|photos|album|albums|short|shorts)(?:\/|$)/.test(path)) score += 40;
    if (/\d/.test(path)) score += 10;
    if (text && text.length < 140) score += 8;
    if (/next|more|view|watch|video|post|photo|gallery|album|clip|reel/.test(text)) score += 12;
    if (/login|signup|register|terms|privacy|contact|support|advertis|tag|category|search|sort|filter|share/.test(path + " " + text)) score -= 30;
    if (score <= 0) return;
    scored.push({ score, order, link: { url, text: raw.text } });
  });
  return scored
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, PAGE_PROBE_DEEPLINK_LIMIT)
    .map((entry) => entry.link);
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runWithConcurrency<T, R>(values: T[], limit: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) {
      const current = values[index];
      index += 1;
      results.push(await worker(current));
    }
  }));
  return results;
}

// ---------------------------------------------------------------------------
// Deeplink crawling
// ---------------------------------------------------------------------------

function mergePageProbeResponses(source: PageProbeResponse, children: PageProbeResponse[]): PageProbeResponse {
  if (!source.ok) return source;
  const candidates = new Map<string, PendingProbeCandidate>();
  for (const candidate of source.candidates) {
    addProbeCandidate(candidates, candidate.url, candidate.source, candidate.method, candidate.contentType, candidate.label);
  }
  for (const child of children) {
    for (const candidate of child.candidates) {
      addProbeCandidate(candidates, candidate.url, candidate.source, candidate.method, candidate.contentType, candidate.label);
    }
  }
  return {
    ...source,
    candidates: sortedProbeCandidates(candidates),
    crawledLinks: children.length,
    pageLinks: source.pageLinks,
  };
}

async function probePageWithDeeplinks(url: string): Promise<PageProbeResponse> {
  const startedAt = Date.now();
  const source = await probePage(url, PAGE_PROBE_TIMEOUT_MS, { fastSettle: false, provoke: true, loadImages: true, resolveEmbeds: true });
  if (!source.ok || !source.pageLinks?.length) return source;
  if (hasStrongMedia(source.candidates) && source.candidates.filter((c) => c.score >= 40).length >= 3) return source;
  const linksToCrawl = source.pageLinks.slice(0, PAGE_PROBE_DEEPLINK_CRAWL_LIMIT);
  const children = await runWithConcurrency(linksToCrawl, PAGE_PROBE_DEEPLINK_CONCURRENCY, async (link) => probePage(link.url, 7_000, { fastSettle: true }));
  const merged = mergePageProbeResponses(source, children);
  return { ...merged, elapsedMs: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function clonePageProbeResponse(response: PageProbeResponse, cached = false, cachedAt?: number): PageProbeResponse {
  return {
    ...response,
    candidates: response.candidates.map((candidate) => ({ ...candidate })),
    cached,
    ...(cachedAt ? { cachedAt } : {}),
  } as PageProbeResponse;
}

function readPageProbeCache(cacheKey: string): PageProbeResponse | null {
  const entry = pageProbeCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > PAGE_PROBE_CACHE_TTL_MS) {
    pageProbeCache.delete(cacheKey);
    return null;
  }
  pageProbeCache.delete(cacheKey);
  pageProbeCache.set(cacheKey, entry);
  return clonePageProbeResponse(entry.response, true, entry.storedAt);
}

function writePageProbeCache(cacheKey: string, response: PageProbeResponse): void {
  if (!response.ok || response.timedOut || response.candidates.length === 0) return;
  pageProbeCache.set(cacheKey, {
    storedAt: Date.now(),
    response: clonePageProbeResponse(response, false),
  });
  while (pageProbeCache.size > PAGE_PROBE_CACHE_MAX) {
    const oldest = pageProbeCache.keys().next().value;
    if (!oldest) break;
    pageProbeCache.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Google SERP scout (unchanged)
// ---------------------------------------------------------------------------

async function electronGoogleSearchEvidence(query: string, requestedPack: string, limit = 5, timeoutMs = SERP_SCOUT_TIMEOUT_MS): Promise<SearchEvidencePayload> {
  const safeQuery = query.trim().slice(0, 160);
  const safePack = requestedPack.trim() || "all";
  let win: BrowserWindow | null = null;
  let timedOut = false;
  const partition = `rippo-serp-scout:${randomUUID()}`;
  const serpSession = session.fromPartition(partition, { cache: false });

  const empty = (reason: string, error?: string): SearchEvidencePayload => ({
    enabled: false,
    source: "electron_google",
    provider: "electron_google",
    label: "Electron Google",
    query: safeQuery,
    requestedPack: safePack,
    results: [],
    resultCount: 0,
    reason,
    ...(error ? { error } : {}),
  });

  if (!safeQuery) return empty("Search evidence needs a query.");

  try {
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("q", safeQuery);
    url.searchParams.set("num", String(Math.max(1, Math.min(limit + 4, 10))));
    url.searchParams.set("hl", process.env.RIPPO_SEARCH_LANG || "en");
    url.searchParams.set("safe", process.env.RIPPO_GOOGLE_SAFE || "active");
    url.searchParams.set("pws", "0");

    serpSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    serpSession.setPermissionCheckHandler(() => false);
    const serpBlocker = getAdBlocker();
    if (serpBlocker) serpBlocker.enableBlockingInSession(serpSession);

    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        images: false,
      },
    });

    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new Error("Google SERP scout timed out."));
      }, timeoutMs);
    });

    try {
      await Promise.race([win.loadURL(url.toString()), timeout]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
    if (timedOut) throw new Error("Google SERP scout timed out.");
    await new Promise((resolve) => setTimeout(resolve, 700));

    const results = await win.webContents.executeJavaScript(`
      (() => {
        const limit = ${Math.max(1, Math.min(limit, 10))};
        const blockedMarkers = [
          "our systems have detected unusual traffic",
          "before you continue to google",
          "recaptcha",
          "sorry/index"
        ];
        const pageText = (document.body?.innerText || "").toLowerCase();
        if (blockedMarkers.some((marker) => pageText.includes(marker))) {
          return { blocked: true, results: [] };
        }
        const cleanText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
        const displayUrl = (value) => {
          try {
            const parsed = new URL(value);
            return parsed.hostname.replace(/^www\\./, "");
          } catch {
            return "";
          }
        };
        const isGoogleNoiseUrl = (value) => {
          try {
            const parsed = new URL(value);
            const host = parsed.hostname.toLowerCase();
            const path = parsed.pathname.toLowerCase();
            if (!parsed.protocol.startsWith("http")) return true;
            const blockedHosts = [
              "google.com",
              "www.google.com",
              "accounts.google.com",
              "support.google.com",
              "policies.google.com",
              "webcache.googleusercontent.com",
              "googleadservices.com",
              "doubleclick.net"
            ];
            if (blockedHosts.includes(host) || blockedHosts.some((blocked) => host.endsWith("." + blocked))) return true;
            return ["/aclk", "/shopping", "/preferences", "/setprefs"].some((part) => path.includes(part));
          } catch {
            return true;
          }
        };
        const targetFromHref = (href) => {
          if (!href) return "";
          let parsed;
          try {
            parsed = new URL(href, location.href);
          } catch {
            return "";
          }
          if (parsed.hostname.endsWith("google.com") && parsed.pathname === "/url") {
            return parsed.searchParams.get("q") || "";
          }
          if (parsed.pathname.startsWith("/search") || parsed.pathname.startsWith("/preferences") || parsed.pathname.startsWith("/support")) return "";
          return parsed.href;
        };
        const isInsideNoise = (element) => {
          let current = element;
          while (current && current !== document.body) {
            const attrs = [
              current.id,
              current.className,
              current.getAttribute?.("aria-label"),
              current.getAttribute?.("role"),
              current.getAttribute?.("data-text-ad"),
              Array.from(current.getAttributeNames?.() || []).join(" ")
            ].join(" ").toLowerCase();
            if (["sponsored", "ads-ad", "commercial-unit", "pla-unit", "shopping", "kp-blk", "knowledge-panel", "related-question", "people also ask", "data-text-ad"].some((marker) => attrs.includes(marker))) return true;
            current = current.parentElement;
          }
          return false;
        };
        const seen = new Set();
        const results = [];
        for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
          if (results.length >= limit) break;
          if (isInsideNoise(anchor)) continue;
          const url = targetFromHref(anchor.getAttribute("href"));
          if (!url || isGoogleNoiseUrl(url) || seen.has(url)) continue;
          const title = cleanText(anchor.querySelector("h3")?.innerText || anchor.innerText);
          if (!title || ["cached", "similar", "translate this page", "sponsored", "ad"].includes(title.toLowerCase())) continue;
          const block = anchor.closest(".g, [data-sokoban-container], div");
          const blockText = cleanText(block?.innerText || "");
          const snippet = cleanText(blockText.replace(title, "")).slice(0, 500);
          seen.add(url);
          results.push({
            title: title.slice(0, 180),
            url: url.slice(0, 500),
            displayUrl: displayUrl(url).slice(0, 180),
            snippet,
            position: results.length + 1
          });
        }
        return { blocked: false, results };
      })()
    `, true) as { blocked?: boolean; results?: SearchEvidenceResult[] };

    if (results.blocked) throw new Error("Google returned a consent, CAPTCHA, or unusual-traffic page.");
    const organic = Array.isArray(results.results) ? results.results : [];
    return {
      enabled: true,
      source: "electron_google",
      provider: "electron_google",
      label: "Electron Google",
      query: safeQuery,
      requestedPack: safePack,
      results: organic,
      resultCount: organic.length,
      reason: "Read Google search-result context through Electron Chromium before routing.",
    };
  } catch (error) {
    return empty("Electron Google evidence failed; falling back to engine providers.", error instanceof Error ? error.message : String(error));
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await serpSession.clearCache().catch(() => undefined);
    await serpSession.clearStorageData().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export function registerBrowserIpcHandlers() {
  ipcMain.handle("page:clear-probe-cache", async () => {
    pageProbeCache.clear();
    return { ok: true };
  });

  ipcMain.handle("page:probe", async (_event, url: string, options?: PageProbeOptions) => {
    const incognito = options?.incognito === true;
    let cacheKey = "";
    try {
      cacheKey = validateProbeUrl(url);
    } catch {
      return await probePage(url);
    }
    const normalizedUrl = cacheKey;
    cacheKey = `${PAGE_PROBE_CACHE_VERSION}:${normalizedUrl}`;
    const cached = incognito ? null : readPageProbeCache(cacheKey);
    if (cached) return cached;
    if (activePageProbe) {
      if (!incognito && activePageProbeKey === cacheKey) return await activePageProbe;
      return {
        ok: false,
        url,
        error: "A page scan is already running.",
        candidates: [],
      };
    }
    activePageProbeKey = cacheKey;
    activePageProbe = probePageWithDeeplinks(normalizedUrl);
    try {
      const response = await activePageProbe;
      if (!incognito) writePageProbeCache(cacheKey, response);
      return response;
    } finally {
      activePageProbe = null;
      activePageProbeKey = "";
    }
  });
}
