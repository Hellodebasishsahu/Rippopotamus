import type { IndexSearchResult } from "../../../electron/types";

export type LibraryPreviewKind = "video" | "audio" | "image" | null;
export type LibraryPlayerState = "closed" | "loading" | "missing" | "video" | "audio" | "image";

export function libraryPreviewKind(result: Pick<IndexSearchResult, "kind">): LibraryPreviewKind {
  if (result.kind === "video" || result.kind === "audio" || result.kind === "image") return result.kind;
  return null;
}

export function isLibraryResultPlayable(result: Pick<IndexSearchResult, "kind">): boolean {
  return libraryPreviewKind(result) !== null;
}

export function nextExpandedLibraryId(currentId: string | null, result: Pick<IndexSearchResult, "id" | "kind">): string | null {
  if (!isLibraryResultPlayable(result)) return currentId;
  return currentId === result.id ? null : result.id;
}

export function libraryPreviewStart(result: Pick<IndexSearchResult, "start">): number {
  return Number.isFinite(result.start) && (result.start ?? 0) > 0 ? result.start ?? 0 : 0;
}

export function libraryPlayerState(result: Pick<IndexSearchResult, "id" | "kind">, expandedId: string | null, mediaUrl: string | null | undefined): LibraryPlayerState {
  if (expandedId !== result.id) return "closed";
  const kind = libraryPreviewKind(result);
  if (!kind) return "closed";
  if (mediaUrl === undefined) return "loading";
  if (mediaUrl === null) return "missing";
  return kind;
}
