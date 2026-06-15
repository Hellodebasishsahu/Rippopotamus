import { ExternalLink, File, FileAudio2, FileImage, FileText, FileVideo2, FolderOpen, Link2 } from "lucide-react";
import type { LibraryItem, PresetOption } from "../../electron/types";
import { absoluteLibraryPath, formatBytes, formatSavedAt, presetLabel } from "../app/useLibrary";
import type { DesktopClient } from "../client/desktopClient";

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

function kindIcon(kind: LibraryItem["kind"]) {
  if (kind === "video") return FileVideo2;
  if (kind === "audio") return FileAudio2;
  if (kind === "image") return FileImage;
  if (kind === "document") return FileText;
  return File;
}

export function LibraryCard({
  item,
  outputRoot,
  desktop,
  presetOptions,
  openSource,
}: {
  item: LibraryItem;
  outputRoot: string;
  desktop: DesktopClient | null;
  presetOptions: PresetOption[];
  openSource: (item: LibraryItem) => void;
}) {
  const Icon = kindIcon(item.kind);
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
    await desktop.openPath(absolutePath).catch(() => undefined);
  }

  async function revealFile() {
    if (!desktop) return;
    await desktop.showItemInFolder(absolutePath).catch(() => undefined);
  }

  return (
    <article className="library-tile queue-tile done">
      <button type="button" className="tile-media library-tile-media" onClick={() => void openFile()} title="Open file">
        <span className={`library-kind library-kind-${item.kind}`} aria-hidden>
          <Icon size={28} strokeWidth={1.5} />
        </span>
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
