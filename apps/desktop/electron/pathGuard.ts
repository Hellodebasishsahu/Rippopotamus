import path from "node:path";

/**
 * Lexical (path-only) containment guard.
 *
 * Resolves `target` and each candidate root with `path.resolve`, then checks
 * whether the resolved target lies inside (or is equal to) at least one root.
 * Containment is decided purely from the path strings via `path.relative` — it
 * does NOT touch the filesystem and does NOT follow symlinks. It is therefore
 * safe to unit-test without disk, but callers that need symlink-proof guarantees
 * must layer a `realpath` check on top (the Python listing layer already does).
 *
 * Returns the resolved absolute target path when contained, otherwise `null`.
 * A target that resolves to exactly a root is considered contained.
 */
export function resolveWithinRoots(target: string, roots: string[]): string | null {
  if (typeof target !== "string" || !target) return null;

  const resolvedTarget = path.resolve(target);

  for (const root of roots) {
    if (typeof root !== "string" || !root) continue;
    const resolvedRoot = path.resolve(root);

    const rel = path.relative(resolvedRoot, resolvedTarget);

    // Empty relative path means target === root: allow (equal-to-root is inside).
    if (rel === "") return resolvedTarget;

    // Reject traversal (".." segments) and absolute relatives (different drive /
    // disjoint subtree). `path.relative` collapses sibling-prefix cases like
    // root "/a/lib" vs "/a/library/x" into a "../library/x" form, so the
    // startsWith("..") check also defeats the classic prefix bug.
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
      continue;
    }

    return resolvedTarget;
  }

  return null;
}

/**
 * Like {@link resolveWithinRoots} but throws when the target is outside every
 * root. Returns the resolved absolute path on success. Intended for IPC
 * handlers where rejecting the call surfaces the error to the renderer client.
 */
export function assertWithinRoots(target: string, roots: string[]): string {
  const resolved = resolveWithinRoots(target, roots);
  if (resolved === null) {
    throw new Error("Refusing to access a path outside the library.");
  }
  return resolved;
}
