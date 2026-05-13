import { useCallback, useMemo, useState } from "react";
import type { SourceSearchPack, SourceSearchResponse } from "../../../electron/types";
import type { DesktopClient } from "../client/desktopClient";

const DEFAULT_SOURCE_PACKS: SourceSearchPack[] = [
  { id: "all", label: "All" },
  { id: "movies", label: "Movies and shows" },
  { id: "starter", label: "Best starting points" },
  { id: "public", label: "Public archives" },
  { id: "stock", label: "Free stock media" },
  { id: "tools", label: "Media tools" },
];

const EMPTY_SOURCE_SEARCH: SourceSearchResponse = {
  ok: false,
  query: "",
  pack: "all",
  packs: DEFAULT_SOURCE_PACKS,
  results: [],
};

type UseSourceSearchOptions = {
  desktop: DesktopClient | null;
  consumerErrorMessage: (message: string, fallback?: string) => string;
};

export function useSourceSearch({ desktop, consumerErrorMessage }: UseSourceSearchOptions) {
  const [activeSourcePack, setActiveSourcePack] = useState("all");
  const [sourceSearch, setSourceSearch] = useState<SourceSearchResponse>(EMPTY_SOURCE_SEARCH);
  const [sourceSearchBusy, setSourceSearchBusy] = useState(false);

  const sourcePacks = useMemo(() => {
    const packs = [...DEFAULT_SOURCE_PACKS, ...sourceSearch.packs];
    return packs.filter((pack, index, list) => list.findIndex((candidate) => candidate.id === pack.id) === index);
  }, [sourceSearch.packs]);

  const resetSourceSearch = useCallback(() => {
    setSourceSearch(EMPTY_SOURCE_SEARCH);
  }, []);

  const searchSources = useCallback(async (query: string) => {
    const normalizedQuery = query.trim().slice(0, 120);
    if (!normalizedQuery || !desktop || typeof desktop.searchSources !== "function") {
      setSourceSearch({
        ...EMPTY_SOURCE_SEARCH,
        query: normalizedQuery,
        pack: activeSourcePack,
        error: "Source search runs inside the desktop app.",
      });
      return;
    }

    setSourceSearchBusy(true);
    try {
      const result = await desktop.searchSources(normalizedQuery, activeSourcePack);
      setSourceSearch(result);
    } catch (error) {
      setSourceSearch({
        ...EMPTY_SOURCE_SEARCH,
        query: normalizedQuery,
        pack: activeSourcePack,
        error: consumerErrorMessage(error instanceof Error ? error.message : String(error), "Could not search sources."),
      });
    } finally {
      setSourceSearchBusy(false);
    }
  }, [activeSourcePack, consumerErrorMessage, desktop]);

  return {
    activeSourcePack,
    setActiveSourcePack,
    sourcePacks,
    sourceSearch,
    sourceSearchBusy,
    resetSourceSearch,
    searchSources,
  };
}
