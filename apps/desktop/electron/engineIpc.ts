import { app, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { runEngine } from "./engineProcess";
import {
  currentNetworkProxy,
  currentOutputRoot,
  currentTransferSettings,
  transferEnv,
  writeTransferSettings,
  writeNetworkProxy,
} from "./settingsStore";
import {
  cookieSourceArgs,
  cookieSourceBrowserId,
  cookieSourceFromInput,
  cookiesSupported,
  defaultCookieSource,
  detectBrowsers,
} from "./cookiesIpc";

function usefulDownloadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "");
  const message = raw.trim();
  if (!message || /^Engine exited with code \d+$/i.test(message)) {
    return "Download failed before Rippo received details. Retry the source page or use Sniff page.";
  }
  return message;
}

export function createEngineIpc() {
  const activeDownloads = new Map<string, { cancel: () => void }>();

  async function engineHealthPayload(): Promise<Record<string, unknown>> {
    const browsers = detectBrowsers();
    const source = defaultCookieSource(browsers);
    const proxy = currentNetworkProxy();
    const transfer = currentTransferSettings();
    const health = (await runEngine(["health", ...cookieSourceArgs(source)], undefined, { ...(proxy ? { RIPPO_NETWORK_PROXY: proxy } : {}), ...transferEnv(transfer) })) as Record<string, unknown>;
    return {
      ...health,
      cookiesSupported: cookiesSupported(),
      cookiesBrowsers: browsers,
      cookiesBrowser: cookieSourceBrowserId(source),
      cookieSource: source,
      networkProxy: proxy,
      networkProxyEnabled: Boolean(proxy),
      transfer,
      outputRoot: currentOutputRoot(),
      packaged: app.isPackaged,
    };
  }

  function registerEngineIpcHandlers() {
    ipcMain.handle("engine:health", async () => engineHealthPayload());

    ipcMain.handle("network:set-proxy", async (_event, proxy?: string) => {
      const networkProxy = writeNetworkProxy(typeof proxy === "string" ? proxy : "");
      return {
        networkProxy,
        health: await engineHealthPayload(),
      };
    });

    ipcMain.handle("network:check-proxy", async (_event, proxy?: string) => {
      const candidate = typeof proxy === "string" ? proxy.trim().slice(0, 400) : "";
      try {
        return await runEngine(["proxy-check", "--proxy", candidate]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, proxy: candidate, error: message || "Proxy test failed." };
      }
    });

    ipcMain.handle("transfer:set-settings", async (_event, payload?: { aria2MaxConnections?: number; aria2DownloadLimit?: string }) => {
      const transfer = writeTransferSettings(payload || {});
      return {
        transfer,
        health: await engineHealthPayload(),
      };
    });

    ipcMain.handle("engine:fetch", async (_event, url: string, provider?: string, cookieSourceInput?: unknown) => {
      const cookieSource = cookieSourceFromInput(cookieSourceInput);
      const proxy = currentNetworkProxy();
      const transfer = currentTransferSettings();
      const args = ["fetch", "--url", url];
      if (provider) args.push("--provider", provider);
      args.push(...cookieSourceArgs(cookieSource));
      try {
        return await runEngine(args, undefined, { ...(proxy ? { RIPPO_NETWORK_PROXY: proxy } : {}), ...transferEnv(transfer) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          url,
          error: message || "Fetch failed.",
        };
      }
    });

    ipcMain.handle("engine:fetch-full", async (_event, url: string, provider?: string, cookieSourceInput?: unknown) => {
      const cookieSource = cookieSourceFromInput(cookieSourceInput);
      const proxy = currentNetworkProxy();
      const transfer = currentTransferSettings();
      const args = ["fetch", "--full", "--url", url];
      if (provider) args.push("--provider", provider);
      args.push(...cookieSourceArgs(cookieSource));
      try {
        return await runEngine(args, undefined, { ...(proxy ? { RIPPO_NETWORK_PROXY: proxy } : {}), ...transferEnv(transfer) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          url,
          error: message || "Fetch failed.",
        };
      }
    });

    ipcMain.handle(
      "engine:sheet-import",
      async (event, payload: {
        sheetUrl: string;
        outputRoot: string;
        projectName?: string;
        sheetName?: string;
        jobId?: string;
        cookieSource?: unknown;
        state?: string;
        pc?: string;
        status?: string;
        limit?: number;
        requireMaster?: boolean;
        downloadMaster?: boolean;
      }) => {
        const cookieSource = cookieSourceFromInput(payload.cookieSource);
        const proxy = currentNetworkProxy();
        const transfer = currentTransferSettings();
        const jobId = typeof payload.jobId === "string" && payload.jobId.trim() ? payload.jobId.trim() : randomUUID();
        const sheetUrl = typeof payload.sheetUrl === "string" ? payload.sheetUrl.trim() : "";
        const outputRoot = typeof payload.outputRoot === "string" ? payload.outputRoot.trim() : "";
        if (!sheetUrl || !outputRoot) {
          return { ok: false, error: "Sheet URL and output folder are required." };
        }
        fs.mkdirSync(outputRoot, { recursive: true });
        const args = [
          "sheet-import",
          "--sheet-url",
          sheetUrl,
          "--output-root",
          outputRoot,
          "--project-name",
          (payload.projectName || "sheet-import").trim() || "sheet-import",
          "--sheet-name",
          (payload.sheetName || "Tracker").trim() || "Tracker",
          "--job-id",
          jobId,
          ...cookieSourceArgs(cookieSource),
        ];
        if (payload.state) args.push("--state", String(payload.state));
        if (payload.pc) args.push("--pc", String(payload.pc));
        if (payload.status) args.push("--status", String(payload.status));
        if (typeof payload.limit === "number" && payload.limit > 0) args.push("--limit", String(Math.min(payload.limit, 5000)));
        if (payload.requireMaster) args.push("--require-master");
        if (payload.downloadMaster) args.push("--download-master");
        try {
          const result = await runEngine(args, (engineEvent) => {
            event.sender.send("engine:sheet-import-event", { jobId, ...(engineEvent as Record<string, unknown>) });
          }, { ...(proxy ? { RIPPO_NETWORK_PROXY: proxy } : {}), ...transferEnv(transfer) });
          return { jobId, ok: true, result };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "");
          event.sender.send("engine:sheet-import-event", { jobId, type: "sheet-import", phase: "error", error: message || "Sheet import failed." });
          return { jobId, ok: false, error: message || "Sheet import failed." };
        }
      },
    );

    ipcMain.handle("engine:download", async (event, payload: { url: string; preset: string; outputRoot?: string; itemId?: string; title?: string; cookieSource?: unknown }) => {
      const cookieSource = cookieSourceFromInput(payload.cookieSource);
      const proxy = currentNetworkProxy();
      const transfer = currentTransferSettings();
      const jobId = payload.itemId || randomUUID();
      const outputRoot = payload.outputRoot || currentOutputRoot();
      fs.mkdirSync(outputRoot, { recursive: true });
      const args = [
        "download",
        "--url",
        payload.url,
        "--preset",
        payload.preset,
        "--output-root",
        outputRoot,
        "--item-id",
        payload.itemId || jobId.slice(0, 10),
        "--title",
        payload.title || "",
        ...cookieSourceArgs(cookieSource),
      ];
      try {
        let cancelRun: (() => void) | null = null;
        let cancelRequested = false;
        activeDownloads.set(jobId, {
          cancel: () => {
            cancelRequested = true;
            cancelRun?.();
          },
        });
        const result = await runEngine(args, (engineEvent) => {
          event.sender.send("engine:download-event", { jobId, ...engineEvent as Record<string, unknown> });
        }, { ...(proxy ? { RIPPO_NETWORK_PROXY: proxy } : {}), ...transferEnv(transfer) }, (cancel) => {
          cancelRun = cancel;
          if (cancelRequested) cancel();
          activeDownloads.set(jobId, { cancel });
        });
        return { jobId, result };
      } catch (error) {
        const message = usefulDownloadError(error);
        if (/download canceled/i.test(message)) {
          event.sender.send("engine:download-event", { jobId, type: "canceled", message });
          return { jobId, result: { type: "canceled", message } };
        }
        event.sender.send("engine:download-event", { jobId, type: "error", error: message });
        return { jobId, result: { type: "error", error: message } };
      } finally {
        activeDownloads.delete(jobId);
      }
    });

    ipcMain.handle("engine:download-cancel", async (_event, jobId?: string) => {
      const id = typeof jobId === "string" ? jobId.trim() : "";
      const active = id ? activeDownloads.get(id) : null;
      if (!id || !active) return { ok: false, jobId: id, error: "Download is not running." };
      active.cancel();
      return { ok: true, jobId: id };
    });
  }

  return {
    engineHealthPayload,
    registerEngineIpcHandlers,
  };
}
