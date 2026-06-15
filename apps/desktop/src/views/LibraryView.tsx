import { useMemo } from "react";
import type { LibraryItem, PresetOption } from "../../electron/types";
import { useLibrary } from "../app/useLibrary";
import type { DesktopClient } from "../client/desktopClient";
import { LibraryCard } from "../components/LibraryCard";

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
  const { items, loading, error } = useLibrary({ desktop, outputRoot, refreshKey, onLoadingChange });

  const filteredItems = useMemo(() => {
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

  return (
    <section className="library">
      {error ? <p className="error-text library-message">{error}</p> : null}

      {!loading && !error && filteredItems.length === 0 ? (
        <div className="library-empty">
          <p className="library-empty-title">{items.length ? "No matches" : "Nothing saved yet"}</p>
          <p className="hint-text">
            {items.length
              ? "Try another search term."
              : "Finished downloads show up here after you save them from the queue."}
          </p>
        </div>
      ) : null}

      {filteredItems.length > 0 ? (
        <div className="library-scroll">
          <div className="queue-grid library-grid">
            {filteredItems.map((item) => (
              <LibraryCard
                key={item.id}
                item={item}
                outputRoot={outputRoot}
                desktop={desktop}
                presetOptions={presetOptions}
                openSource={openSource}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
