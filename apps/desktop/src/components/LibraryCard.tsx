import { ExternalLink, FolderOpen, Link2 } from "lucide-react";
import type { LibraryItem, PresetOption } from "../types/desktop";
import { absoluteLibraryPath, formatBytes, formatSavedAt, presetLabel } from "../app/useLibrary";
import type { DesktopClient } from "../client/desktopClient";
import { LibraryThumbnail } from "./LibraryThumbnail";

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function fileBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function LibraryCard({
  item,
  outputRoot,
  desktop,
  presetOptions,
  openSource,
  onError,
}: {
  item: LibraryItem;
  outputRoot: string;
  desktop: DesktopClient | null;
  presetOptions: PresetOption[];
  openSource: (item: LibraryItem) => void;
  onError: (message: string) => void;
}) {
  const absolutePath = absoluteLibraryPath(outputRoot, item.primaryPath);
  const savedLabel = formatSavedAt(item.savedAt);
  const sizeLabel = formatBytes(item.totalSize);
  const metaParts = [
    presetLabel(item.preset, presetOptions),
    shortUrl(item.url),
    item.fileCount > 1 ? `${item.fileCount} files` : null,
    sizeLabel,
    savedLabel,
  ].filter(Boolean);

  async function openFile() {
    if (!desktop) return;
    try {
      await desktop.openPath(absolutePath);
    } catch {
      onError(`Couldn't open "${item.title}" — the file may have moved.`);
    }
  }

  async function revealFile() {
    if (!desktop) return;
    try {
      await desktop.showItemInFolder(absolutePath);
    } catch {
      onError(`Couldn't reveal "${item.title}" — the file may have moved.`);
    }
  }

  return (
    <article className="library-tile queue-tile done">
      <button type="button" className="tile-media library-tile-media" onClick={() => void openFile()} title="Open file">
        <LibraryThumbnail desktop={desktop} absolutePath={absolutePath} kind={item.kind} alt={item.title} />
        <div className="tile-actions">
          <button type="button" className="tile-action-btn" onClick={(event) => { event.stopPropagation(); openSource(item); }} title="Open source link" aria-label="Open source link">
            <Link2 size={13} strokeWidth={2} aria-hidden />
          </button>
          <button type="button" className="tile-action-btn" onClick={(event) => { event.stopPropagation(); void revealFile(); }} title="Show in Finder" aria-label="Show in Finder">
            <FolderOpen size={13} strokeWidth={2} aria-hidden />
          </button>
          <button type="button" className="tile-action-btn" onClick={(event) => { event.stopPropagation(); void openFile(); }} title="Open file" aria-label="Open file">
            <ExternalLink size={13} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </button>

      <div className="tile-body">
        <h3 className="tile-title">{item.title}</h3>
        <p className="tile-meta">{metaParts.join(" · ")}</p>
        <p className="tile-file" title={item.primaryPath}>
          <FolderOpen size={10} strokeWidth={2} aria-hidden />
          {fileBasename(item.primaryPath)}
        </p>
      </div>
    </article>
  );
}
