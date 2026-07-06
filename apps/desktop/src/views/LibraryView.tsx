import { AlertTriangle, Inbox, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryItem, PresetOption } from "../types/desktop";
import { useLibrary } from "../app/useLibrary";
import type { DesktopClient } from "../client/desktopClient";
import { LibraryCard } from "../components/LibraryCard";

type SortKey = "newest" | "name" | "size" | "type";

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "name", label: "Name" },
  { id: "size", label: "Size" },
  { id: "type", label: "Type" },
];

const KIND_FILTERS: { id: LibraryItem["kind"]; label: string }[] = [
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "image", label: "Image" },
  { id: "document", label: "Doc" },
  { id: "file", label: "File" },
];

const BATCH_SIZE = 60;

function sortItems(items: LibraryItem[], sort: SortKey): LibraryItem[] {
  const next = items.slice();
  switch (sort) {
    case "name":
      next.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
      break;
    case "size":
      next.sort((a, b) => (b.totalSize ?? 0) - (a.totalSize ?? 0));
      break;
    case "type":
      next.sort((a, b) => a.kind.localeCompare(b.kind) || (b.savedAt ?? 0) - (a.savedAt ?? 0));
      break;
    case "newest":
    default:
      next.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
      break;
  }
  return next;
}

export function LibraryView({
  desktop,
  outputRoot,
  presetOptions,
  refreshKey,
  query,
  onLoadingChange,
  openSource,
}: {
  desktop: DesktopClient | null;
  outputRoot: string;
  presetOptions: PresetOption[];
  refreshKey: number;
  query: string;
  onLoadingChange?: (loading: boolean) => void;
  openSource: (item: LibraryItem) => void;
}) {
  const { items, missing, loading, error } = useLibrary({ desktop, outputRoot, refreshKey, onLoadingChange });

  const [sort, setSort] = useState<SortKey>("newest");
  const [kindFilter, setKindFilter] = useState<LibraryItem["kind"] | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

  // Auto-dismiss transient action errors.
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(timer);
  }, [actionError]);

  // Count of items per kind (from the full search-filtered set), used for chips.
  const searchFiltered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      const haystack = [
        item.title,
        item.url,
        item.preset,
        ...item.files.map((file) => file.path),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, query]);

  const kindCounts = useMemo(() => {
    const counts = new Map<LibraryItem["kind"], number>();
    for (const item of searchFiltered) {
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    }
    return counts;
  }, [searchFiltered]);

  const availableKinds = useMemo(
    () => KIND_FILTERS.filter((entry) => (kindCounts.get(entry.id) ?? 0) > 0),
    [kindCounts],
  );

  // If the active kind filter no longer exists, fall back to All.
  useEffect(() => {
    if (kindFilter !== "all" && (kindCounts.get(kindFilter) ?? 0) === 0) {
      setKindFilter("all");
    }
  }, [kindFilter, kindCounts]);

  const visibleItems = useMemo(() => {
    const byKind = kindFilter === "all"
      ? searchFiltered
      : searchFiltered.filter((item) => item.kind === kindFilter);
    return sortItems(byKind, sort);
  }, [searchFiltered, kindFilter, sort]);

  // Reset the incremental window whenever the visible list identity changes.
  useEffect(() => {
    setVisibleCount(BATCH_SIZE);
  }, [visibleItems]);

  const rendered = useMemo(() => visibleItems.slice(0, visibleCount), [visibleItems, visibleCount]);
  const hasMore = visibleCount < visibleItems.length;

  // Sentinel-driven incremental rendering.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + BATCH_SIZE);
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, rendered.length]);

  const isEmpty = !loading && !error && visibleItems.length === 0;

  return (
    <section className="library">
      {error ? <p className="error-text library-message">{error}</p> : null}

      {!error && items.length > 0 ? (
        <div className="library-toolbar">
          <div className="library-chips" role="group" aria-label="Filter by type">
            <button
              type="button"
              className={`library-chip${kindFilter === "all" ? " is-active" : ""}`}
              onClick={() => setKindFilter("all")}
            >
              All <span className="library-chip-count">{searchFiltered.length}</span>
            </button>
            {availableKinds.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`library-chip${kindFilter === entry.id ? " is-active" : ""}`}
                onClick={() => setKindFilter(entry.id)}
              >
                {entry.label} <span className="library-chip-count">{kindCounts.get(entry.id)}</span>
              </button>
            ))}
          </div>

          <div className="library-sort" role="group" aria-label="Sort by">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`library-sort-btn${sort === option.id ? " is-active" : ""}`}
                onClick={() => setSort(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {actionError ? (
        <p className="error-text library-message library-action-error" role="alert">
          <AlertTriangle size={13} strokeWidth={2} aria-hidden /> {actionError}
        </p>
      ) : null}

      {!error && missing > 0 ? (
        <p className="library-note">
          {missing} saved {missing === 1 ? "file is" : "files are"} missing from disk.
        </p>
      ) : null}

      {isEmpty ? (
        <div className="library-empty">
          <div className="library-empty-icon-wrapper">
            {items.length ? (
              <Search size={32} className="library-empty-icon" aria-hidden />
            ) : (
              <Inbox size={32} className="library-empty-icon" aria-hidden />
            )}
          </div>
          <p className="library-empty-title">{items.length ? "No matches" : "Nothing saved yet"}</p>
          <p className="hint-text">
            {items.length
              ? "Try another search term or filter."
              : "Finished downloads show up here after you save them from the queue."}
          </p>
        </div>
      ) : null}

      {visibleItems.length > 0 ? (
        <div className="library-scroll">
          <p className="library-summary">
            {visibleItems.length} {visibleItems.length === 1 ? "item" : "items"}
          </p>
          <div className="queue-grid library-grid">
            {rendered.map((item) => (
              <LibraryCard
                key={item.id}
                item={item}
                outputRoot={outputRoot}
                desktop={desktop}
                presetOptions={presetOptions}
                openSource={openSource}
                onError={setActionError}
              />
            ))}
          </div>
          {hasMore ? <div ref={sentinelRef} className="library-sentinel" aria-hidden /> : null}
        </div>
      ) : null}
    </section>
  );
}
