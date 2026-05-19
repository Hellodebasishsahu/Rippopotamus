import { ExternalLink } from "lucide-react";
import type { SourceSearchResponse, SourceSearchResult } from "../../../electron/types";

function sourceOpenUrl(source: SourceSearchResult): string {
  return source.openUrl || source.url;
}

export function SourceSearchPanel({
  sourceSearch,
  sourceSearchBusy,
  openExternal,
}: {
  sourceSearch: SourceSearchResponse;
  sourceSearchBusy: boolean;
  input: string;
  openExternal: (url: string) => void;
}) {
  if (!sourceSearch.query && !sourceSearch.results.length && !sourceSearch.error && !sourceSearchBusy) return null;

  const items = sourceSearch.results.filter((r) => r.resultKind === "item").slice(0, 12);
  const routes = sourceSearch.results.filter((r) => r.resultKind !== "item").slice(0, 6);

  return (
    <section className="search-panel">
      <p className="search-meta">
        {sourceSearchBusy ? "Searching…" : sourceSearch.error ? "Failed" : `${items.length || routes.length} hits`}
      </p>
      {sourceSearch.error ? <p className="error-text">{sourceSearch.error}</p> : null}
      {items.map((source) => (
        <article key={`${source.url}-${source.title}`} className="source-row">
          <div className="source-row-main">
            <span className="source-row-pack">{source.packLabel}</span>
            <span className="source-row-title">{source.title}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-fetch" onClick={() => openExternal(sourceOpenUrl(source))}>
            <ExternalLink size={13} strokeWidth={2} aria-hidden />
          </button>
        </article>
      ))}
      {routes.map((source) => (
        <article key={`route-${source.url}`} className="source-row source-row-muted">
          <span className="source-row-title">{source.title}</span>
          <button type="button" className="btn btn-ghost btn-fetch" onClick={() => openExternal(sourceOpenUrl(source))}>
            Open
          </button>
        </article>
      ))}
    </section>
  );
}
