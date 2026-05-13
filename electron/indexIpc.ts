import { ipcMain } from "electron";
import { runEngine } from "./engineProcess";
import { currentOutputRoot, readSettings, writeSettings, type IndexIngestSettings } from "./settingsStore";

type NumberLimit = {
  min: number;
  max: number;
  step: number;
  default: number;
};

type IndexIngestLimits = {
  provider: "gemini";
  label: string;
  model: string;
  videoSeconds: number;
  recommendedDimensions: number[];
  chunkDuration: NumberLimit;
  overlap: NumberLimit;
  targetResolution: NumberLimit;
  targetFps: NumberLimit;
};

type IndexIngestPayload = {
  indexRoot?: string;
  paths?: string[];
};

type IndexSemanticIngestPayload = IndexIngestPayload & {
  provider?: string;
  chunkDuration?: number;
  overlap?: number;
  preprocess?: boolean;
  skipStill?: boolean;
  targetResolution?: number;
  targetFps?: number;
};

type IndexSearchPayload = {
  indexRoot?: string;
  query?: string;
  limit?: number;
};

type IndexUpsertPayload = {
  indexRoot?: string;
  moments?: unknown[];
};

function activeIndexIngestLimits(): IndexIngestLimits {
  return {
    provider: "gemini",
    label: "Gemini Embedding 2",
    model: process.env.RIPPO_GEMINI_EMBED_MODEL || "gemini-embedding-2",
    videoSeconds: 120,
    recommendedDimensions: [768, 1536, 3072],
    chunkDuration: { min: 5, max: 120, step: 5, default: 30 },
    overlap: { min: 0, max: 119, step: 1, default: 5 },
    targetResolution: { min: 144, max: 1080, step: 16, default: 480 },
    targetFps: { min: 1, max: 15, step: 1, default: 5 },
  };
}

function defaultIndexIngestSettings(limits = activeIndexIngestLimits()): IndexIngestSettings {
  return {
    provider: limits.provider,
    chunkDuration: limits.chunkDuration.default,
    overlap: limits.overlap.default,
    preprocess: true,
    skipStill: true,
    targetResolution: limits.targetResolution.default,
    targetFps: limits.targetFps.default,
  };
}

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.round(number), max));
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function indexIngestSettingsFrom(value?: Partial<IndexIngestSettings>, limits = activeIndexIngestLimits()): IndexIngestSettings {
  const defaults = defaultIndexIngestSettings(limits);
  const base = { ...defaults, ...(value || {}), provider: limits.provider };
  const chunkDuration = numberSetting(base.chunkDuration, defaults.chunkDuration, limits.chunkDuration.min, limits.chunkDuration.max);
  return {
    provider: limits.provider,
    chunkDuration,
    overlap: numberSetting(base.overlap, defaults.overlap, limits.overlap.min, Math.min(limits.overlap.max, chunkDuration - 1)),
    preprocess: booleanSetting(base.preprocess, defaults.preprocess),
    skipStill: booleanSetting(base.skipStill, defaults.skipStill),
    targetResolution: numberSetting(base.targetResolution, defaults.targetResolution, limits.targetResolution.min, limits.targetResolution.max),
    targetFps: numberSetting(base.targetFps, defaults.targetFps, limits.targetFps.min, limits.targetFps.max),
  };
}

function indexIngestSettingsResponse(settings: IndexIngestSettings, limits = activeIndexIngestLimits()) {
  return {
    ...settings,
    limits: {
      ...limits,
      overlap: {
        ...limits.overlap,
        max: Math.min(limits.overlap.max, settings.chunkDuration - 1),
      },
    },
  };
}

function indexRootFromInput(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return currentOutputRoot();
}

function safeIndexPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 500);
}

export function registerIndexIpcHandlers() {
  ipcMain.handle("engine:index-status", async (_event, indexRoot?: string) => {
    return await runEngine(["index-status", "--index-root", indexRootFromInput(indexRoot)]);
  });

  ipcMain.handle("engine:index-ingest", async (_event, payload?: IndexIngestPayload) => {
    const indexRoot = indexRootFromInput(payload?.indexRoot);
    const paths = safeIndexPaths(payload?.paths);
    if (!paths.length) {
      return {
        ok: false,
        indexRoot,
        assetCount: 0,
        momentCount: 0,
        embeddedMomentCount: 0,
        embeddingEndpointConfigured: false,
        indexed: [],
        added: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        skippedEntries: [],
        error: "Choose at least one folder or media file to index.",
      };
    }
    return await runEngine(["index-ingest", "--index-root", indexRoot, ...paths]);
  });

  ipcMain.handle("settings:index-ingest", async () => {
    const limits = activeIndexIngestLimits();
    return indexIngestSettingsResponse(indexIngestSettingsFrom(readSettings().indexIngest, limits), limits);
  });

  ipcMain.handle("settings:set-index-ingest", async (_event, payload?: Partial<IndexIngestSettings>) => {
    const limits = activeIndexIngestLimits();
    const settings = readSettings();
    const next = indexIngestSettingsFrom({ ...settings.indexIngest, ...(payload || {}) }, limits);
    settings.indexIngest = next;
    writeSettings(settings);
    return indexIngestSettingsResponse(next, limits);
  });

  ipcMain.handle("engine:index-semantic-ingest", async (_event, payload?: IndexSemanticIngestPayload) => {
    const indexRoot = indexRootFromInput(payload?.indexRoot);
    const paths = safeIndexPaths(payload?.paths);
    const limits = activeIndexIngestLimits();
    const saved = indexIngestSettingsFrom(readSettings().indexIngest, limits);
    const payloadSettings: Partial<IndexIngestSettings> = {
      chunkDuration: payload?.chunkDuration,
      overlap: payload?.overlap,
      preprocess: payload?.preprocess,
      skipStill: payload?.skipStill,
      targetResolution: payload?.targetResolution,
      targetFps: payload?.targetFps,
    };
    const options = indexIngestSettingsFrom({ ...saved, ...payloadSettings }, limits);
    if (!paths.length) {
      return {
        ok: false,
        indexRoot,
        assetCount: 0,
        momentCount: 0,
        embeddedMomentCount: 0,
        embeddingEndpointConfigured: false,
        geminiEmbeddingConfigured: false,
        semantic: true,
        embedded: 0,
        videoChunks: 0,
        imageCount: 0,
        failed: 0,
        skipped: 0,
        skippedEntries: [],
        error: "Choose at least one folder or media file to semantically index.",
      };
    }
    return await runEngine([
      "index-semantic-ingest",
      "--index-root",
      indexRoot,
      "--chunk-duration",
      String(options.chunkDuration),
      "--overlap",
      String(options.overlap),
      "--target-resolution",
      String(options.targetResolution),
      "--target-fps",
      String(options.targetFps),
      ...(options.preprocess ? [] : ["--no-preprocess"]),
      ...(options.skipStill ? [] : ["--no-skip-still"]),
      ...paths,
    ]);
  });

  ipcMain.handle("engine:index-search", async (_event, payload?: IndexSearchPayload) => {
    const indexRoot = indexRootFromInput(payload?.indexRoot);
    const query = typeof payload?.query === "string" ? payload.query.slice(0, 240) : "";
    const limit = Math.max(1, Math.min(Number(payload?.limit || 20), 100));
    return await runEngine(["index-search", "--index-root", indexRoot, "--query", query, "--limit", String(limit)]);
  });

  ipcMain.handle("engine:index-upsert", async (_event, payload?: IndexUpsertPayload) => {
    const indexRoot = indexRootFromInput(payload?.indexRoot);
    return await runEngine([
      "index-upsert",
      "--index-root",
      indexRoot,
      "--payload-json",
      JSON.stringify({ moments: Array.isArray(payload?.moments) ? payload?.moments : [] }),
    ]);
  });
}
