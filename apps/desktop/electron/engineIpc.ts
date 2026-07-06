import { app, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { runEngine } from "./engineProcess";
import {
  currentOutputRoot,
  currentTransferSettings,
  transferEnv,
  writeTransferSettings,
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
    const transfer = currentTransferSettings();
    const health = (await runEngine(["health", ...cookieSourceArgs(source)], undefined, transferEnv(transfer))) as Record<string, unknown>;
    return {
      ...health,
      cookiesSupported: cookiesSupported(),
      cookiesBrowsers: browsers,
      cookiesBrowser: cookieSourceBrowserId(source),
      cookieSource: source,
      transfer,
      outputRoot: currentOutputRoot(),
      packaged: app.isPackaged,
    };
  }

  function registerEngineIpcHandlers() {
    ipcMain.handle("engine:health", async () => engineHealthPayload());

    ipcMain.handle("transfer:set-settings", async (_event, payload?: { aria2MaxConnections?: number; aria2DownloadLimit?: string }) => {
      const transfer = writeTransferSettings(payload || {});
      return {
        transfer,
        health: await engineHealthPayload(),
      };
    });

    ipcMain.handle("engine:fetch", async (_event, url: string, provider?: string, cookieSourceInput?: unknown) => {
      const cookieSource = cookieSourceFromInput(cookieSourceInput);
      const transfer = currentTransferSettings();
      const args = ["fetch", "--url", url];
      if (provider) args.push("--provider", provider);
      args.push(...cookieSourceArgs(cookieSource));
      try {
        return await runEngine(args, undefined, transferEnv(transfer));
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
      const transfer = currentTransferSettings();
      const args = ["fetch", "--full", "--url", url];
      if (provider) args.push("--provider", provider);
      args.push(...cookieSourceArgs(cookieSource));
      try {
        return await runEngine(args, undefined, transferEnv(transfer));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          url,
          error: message || "Fetch failed.",
        };
      }
    });

    ipcMain.handle("engine:download", async (event, payload: { url: string; preset: string; outputRoot?: string; itemId?: string; title?: string; cookieSource?: unknown }) => {
      const cookieSource = cookieSourceFromInput(payload.cookieSource);
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
        }, transferEnv(transfer), (cancel) => {
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
