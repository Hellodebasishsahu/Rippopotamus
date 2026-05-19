import { FileAudio, Film, FolderOpen, Image as ImageIcon, Loader2, Play } from "lucide-react";
import type { IndexSearchResponse, IndexStatusResponse } from "../../../electron/types";
import { indexEmptyState } from "../app/appFormatters";
import type { IndexBusy } from "../app/useLibraryIndex";
import { folderForPath, indexStatusLine } from "../app/libraryDisplayUtils";
import { libraryPlayerState, libraryPreviewStart, nextExpandedLibraryId } from "../app/libraryPreview";
import type { DesktopClient } from "../client/desktopClient";

export type LibraryViewProps = {
  desktop: DesktopClient | null;
  activeOutputRoot: string;
  indexBusy: IndexBusy;
  indexSearch: IndexSearchResponse;
  indexStatus: IndexStatusResponse | null;
  indexError: string | null;
  hasComposerText: boolean;
  expandedLibraryId: string | null;
  setExpandedLibraryId: (id: string | null) => void;
  libraryThumbs: Record<string, string | null>;
  libraryMediaUrls: Record<string, string | null>;
  consumerErrorMessage: (message: string, fallback?: string) => string;
};

export function LibraryView({
  desktop,
  indexBusy,
  indexSearch,
  indexStatus,
  indexError,
  hasComposerText,
  expandedLibraryId,
  setExpandedLibraryId,
  libraryThumbs,
  libraryMediaUrls,
  consumerErrorMessage,
}: LibraryViewProps) {
  if (!(indexSearch.query || indexSearch.results.length > 0 || indexError || indexBusy === "searching")) {
    return null;
  }

  return (
    <section className="index-panel">
      <p className="index-meta-line">
        {indexBusy === "searching" ? "Searching…" : `${indexSearch.resultCount} results`}
        <span>{indexStatusLine(indexStatus)}</span>
      </p>
      {indexError ? <p className="error-text">{consumerErrorMessage(indexError, "Search failed.")}</p> : null}
      {indexSearch.results.length > 0 ? (
        <div className="index-results">
          {indexSearch.results.map((result) => {
            const KindIcon = result.kind === "image" ? ImageIcon : result.kind === "audio" ? FileAudio : Film;
            const isExpanded = expandedLibraryId === result.id;
            const thumbUrl = libraryThumbs[result.id];
            const mediaUrl = libraryMediaUrls[result.id];
            const playableMediaUrl = typeof mediaUrl === "string" ? mediaUrl : undefined;
            const playerState = libraryPlayerState(result, expandedLibraryId, mediaUrl);
            const isPlayable = playerState !== "closed" || nextExpandedLibraryId(expandedLibraryId, result) !== expandedLibraryId;
            const toggleExpand = () => setExpandedLibraryId(nextExpandedLibraryId(expandedLibraryId, result));
            return (
              <article key={result.id} className={`index-result kind-${result.kind} ${isExpanded ? "is-expanded" : ""}`}>
                <button
                  type="button"
                  className="index-thumb"
                  onClick={toggleExpand}
                  disabled={!isPlayable}
                  aria-label={isPlayable ? (isExpanded ? "Collapse" : "Preview") : "No preview"}
                  aria-expanded={isExpanded}
                >
                  {thumbUrl ? (
                    <img className="index-thumb-img" src={thumbUrl} alt="" loading="lazy" decoding="async" />
                  ) : thumbUrl === null ? (
                    <KindIcon size={18} strokeWidth={1.6} className="index-thumb-icon" aria-hidden />
                  ) : (
                    <Loader2 size={16} strokeWidth={2} className="spin index-thumb-icon" aria-hidden />
                  )}
                  {isPlayable ? (
                    <span className="index-thumb-play" aria-hidden>
                      <Play size={12} strokeWidth={2.5} />
                    </span>
                  ) : null}
                </button>
                <div className="index-result-body">
                  <h3 className="index-result-title" title={result.title || result.file}>{result.title || result.file}</h3>
                  <p className="index-result-path" title={result.file}>{result.file}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-reveal"
                  onClick={() => desktop?.openFolder(folderForPath(result.path))}
                  disabled={!desktop}
                  title="Reveal"
                  aria-label="Reveal in folder"
                >
                  <FolderOpen size={13} strokeWidth={2} aria-hidden />
                </button>
                {isExpanded ? (
                  <div className="index-player">
                    {playerState === "video" ? (
                      <video
                        className="index-player-video"
                        src={playableMediaUrl}
                        controls
                        autoPlay
                        preload="metadata"
                        onLoadedMetadata={(event) => {
                          const start = libraryPreviewStart(result);
                          if (start > 0) (event.currentTarget as HTMLVideoElement).currentTime = start;
                        }}
                      />
                    ) : playerState === "audio" ? (
                      <audio className="index-player-audio" src={playableMediaUrl} controls autoPlay preload="metadata" />
                    ) : playerState === "image" ? (
                      <img className="index-player-image" src={playableMediaUrl} alt={result.title || result.file} />
                    ) : playerState === "missing" ? (
                      <p className="index-player-empty">File not found.</p>
                    ) : (
                      <Loader2 size={16} strokeWidth={2} className="spin" aria-label="Loading" />
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-hint">
          {indexEmptyState(indexBusy, indexSearch, indexStatus, hasComposerText).title}
        </p>
      )}
    </section>
  );
}
