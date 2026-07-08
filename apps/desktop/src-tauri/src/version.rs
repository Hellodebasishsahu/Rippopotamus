// Rust port of apps/desktop/electron/versionUtils.ts. Shared by helpers.rs
// (yt-dlp/gallery-dl updates) and app_update.rs (app self-update) — both
// compare dotted/dashed version strings the same way.

pub fn normalize_version(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    let stripped = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    if stripped.is_empty() {
        None
    } else {
        Some(stripped.to_string())
    }
}

fn parts(value: &str) -> Vec<i64> {
    normalize_version(Some(value))
        .map(|v| v.split(['.', '-']).map(|part| part.parse::<i64>().unwrap_or(0)).collect())
        .unwrap_or_default()
}

pub fn compare_versions(left: &str, right: &str) -> i32 {
    let left_parts = parts(left);
    let right_parts = parts(right);
    let len = left_parts.len().max(right_parts.len());
    for i in 0..len {
        let a = left_parts.get(i).copied().unwrap_or(0);
        let b = right_parts.get(i).copied().unwrap_or(0);
        if a != b {
            return if a > b { 1 } else { -1 };
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_v_prefix() {
        assert_eq!(normalize_version(Some("v1.2.3")), Some("1.2.3".to_string()));
        assert_eq!(normalize_version(Some("1.2.3")), Some("1.2.3".to_string()));
        assert_eq!(normalize_version(None), None);
        assert_eq!(normalize_version(Some("")), None);
    }

    #[test]
    fn compares_dotted_versions() {
        assert_eq!(compare_versions("1.2.3", "1.2.4"), -1);
        assert_eq!(compare_versions("1.3.0", "1.2.9"), 1);
        assert_eq!(compare_versions("1.2.3", "1.2.3"), 0);
        assert_eq!(compare_versions("2024.01.01", "2023.12.31"), 1);
    }
}
