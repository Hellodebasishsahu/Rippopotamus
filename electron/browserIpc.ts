import { BrowserWindow, ipcMain, session } from "electron";
import { randomUUID } from "node:crypto";
import {
  addProbeCandidate,
  firstHeaderValue,
  isAllowedProbePageUrl,
  sortedProbeCandidates,
  validateProbeUrl,
  type PageProbeCandidate,
  type PendingProbeCandidate,
} from "./pageProbePolicy";
import { runEngine } from "./engineProcess";

type PageProbeResponse = {
  ok: true;
  url: string;
  finalUrl: string;
  candidates: PageProbeCandidate[];
  timedOut: boolean;
} | {
  ok: false;
  url: string;
  error: string;
  candidates: PageProbeCandidate[];
  timedOut?: boolean;
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

type ProbeBeforeRequestListener = (
  details: Electron.OnBeforeRequestListenerDetails,
  callback: (response: Electron.CallbackResponse) => void,
) => void;

type ProbeHeadersReceivedListener = (
  details: Electron.OnHeadersReceivedListenerDetails,
  callback: (response: Electron.HeadersReceivedResponse) => void,
) => void;

const PAGE_PROBE_TIMEOUT_MS = 18_000;
const SERP_SCOUT_TIMEOUT_MS = 18_000;
const PAGE_PROBE_MAX_TRACKED_REQUESTS = 1_000;
let activePageProbe: Promise<PageProbeResponse> | null = null;
let activeSourceSearch: Promise<unknown> | null = null;
let activeSourceSearchKey = "";

export function browserSerpEnabled(): boolean {
  const provider = (process.env.RIPPO_SEARCH_PROVIDER || "").trim().toLowerCase();
  if (provider === "electron_google") return true;
  if (provider && provider !== "electron_google") return false;
  return ["1", "true", "yes", "on"].includes((process.env.RIPPO_SERP_BROWSER || "").trim().toLowerCase());
}

async function probePage(inputUrl: unknown, timeoutMs = PAGE_PROBE_TIMEOUT_MS): Promise<PageProbeResponse> {
  let targetUrl = "";
  const candidates = new Map<string, PendingProbeCandidate>();
  let win: BrowserWindow | null = null;
  let timedOut = false;
  const partition = `rippo-page-probe:${randomUUID()}`;
  const probeSession = session.fromPartition(partition, { cache: false });
  const requestMethods = new Map<string, string>();
  const filter = { urls: ["http://*/*", "https://*/*"] };

  try {
    targetUrl = validateProbeUrl(inputUrl);

    const onBeforeRequest: ProbeBeforeRequestListener = (details, callback) => {
      if (!isAllowedProbePageUrl(details.url)) {
        callback({ cancel: true });
        return;
      }
      if (requestMethods.size < PAGE_PROBE_MAX_TRACKED_REQUESTS) {
        requestMethods.set(details.url, details.method || "GET");
      }
      addProbeCandidate(candidates, details.url, "network", details.method || "GET");
      callback({});
    };
    const onHeadersReceived: ProbeHeadersReceivedListener = (details, callback) => {
      const contentType = firstHeaderValue(details.responseHeaders, "content-type");
      addProbeCandidate(candidates, details.url, "network", requestMethods.get(details.url) || details.method || "GET", contentType);
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
        images: true,
        javascript: true,
      },
    });

    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, navigationUrl) => {
      if (!isAllowedProbePageUrl(navigationUrl)) event.preventDefault();
    });

    const waitForPage = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);

      const finish = () => {
        clearTimeout(timeout);
        resolve();
      };

      win?.webContents.once("did-finish-load", finish);
      win?.webContents.once("did-stop-loading", finish);
      win?.webContents.once("did-fail-load", (_event, _errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (isMainFrame) {
          clearTimeout(timeout);
          reject(new Error(errorDescription || `Failed to load ${validatedUrl || targetUrl}`));
        }
      });
    });

    const loadPage = win.loadURL(targetUrl).then(() => undefined);
    await Promise.race([loadPage, waitForPage]);
    if (timedOut && !win.isDestroyed()) win.webContents.stop();
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    if (!win.isDestroyed()) {
      try {
        const domCandidates = await win.webContents.executeJavaScript(`
          (() => {
            const out = [];
            const push = (url, label, contentType) => {
              if (typeof url === "string" && url.trim()) out.push({ url, label, contentType });
            };
            for (const element of document.querySelectorAll("video, audio, source, track, img, a, link")) {
              push(element.currentSrc || element.src || element.href, element.tagName.toLowerCase(), element.type || "");
              if (element.srcset) {
                for (const part of element.srcset.split(",")) push(part.trim().split(/\\s+/)[0], "srcset", "");
              }
            }
            return out;
          })()
        `, true) as DomProbeCandidate[];
        for (const candidate of domCandidates) {
          try {
            const absolute = new URL(candidate.url, win.webContents.getURL()).toString();
            addProbeCandidate(candidates, absolute, "dom", "GET", candidate.contentType || undefined, candidate.label);
          } catch {
            undefined;
          }
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
      timedOut,
    };
  } catch (error) {
    return {
      ok: false,
      url: targetUrl || String(inputUrl ?? ""),
      error: error instanceof Error ? error.message : String(error),
      candidates: sortedProbeCandidates(candidates),
      timedOut,
    };
  } finally {
    probeSession.webRequest.onBeforeRequest(filter, null);
    probeSession.webRequest.onHeadersReceived(filter, null);
    if (win && !win.isDestroyed()) win.destroy();
    await probeSession.clearStorageData().catch(() => undefined);
    requestMethods.clear();
  }
}

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

export function registerBrowserIpcHandlers() {
  ipcMain.handle("page:probe", async (_event, url: string) => {
    if (activePageProbe) {
      return {
        ok: false,
        url,
        error: "A page scan is already running.",
        candidates: [],
      };
    }
    activePageProbe = probePage(url);
    try {
      return await activePageProbe;
    } finally {
      activePageProbe = null;
    }
  });

  ipcMain.handle("engine:source-search", async (_event, query?: string, pack?: string) => {
    const safeQuery = (typeof query === "string" ? query : "").slice(0, 120);
    const safePack = typeof pack === "string" && pack.trim() ? pack : "all";
    const searchKey = `${safePack}\n${safeQuery}`;
    if (activeSourceSearch) {
      if (activeSourceSearchKey === searchKey) return await activeSourceSearch;
      return {
        ok: false,
        query: safeQuery,
        pack: safePack,
        packs: [{ id: "all", label: "All" }],
        results: [],
        error: "Search is catching up.",
      };
    }
    try {
      activeSourceSearchKey = searchKey;
      activeSourceSearch = (async () => {
        const evidence = browserSerpEnabled()
          ? await electronGoogleSearchEvidence(safeQuery, safePack, 6)
          : null;
        const envOverride: NodeJS.ProcessEnv = {};
        if (browserSerpEnabled()) {
          envOverride.RIPPO_SERP_BROWSER = "0";
          if ((process.env.RIPPO_SEARCH_PROVIDER || "").trim().toLowerCase() === "electron_google") {
            envOverride.RIPPO_SEARCH_PROVIDER = "";
          }
        }
        if (evidence?.enabled) envOverride.RIPPO_SEARCH_EVIDENCE_JSON = JSON.stringify(evidence);
        return await runEngine(["source-search", "--query", safeQuery, "--pack", safePack, "--limit", "24"], undefined, envOverride);
      })();
      return await activeSourceSearch;
    } catch (error) {
      return {
        ok: false,
        query: safeQuery,
        pack: safePack,
        packs: [{ id: "all", label: "All" }],
        results: [],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      activeSourceSearch = null;
      activeSourceSearchKey = "";
    }
  });
}
