import { File, FileAudio2, FileImage, FileText, FileVideo2, ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LibraryItem } from "../../electron/types";
import type { DesktopClient } from "../client/desktopClient";

export function libraryKindIcon(kind: LibraryItem["kind"]) {
  if (kind === "video") return FileVideo2;
  if (kind === "audio") return FileAudio2;
  if (kind === "image") return FileImage;
  if (kind === "document") return FileText;
  return File;
}

// Kinds that almost never have a usable thumbnail on disk — skip the fetch and
// show the kind icon straight away.
const NON_THUMBNAIL_KINDS = new Set<LibraryItem["kind"]>(["audio", "file"]);

type LoadState = "idle" | "loading" | "loaded" | "failed";

export function LibraryThumbnail({
  desktop,
  absolutePath,
  kind,
  alt,
}: {
  desktop: DesktopClient | null;
  absolutePath: string;
  kind: LibraryItem["kind"];
  alt: string;
}) {
  const frameRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("idle");

  const skipThumbnail = NON_THUMBNAIL_KINDS.has(kind) || !desktop;
  const Icon = libraryKindIcon(kind);

  // Observe the frame and flip `visible` the first time it scrolls into view.
  useEffect(() => {
    if (skipThumbnail) return;
    const node = frameRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [skipThumbnail]);

  // Fetch the thumbnail once the frame is visible. Guard against unmount and
  // only fetch a given path a single time.
  useEffect(() => {
    if (skipThumbnail || !visible || !desktop) return;
    let cancelled = false;
    setState("loading");
    desktop
      .loadLibraryThumbnail(absolutePath)
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.dataUrl) {
          setDataUrl(result.dataUrl);
          setState("loaded");
        } else {
          setState("failed");
        }
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [absolutePath, desktop, skipThumbnail, visible]);

  // Successfully loaded a real thumbnail.
  if (state === "loaded" && dataUrl) {
    return (
      <span ref={frameRef} className="library-thumb-frame">
        <img className="library-thumb-image" src={dataUrl} alt={alt} loading="lazy" />
      </span>
    );
  }

  // Loading: subtle shimmer placeholder.
  if (state === "loading") {
    return (
      <span ref={frameRef} className={`library-kind library-kind-${kind} is-loading`} aria-hidden>
        <span className="library-thumb-shimmer" />
      </span>
    );
  }

  // Failed for an image (we expected a thumbnail) — show the "no image" glyph.
  const Glyph = state === "failed" && kind === "image" ? ImageOff : Icon;

  return (
    <span ref={frameRef} className={`library-kind library-kind-${kind}`} aria-hidden>
      <Glyph size={28} strokeWidth={1.5} />
    </span>
  );
}
