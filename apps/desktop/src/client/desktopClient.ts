import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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
} from "../types/desktop";

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
  // Real in-place update via tauri-plugin-updater (P3). Electron has no
  // equivalent — the frontend falls back to `openExternal(dmgUrl)` when this
  // is undefined.
  installAppUpdate?: (onProgress?: (downloaded: number, total: number | null) => void) => Promise<void>;
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
// P1+P2 of the Electron -> Tauri migration (docs/tauri-migration-lld.md).
// P1 wired the core loop: health, fetch(-full), download + progress events,
// cancel_download, listLibrary. P2 adds settings, the path-guard-backed shell
// commands, cookie-browser listing, the helper registry, the app-update
// check, and the output-root picker. Page probe / sniff and native
// thumbnails stay stubbed — they weren't in the P2 scope. `@tauri-apps/api`
// is safe to import unconditionally: it only touches
// `window.__TAURI_INTERNALS__` when a call is actually made, so this module
// loads fine under plain Electron too.

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

  setTransferSettings: (payload) =>
    invoke("set_transfer_settings", {
      aria2MaxConnections: payload?.aria2MaxConnections,
      aria2DownloadLimit: payload?.aria2DownloadLimit,
    }),
  openFolder: (folder: string) => invoke("open_folder", { folder }),
  openExternal: (url: string) => invoke("open_external", { url }),
  listBrowsers: () => invoke<CookiesBrowserResponse>("list_cookie_browsers"),
  setDefaultCookieSource: (source: CookieSource) =>
    invoke<CookiesBrowserResponse>("set_default_cookie_source", { source }),
  setCookiesBrowser: (browserId: string | null) =>
    invoke<CookiesBrowserResponse>("set_cookies_browser", { browserId }),
  checkHelpers: () => invoke<HelperCheckResult[]>("check_helpers"),
  updateHelpers: () => invoke<HelperUpdateResult[]>("update_helpers"),
  checkAppUpdate: () => invoke<AppUpdateInfo>("check_app_update"),
  installAppUpdate: async (onProgress) => {
    const update = await checkForUpdate();
    if (!update?.available) return;
    let downloaded = 0;
    let total: number | null = null;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }
      onProgress?.(downloaded, total);
    });
    await relaunch();
  },
  chooseOutputRoot: () => invoke("choose_output_root"),
  resetOutputRoot: () => invoke("reset_output_root"),
  openPath: (target: string) => invoke("open_path", { target }),
  showItemInFolder: (target: string) => invoke("show_item_in_folder", { target }),

  // Not in P2 scope — page probe/sniff. Native thumbnails (loadThumbnail /
  // loadLibraryThumbnail) are wired below to the Rust commands.
  probePage: notImplemented<PageProbeResponse>("probePage", {
    ok: false,
    url: "",
    error: "Page sniffing is not yet available on the Tauri build.",
    candidates: [],
  }),
  clearSniffCache: notImplemented("clearSniffCache", { ok: true }),
  loadThumbnail: (urls: string[]) => invoke<ThumbnailLoadResult>("load_thumbnail", { urls }),
  loadLibraryThumbnail: (target: string) => invoke<LibraryThumbnailResult>("load_library_thumbnail", { target }),
};

export function getDesktopClient(): DesktopClient | null {
  if (typeof window === "undefined") return null;
  if (window.rippo) return createDesktopClient(window.rippo);
  if (isTauriRuntime()) return tauriDesktopClient;
  return null;
}
