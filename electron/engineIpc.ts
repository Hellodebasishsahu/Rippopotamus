import { app, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { runEngine } from "./engineProcess";
import {
  currentOpenRouterModel,
  currentOutputRoot,
  readSettings,
  writeSettings,
} from "./settingsStore";
import {
  cookieSourceArgs,
  cookieSourceBrowserId,
  cookieSourceFromInput,
  cookiesSupported,
  defaultCookieSource,
  detectBrowsers,
} from "./cookiesIpc";

type EngineIpcOptions = {
  browserSerpEnabled: () => boolean;
};

export function createEngineIpc(options: EngineIpcOptions) {
  async function engineHealthPayload(): Promise<Record<string, unknown>> {
    const browsers = detectBrowsers();
    const source = defaultCookieSource(browsers);
    const health = (await runEngine(["health", ...cookieSourceArgs(source)])) as Record<string, unknown>;
    return {
      ...health,
      cookiesSupported: cookiesSupported(),
      cookiesBrowsers: browsers,
      cookiesBrowser: cookieSourceBrowserId(source),
      cookieSource: source,
      outputRoot: currentOutputRoot(),
      openRouterModel: currentOpenRouterModel(),
      openRouterKeyPresent: Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim()),
      searchEvidence: options.browserSerpEnabled()
        ? {
          configured: true,
          available: true,
          provider: "electron_google",
          label: "Electron Google",
          reason: "Uses Electron's bundled Chromium to read Google result context before routing.",
        }
        : health.searchEvidence,
      packaged: app.isPackaged,
    };
  }

  function registerEngineIpcHandlers() {
    ipcMain.handle("engine:health", async () => engineHealthPayload());

    ipcMain.handle("ai:models", async (_event, refresh?: boolean) => {
      return await runEngine(["ai-models", "--selected-model", currentOpenRouterModel(), ...(refresh ? ["--refresh"] : [])]);
    });

    ipcMain.handle("ai:set-model", async (_event, modelId?: string) => {
      const model = typeof modelId === "string" && modelId.trim() ? modelId.trim().slice(0, 140) : "openrouter/free";
      const settings = readSettings();
      settings.openRouterModel = model;
      writeSettings(settings);
      return {
        model,
        health: await engineHealthPayload(),
        catalog: await runEngine(["ai-models", "--selected-model", model]),
      };
    });

    ipcMain.handle("engine:fetch", async (_event, url: string, provider?: string, cookieSourceInput?: unknown) => {
      const cookieSource = cookieSourceFromInput(cookieSourceInput);
      const args = ["fetch", "--url", url];
      if (provider) args.push("--provider", provider);
      args.push(...cookieSourceArgs(cookieSource));
      try {
        return await runEngine(args);
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
      const result = await runEngine(args, (engineEvent) => {
        event.sender.send("engine:download-event", { jobId, ...engineEvent as Record<string, unknown> });
      });
      return { jobId, result };
    });
  }

  return {
    engineHealthPayload,
    registerEngineIpcHandlers,
  };
}
