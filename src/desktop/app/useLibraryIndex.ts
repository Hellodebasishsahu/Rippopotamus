import { useEffect, useState } from "react";
import type { IndexSearchResponse, IndexStatusResponse } from "../../../electron/types";
import type { DesktopClient } from "../client/desktopClient";

export type IndexBusy = "idle" | "ingesting" | "searching";

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

type UseLibraryIndexOptions = {
  desktop: DesktopClient | null;
  outputRoot: string;
  consumerErrorMessage: (message: string, fallback?: string) => string;
};

export function useLibraryIndex({
  desktop,
  outputRoot,
  consumerErrorMessage,
}: UseLibraryIndexOptions) {
  const [indexStatus, setIndexStatus] = useState<IndexStatusResponse | null>(null);
  const [indexSearch, setIndexSearch] = useState<IndexSearchResponse>(EMPTY_INDEX_SEARCH);
  const [indexBusy, setIndexBusy] = useState<IndexBusy>("idle");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [libraryThumbs, setLibraryThumbs] = useState<Record<string, string | null>>({});
  const [expandedLibraryId, setExpandedLibraryId] = useState<string | null>(null);
  const [libraryMediaUrls, setLibraryMediaUrls] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!desktop || typeof desktop.indexStatus !== "function" || !outputRoot) return;
    let cancelled = false;
    desktop.indexStatus().then((result) => {
      if (!cancelled) setIndexStatus(result);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [desktop, outputRoot]);

  useEffect(() => {
    if (!desktop || typeof desktop.libraryThumbnail !== "function") return;
    let cancelled = false;
    const pending = indexSearch.results.filter((result) => !(result.id in libraryThumbs));
    if (pending.length === 0) return;
    (async () => {
      for (const result of pending) {
        if (cancelled) return;
        try {
          const res = await desktop.libraryThumbnail({ path: result.path, time: result.start ?? 0 });
          if (cancelled) return;
          setLibraryThumbs((prev) => ({ ...prev, [result.id]: res?.url || null }));
        } catch {
          if (!cancelled) setLibraryThumbs((prev) => ({ ...prev, [result.id]: null }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [desktop, indexSearch.results, libraryThumbs]);

  useEffect(() => {
    if (!expandedLibraryId || !desktop || typeof desktop.libraryMediaUrl !== "function") return;
    if (expandedLibraryId in libraryMediaUrls) return;
    const result = indexSearch.results.find((candidate) => candidate.id === expandedLibraryId);
    if (!result) return;
    let cancelled = false;
    desktop.libraryMediaUrl({ path: result.path }).then((res) => {
      if (cancelled) return;
      setLibraryMediaUrls((prev) => ({ ...prev, [expandedLibraryId]: res?.url || null }));
    }).catch(() => {
      if (!cancelled) setLibraryMediaUrls((prev) => ({ ...prev, [expandedLibraryId]: null }));
    });
    return () => { cancelled = true; };
  }, [desktop, expandedLibraryId, indexSearch.results, libraryMediaUrls]);

  useEffect(() => {
    setLibraryThumbs({});
    setLibraryMediaUrls({});
    setExpandedLibraryId(null);
  }, [indexSearch.query, indexSearch.indexRoot]);

  function resetIndexSearch() {
    setIndexSearch(EMPTY_INDEX_SEARCH);
    setIndexError(null);
  }

  function clearIndexError() {
    setIndexError(null);
  }

  async function indexSavedFolder() {
    if (!desktop || !outputRoot) {
      setIndexError("Index runs inside the desktop app.");
      return;
    }

    setIndexBusy("ingesting");
    setIndexError(null);
    try {
      const basicResult = await desktop.indexIngest({ paths: [outputRoot] });
      if (!basicResult.ok) {
        setIndexError(consumerErrorMessage(basicResult.error || "", "Could not index this folder."));
        return;
      }
      setIndexStatus(basicResult);
    } catch (error) {
      setIndexError(consumerErrorMessage(error instanceof Error ? error.message : String(error), "Could not index this folder."));
    } finally {
      setIndexBusy("idle");
    }
  }

  async function searchSavedFootage(query: string) {
    const normalizedQuery = query.trim().slice(0, 240);
    if (!normalizedQuery) return;
    if (!desktop || typeof desktop.indexSearch !== "function" || !outputRoot) {
      setIndexSearch({ ...EMPTY_INDEX_SEARCH, query: normalizedQuery, indexRoot: outputRoot });
      setIndexError("Index search runs inside the desktop app.");
      return;
    }

    setIndexBusy("searching");
    setIndexError(null);
    try {
      const result = await desktop.indexSearch({ query: normalizedQuery, limit: 24 });
      setIndexSearch(result);
      setIndexStatus(result);
      if (!result.ok) setIndexError(consumerErrorMessage(result.error || "", "Could not search saved footage."));
    } catch (error) {
      setIndexSearch({ ...EMPTY_INDEX_SEARCH, query: normalizedQuery, indexRoot: outputRoot });
      setIndexError(consumerErrorMessage(error instanceof Error ? error.message : String(error), "Could not search the index."));
    } finally {
      setIndexBusy("idle");
    }
  }

  return {
    indexStatus,
    indexSearch,
    indexBusy,
    indexError,
    libraryThumbs,
    expandedLibraryId,
    libraryMediaUrls,
    setExpandedLibraryId,
    resetIndexSearch,
    clearIndexError,
    indexSavedFolder,
    searchSavedFootage,
  };
}
