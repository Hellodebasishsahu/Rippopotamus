import { ExternalLink } from "lucide-react";
import type { SourceSearchResponse, SourceSearchResult } from "../../../electron/types";

function sourceOpenUrl(source: SourceSearchResult): string {
  return source.openUrl || source.url;
}

function sourceActionLabel(source: SourceSearchResult): string {
  return source.actionLabel || (sourceOpenUrl(source) !== source.url ? "Search" : "Open");
}

function sourceBadgeLabel(source: SourceSearchResult): string {
  if (source.resultKind === "item") return `${source.sourceName || source.packLabel} result`;
  return "source route";
}

function sourceStatusLabel(search: SourceSearchResponse, busy: boolean): string {
  if (busy) return "Searching live sources...";
  const actual = search.actualResultCount ?? search.results.filter((result) => result.resultKind === "item").length;
  const routes = search.routeResultCount ?? search.results.filter((result) => result.resultKind !== "item").length;
  if (actual > 0 && routes > 0) return `${actual} results · ${routes} source routes`;
  if (actual > 0) return `${actual} results`;
  return `${routes || search.results.length} source routes`;
}

function sourceContextLabel(search: SourceSearchResponse, input: string): string {
  const intelligence = search.intelligence;
  if (intelligence?.enabled && intelligence.pack !== "all") {
    const evidence = intelligence.webEvidence;
    const evidenceCount = evidence?.resultCount ?? evidence?.results?.length ?? 0;
    if (evidenceCount > 0) {
      return `AI routed to ${intelligence.packLabel} from ${evidence?.label || evidence?.source || "web evidence"}`;
    }
    return `AI routed to ${intelligence.packLabel}`;
  }
  const activePack = search.packs.find((pack) => pack.id === search.pack);
  if (activePack) return `${activePack.label} routes`;
  return input.trim() ? "Source routes" : "Pick a source";
}

export function SourceSearchPanel({
  sourceSearch,
  sourceSearchBusy,
  input,
  openExternal,
}: {
  sourceSearch: SourceSearchResponse;
  sourceSearchBusy: boolean;
  input: string;
  openExternal: (url: string) => void;
}) {
  if (!sourceSearch.query && !sourceSearch.results.length && !sourceSearch.error && !sourceSearchBusy) return null;

  return (
    <div className="search-panel">
      <div className="search-status">
        <span>{sourceStatusLabel(sourceSearch, sourceSearchBusy)}</span>
        <span>{sourceContextLabel(sourceSearch, input)}</span>
      </div>
      {sourceSearch.error ? <p className="error-text">{sourceSearch.error}</p> : null}
      {sourceSearch.media ? (
        <article className="media-card">
          {sourceSearch.media.poster ? (
            <img className="media-poster" src={sourceSearch.media.poster} alt={sourceSearch.media.title || ""} loading="lazy" />
          ) : (
            <div className="media-poster media-poster-empty" aria-hidden />
          )}
          <div className="media-body">
            <div className="media-head">
              <h2 className="media-title">{sourceSearch.media.title}</h2>
              <div className="media-meta">
                {sourceSearch.media.year ? <span>{sourceSearch.media.year}</span> : null}
                {sourceSearch.media.type ? <span className="media-kind">{sourceSearch.media.type === "series" ? "Series" : "Movie"}</span> : null}
                {sourceSearch.media.runtime ? <span>{sourceSearch.media.runtime}</span> : null}
                {sourceSearch.media.imdbRating ? <span className="media-rating">★ {sourceSearch.media.imdbRating}</span> : null}
              </div>
            </div>
            {sourceSearch.media.synopsis ? <p className="media-synopsis">{sourceSearch.media.synopsis}</p> : null}
            {sourceSearch.media.genres?.length ? (
              <div className="media-tags">
                {sourceSearch.media.genres.slice(0, 4).map((genre) => (
                  <span key={genre} className="media-tag">{genre}</span>
                ))}
              </div>
            ) : null}
            {sourceSearch.media.cast?.length ? (
              <p className="media-cast">{sourceSearch.media.cast.join(" · ")}</p>
            ) : null}
          </div>
        </article>
      ) : null}
      {sourceSearch.playable && sourceSearch.playable.length > 0 ? (
        <div className="playable-list">
          {sourceSearch.playable.map((link, idx) => (
            <article key={`${link.url}-${idx}`} className="playable-row">
              <div className="playable-info">
                <span className="playable-host">{link.host}</span>
                <span className="playable-label" title={link.label}>{link.label}</span>
                <div className="playable-meta">
                  {link.extension ? <span className="playable-tag">{link.extension.toUpperCase()}</span> : null}
                  {link.size ? <span>{link.size}</span> : null}
                  {link.quality ? <span>{link.quality}</span> : null}
                </div>
              </div>
              <div className="playable-actions">
                <button type="button" className="btn btn-primary btn-source" onClick={() => openExternal(link.url)}>
                  <ExternalLink size={14} strokeWidth={2} aria-hidden /> Play
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : !sourceSearchBusy && sourceSearch.query ? (
        <p className="empty-playable">No playable sources matched yet. More adapters landing soon.</p>
      ) : null}
      {sourceSearch.results.length > 0 ? (
        <div className="source-results">
          {sourceSearch.results.map((source) => (
            <article key={`${source.url}-${source.title}`} className="source-card">
              <div className="source-main">
                <div className="source-head">
                  <span className="source-pack-label">{source.packLabel}</span>
                  <h3 className="source-title">{source.title}</h3>
                </div>
                {source.description ? <p className="source-desc">{source.description}</p> : null}
                {source.usage ? <p className="source-note">{source.usage}</p> : null}
                {source.mediaTypes?.length ? (
                  <div className="source-tags">
                    <span className="source-badge">{sourceBadgeLabel(source)}</span>
                    {source.mediaTypes.map((tag) => <span key={tag} className="source-tag">{tag}</span>)}
                  </div>
                ) : null}
              </div>
              <div className="source-actions">
                <button type="button" className="btn btn-ghost btn-source" onClick={() => openExternal(sourceOpenUrl(source))}>
                  <ExternalLink size={14} strokeWidth={2} aria-hidden /> {sourceActionLabel(source)}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
