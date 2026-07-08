// Rust port of apps/desktop/electron/pathGuard.ts.
//
// Lexical (path-only) containment guard. Resolves `target` and each candidate
// root, then checks whether the resolved target lies inside (or is equal to)
// at least one root. This does NOT touch the filesystem and does NOT follow
// symlinks — callers that need symlink-proof guarantees must layer a
// `canonicalize` check on top (the Python listing layer already does).

use std::path::{Path, PathBuf};

/// Resolves a path the way Node's `path.resolve` does: relative to the
/// current working directory, collapsing `.`/`..` segments lexically without
/// touching the filesystem.
fn lexical_resolve(target: &Path) -> PathBuf {
    let absolute = if target.is_absolute() {
        target.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(target)
    };

    let mut out: Vec<std::ffi::OsString> = Vec::new();
    for component in absolute.components() {
        use std::path::Component::*;
        match component {
            Prefix(p) => out.push(p.as_os_str().to_os_string()),
            RootDir => out.push(component.as_os_str().to_os_string()),
            CurDir => {}
            ParentDir => {
                // Never pop past root/prefix components.
                if out.len() > 1 {
                    out.pop();
                }
            }
            Normal(part) => out.push(part.to_os_string()),
        }
    }
    out.into_iter().collect()
}

/// Returns the resolved absolute target path when contained in at least one
/// root, otherwise `None`. A target that resolves to exactly a root is
/// considered contained.
pub fn resolve_within_roots(target: &str, roots: &[String]) -> Option<PathBuf> {
    if target.is_empty() {
        return None;
    }
    let resolved_target = lexical_resolve(Path::new(target));

    for root in roots {
        if root.is_empty() {
            continue;
        }
        let resolved_root = lexical_resolve(Path::new(root));

        if resolved_target == resolved_root {
            return Some(resolved_target);
        }

        if let Ok(rel) = resolved_target.strip_prefix(&resolved_root) {
            // strip_prefix succeeding means resolved_target is lexically under
            // resolved_root (component-wise, so "/a/library" is never treated
            // as under "/a/lib" — the classic prefix bug is defeated by
            // component comparison rather than string prefix).
            let _ = rel;
            return Some(resolved_target);
        }
    }

    None
}

/// Like [`resolve_within_roots`] but returns an error message when the target
/// is outside every root. Intended for command handlers where rejecting the
/// call surfaces the error to the renderer client.
pub fn assert_within_roots(target: &str, roots: &[String]) -> Result<PathBuf, String> {
    resolve_within_roots(target, roots)
        .ok_or_else(|| "Refusing to access a path outside the library.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Build a platform-native absolute path from a POSIX-ish spec so these tests
    // exercise the guard with REAL inputs on each OS. On Windows a leading-slash
    // path is not absolute (no drive prefix), so we anchor it to `C:`.
    fn abs(posix: &str) -> String {
        #[cfg(windows)]
        {
            format!("C:{}", posix.replace('/', "\\"))
        }
        #[cfg(not(windows))]
        {
            posix.to_string()
        }
    }

    fn absp(posix: &str) -> PathBuf {
        PathBuf::from(abs(posix))
    }

    fn root() -> String {
        abs("/a/lib")
    }

    #[test]
    fn accepts_a_file_directly_inside_root() {
        assert_eq!(
            resolve_within_roots(&abs("/a/lib/video.mp4"), &[root()]),
            Some(absp("/a/lib/video.mp4"))
        );
    }

    #[test]
    fn accepts_a_file_in_a_nested_subdir() {
        assert_eq!(
            resolve_within_roots(&abs("/a/lib/.rippo-private/2024/clip.mov"), &[root()]),
            Some(absp("/a/lib/.rippo-private/2024/clip.mov"))
        );
    }

    #[test]
    fn accepts_the_root_itself() {
        assert_eq!(resolve_within_roots(&abs("/a/lib"), &[root()]), Some(absp("/a/lib")));
        // Trailing slash / dot segments normalize to the root too.
        assert_eq!(resolve_within_roots(&abs("/a/lib/"), &[root()]), Some(absp("/a/lib")));
        assert_eq!(
            resolve_within_roots(&abs("/a/lib/./sub/.."), &[root()]),
            Some(absp("/a/lib"))
        );
    }

    #[test]
    fn rejects_an_absolute_path_outside_the_root() {
        assert_eq!(resolve_within_roots(&abs("/etc/passwd"), &[root()]), None);
    }

    #[test]
    fn rejects_parent_traversal_out_of_the_root() {
        assert_eq!(resolve_within_roots(&abs("/a/lib/../secret"), &[root()]), None);
        assert_eq!(resolve_within_roots(&abs("/a/lib/sub/../../secret"), &[root()]), None);
    }

    #[test]
    fn rejects_a_sibling_dir_sharing_a_name_prefix() {
        // The classic bug: naive string prefix would wrongly accept "/a/library".
        assert_eq!(resolve_within_roots(&abs("/a/library/x"), &[root()]), None);
        assert_eq!(resolve_within_roots(&abs("/a/lib-extra/x"), &[root()]), None);
    }

    #[test]
    fn accepts_when_contained_in_at_least_one_of_several_roots() {
        let other = abs("/b/other");
        assert_eq!(
            resolve_within_roots(&abs("/b/other/file.png"), &[root(), other]),
            Some(absp("/b/other/file.png"))
        );
    }

    #[test]
    fn assert_within_roots_returns_the_resolved_path_when_contained() {
        assert_eq!(
            assert_within_roots(&abs("/a/lib/x.png"), &[root()]),
            Ok(absp("/a/lib/x.png"))
        );
    }

    #[test]
    fn assert_within_roots_errors_when_outside() {
        assert_eq!(
            assert_within_roots(&abs("/etc/passwd"), &[root()]),
            Err("Refusing to access a path outside the library.".to_string())
        );
    }
}
