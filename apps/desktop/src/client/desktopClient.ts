import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  CookieSource,
  CookiesBrowserResponse,
  DownloadCancelResponse,
  DownloadEvent,
  DownloadRequest,
  DownloadResponse,
  EngineHealth,
  AppUpdateInfo,
  FetchResponse,
  HelperCheckResult,
  HelperUpdateResult,
  LibraryListRequest,
  LibraryListResponse,
  LibraryThumbnailResult,
  PageProbeResponse,
  ProviderId,
  ThumbnailLoadResult,
} from "../../electron/types";

type RippoBridge = Window["rippo"];

export type DesktopClient = {
  health: () => Promise<EngineHealth>;
  probePage: RippoBridge["probePage"];
  clearSniffCache: RippoBridge["clearSniffCache"];
  setTransferSettings: RippoBridge["setTransferSettings"];
  fetch: RippoBridge["fetch"];
  fetchFull: RippoBridge["fetchFull"];
  download: (payload: DownloadRequest) => Promise<DownloadResponse>;
  cancelDownload: (jobId: string) => Promise<DownloadCancelResponse>;
  openFolder: (folder: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  loadThumbnail: (urls: string[]) => Promise<ThumbnailLoadResult>;
  listBrowsers: RippoBridge["listBrowsers"];
  setDefaultCookieSource: (source: CookieSource) => ReturnType<RippoBridge["setDefaultCookieSource"]>;
  setCookiesBrowser: RippoBridge["setCookiesBrowser"];
  checkHelpers: () => Promise<HelperCheckResult[]>;
  updateHelpers: () => Promise<HelperUpdateResult[]>;
  checkAppUpdate: () => Promise<AppUpdateInfo>;
  chooseOutputRoot: RippoBridge["chooseOutputRoot"];
  resetOutputRoot: RippoBridge["resetOutputRoot"];
  listLibrary: (payload?: LibraryListRequest) => Promise<LibraryListResponse>;
  loadLibraryThumbnail: (target: string) => Promise<LibraryThumbnailResult>;
  openPath: (target: string) => Promise<void>;
  showItemInFolder: (target: string) => Promise<void>;
  onDownloadEvent: (callback: (event: DownloadEvent) => void) => () => void;
};

export function createDesktopClient(bridge?: RippoBridge): DesktopClient | null {
  if (!bridge) return null;
  return {
    health: bridge.health,
    probePage: bridge.probePage,
    clearSniffCache: bridge.clearSniffCache,
    setTransferSettings: bridge.setTransferSettings,
    fetch: bridge.fetch,
    fetchFull: bridge.fetchFull,
    download: bridge.download,
    cancelDownload: bridge.cancelDownload,
    openFolder: bridge.openFolder,
    openExternal: bridge.openExternal,
    loadThumbnail: bridge.loadThumbnail,
    listBrowsers: bridge.listBrowsers,
    setDefaultCookieSource: bridge.setDefaultCookieSource,
    setCookiesBrowser: bridge.setCookiesBrowser,
    checkHelpers: bridge.checkHelpers,
    updateHelpers: bridge.updateHelpers,
    checkAppUpdate: bridge.checkAppUpdate,
    chooseOutputRoot: bridge.chooseOutputRoot,
    resetOutputRoot: bridge.resetOutputRoot,
    listLibrary: bridge.listLibrary,
    loadLibraryThumbnail: bridge.loadLibraryThumbnail,
    openPath: bridge.openPath,
    showItemInFolder: bridge.showItemInFolder,
    onDownloadEvent: bridge.onDownloadEvent,
  };
}

// --- Tauri transport -------------------------------------------------------
//
// P1 of the Electron -> Tauri migration (docs/tauri-migration-lld.md). Wires
// the core loop only: health, fetch(-full), download + progress events,
// cancel_download, listLibrary. Everything else (page probe / sniff, cookies,
// helper registry, app-update, output-root picker, thumbnails, shell/open)
// is P2+ and stubbed here so the UI doesn't crash — it lands with settings +
// path-guard + helper-registry parity. `@tauri-apps/api` is safe to import
// unconditionally: it only touches `window.__TAURI_INTERNALS__` when a call
// is actually made, so this module loads fine under plain Electron too.

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function notImplemented<T>(label: string, fallback: T): () => Promise<T> {
  return async () => {
    console.warn(`[tauri] ${label} is not implemented yet (P2).`);
    return fallback;
  };
}

const tauriDesktopClient: DesktopClient = {
  health: () => invoke<EngineHealth>("health"),
  fetch: (url: string, provider?: ProviderId | "auto", _cookieSource?: CookieSource) =>
    invoke<FetchResponse>("fetch", { url, provider: provider === "auto" ? undefined : provider }),
  fetchFull: (url: string, provider?: ProviderId | "auto", _cookieSource?: CookieSource) =>
    invoke<FetchResponse>("fetch_full", { url, provider: provider === "auto" ? undefined : provider }),
  download: (payload: DownloadRequest) => invoke<DownloadResponse>("download", { payload }),
  cancelDownload: (jobId: string) => invoke<DownloadCancelResponse>("cancel_download", { jobId }),
  listLibrary: (payload?: LibraryListRequest) =>
    invoke<LibraryListResponse>("library_list", { outputRoot: payload?.outputRoot }),
  onDownloadEvent: (callback: (event: DownloadEvent) => void) => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    listen<DownloadEvent>("engine:download-event", (event) => callback(event.payload)).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  // P2 — settings, path guard, cookies, helper registry, app update, thumbnails.
  probePage: notImplemented<PageProbeResponse>("probePage", {
    ok: false,
    url: "",
    error: "Page sniffing is not yet available on the Tauri build.",
    candidates: [],
  }),
  clearSniffCache: notImplemented("clearSniffCache", { ok: true }),
  setTransferSettings: notImplemented("setTransferSettings", {
    transfer: { aria2MaxConnections: 8, aria2DownloadLimit: "" },
    health: { ok: false, outputRoot: "", packaged: false } as EngineHealth,
  }),
  openFolder: notImplemented("openFolder", undefined),
  openExternal: notImplemented("openExternal", undefined),
  loadThumbnail: notImplemented("loadThumbnail", { src: null, url: null }),
  listBrowsers: notImplemented<CookiesBrowserResponse>("listBrowsers", {
    browsers: [],
    selected: null,
    source: { mode: "off" },
    supported: false,
  }),
  setDefaultCookieSource: notImplemented<CookiesBrowserResponse>("setDefaultCookieSource", {
    browsers: [],
    selected: null,
    source: { mode: "off" },
    supported: false,
  }),
  setCookiesBrowser: notImplemented<CookiesBrowserResponse>("setCookiesBrowser", {
    browsers: [],
    selected: null,
    source: { mode: "off" },
    supported: false,
  }),
  checkHelpers: notImplemented("checkHelpers", []),
  updateHelpers: notImplemented("updateHelpers", []),
  checkAppUpdate: notImplemented("checkAppUpdate", {
    currentVersion: "0.0.0",
    latestVersion: null,
    updateAvailable: false,
    configured: false,
    manifestUrl: null,
    dmgUrl: null,
    notes: [],
  }),
  chooseOutputRoot: notImplemented("chooseOutputRoot", { outputRoot: "", canceled: true }),
  resetOutputRoot: notImplemented("resetOutputRoot", { outputRoot: "" }),
  loadLibraryThumbnail: notImplemented("loadLibraryThumbnail", { ok: false, error: "Not implemented yet." }),
  openPath: notImplemented("openPath", undefined),
  showItemInFolder: notImplemented("showItemInFolder", undefined),
};

export function getDesktopClient(): DesktopClient | null {
  if (typeof window === "undefined") return null;
  if (window.rippo) return createDesktopClient(window.rippo);
  if (isTauriRuntime()) return tauriDesktopClient;
  return null;
}
