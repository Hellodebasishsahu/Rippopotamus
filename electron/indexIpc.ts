import { ipcMain } from "electron";
import { libraryIndexRoot } from "./appPaths";
import { runEngine } from "./engineProcess";

type IndexIngestPayload = {
  indexRoot?: string;
  paths?: string[];
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

function indexRootFromInput(_value: unknown): string {
  return libraryIndexRoot();
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

  ipcMain.handle("engine:index-search", async (_event, payload?: IndexSearchPayload) => {
    const indexRoot = indexRootFromInput(payload?.indexRoot);
    const query = typeof payload?.query === "string" ? payload.query.slice(0, 240) : "";
    const limit = Math.max(1, Math.min(Number(payload?.limit || 20), 100));
    return await runEngine(["index-search", "--no-vector", "--index-root", indexRoot, "--query", query, "--limit", String(limit)]);
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
