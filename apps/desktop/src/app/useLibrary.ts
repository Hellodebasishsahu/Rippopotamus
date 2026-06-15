import { useCallback, useEffect, useState } from "react";
import type { LibraryItem, PresetOption } from "../../electron/types";
import type { DesktopClient } from "../client/desktopClient";

export function presetLabel(presetId: string, presetOptions: PresetOption[]): string {
  return presetOptions.find((preset) => preset.id === presetId)?.label || presetId;
}

export function formatBytes(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatSavedAt(savedAt: number | null | undefined): string | null {
  if (savedAt == null || !Number.isFinite(savedAt) || savedAt <= 0) return null;
  const date = new Date(savedAt * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function absoluteLibraryPath(outputRoot: string, relativePath: string): string {
  const separator = outputRoot.includes("\\") && !outputRoot.includes("/") ? "\\" : "/";
  return `${outputRoot.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(/^[/\\]+/, "").replace(/\//g, separator)}`;
}

export function useLibrary({
  desktop,
  outputRoot,
  refreshKey = 0,
  onLoadingChange,
}: {
  desktop: DesktopClient | null;
  outputRoot: string;
  refreshKey?: number;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLoadingState = useCallback((next: boolean) => {
    setLoading(next);
    onLoadingChange?.(next);
  }, [onLoadingChange]);

  const refresh = useCallback(async () => {
    if (!desktop || !outputRoot.trim()) {
      setItems([]);
      setError(null);
      return;
    }
    setLoadingState(true);
    setError(null);
    try {
      const result = await desktop.listLibrary({ outputRoot });
      if (!result.ok) {
        setItems([]);
        setError(result.error || "Could not load library.");
        return;
      }
      setItems(result.items || []);
    } catch (caught) {
      setItems([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingState(false);
    }
  }, [desktop, outputRoot, setLoadingState]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return {
    items,
    loading,
    error,
    refresh,
  };
}
