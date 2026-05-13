import { useEffect, useState } from "react";
import type { IndexIngestLimits, IndexIngestSettings } from "../../../electron/types";
import type { DesktopClient } from "../client/desktopClient";

export const DEFAULT_INDEX_INGEST_LIMITS: IndexIngestLimits = {
  provider: "gemini",
  label: "Gemini Embedding 2",
  model: "gemini-embedding-2",
  videoSeconds: 120,
  recommendedDimensions: [768, 1536, 3072],
  chunkDuration: { min: 5, max: 120, step: 5, default: 30 },
  overlap: { min: 0, max: 29, step: 1, default: 5 },
  targetResolution: { min: 144, max: 1080, step: 16, default: 480 },
  targetFps: { min: 1, max: 15, step: 1, default: 5 },
};

export const DEFAULT_INDEX_INGEST_SETTINGS: IndexIngestSettings = {
  provider: "gemini",
  chunkDuration: 30,
  overlap: 5,
  preprocess: true,
  skipStill: true,
  targetResolution: 480,
  targetFps: 5,
};

const GEMINI_VIDEO_EMBED_USD_PER_FRAME = 0.00079;
const USD_TO_INR_ESTIMATE = 94.4;

export const INGEST_PRESETS: Array<{
  id: string;
  name: string;
  description: string;
  settings: Pick<IndexIngestSettings, "chunkDuration" | "overlap" | "targetResolution" | "targetFps" | "preprocess" | "skipStill">;
}> = [
  {
    id: "quick",
    name: "Quick scan",
    description: "Good for rough search across lots of footage.",
    settings: { chunkDuration: 60, overlap: 5, targetResolution: 360, targetFps: 3, preprocess: true, skipStill: true },
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Best default for normal clips and saved downloads.",
    settings: { chunkDuration: 30, overlap: 5, targetResolution: 480, targetFps: 5, preprocess: true, skipStill: true },
  },
  {
    id: "detail",
    name: "Detail search",
    description: "Better for faces, signs, text, and small objects.",
    settings: { chunkDuration: 15, overlap: 5, targetResolution: 720, targetFps: 8, preprocess: true, skipStill: true },
  },
  {
    id: "motion",
    name: "Fast action",
    description: "Use when quick cuts or gestures matter.",
    settings: { chunkDuration: 10, overlap: 4, targetResolution: 720, targetFps: 12, preprocess: true, skipStill: false },
  },
];

type UseIndexIngestSettingsOptions = {
  desktop: DesktopClient | null;
  consumerErrorMessage: (message: string, fallback?: string) => string;
};

export function estimateIngestCostPerHour(settings: Pick<IndexIngestSettings, "chunkDuration" | "overlap" | "targetFps">): number {
  const step = Math.max(1, settings.chunkDuration - settings.overlap);
  const overlapMultiplier = settings.chunkDuration / step;
  return 3600 * settings.targetFps * GEMINI_VIDEO_EMBED_USD_PER_FRAME * overlapMultiplier;
}

export function formatCostPerHour(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  const inr = value * USD_TO_INR_ESTIMATE;
  if (inr >= 1000) return `~₹${(inr / 1000).toFixed(1)}k/hr`;
  if (inr < 100) return `~₹${Math.round(inr)}/hr`;
  return `~₹${Math.round(inr / 10) * 10}/hr`;
}

export function formatUsdPerHour(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return `$${value.toFixed(value >= 10 ? 0 : 2)}/hr`;
}

export function presetDetail(settings: Pick<IndexIngestSettings, "chunkDuration" | "overlap" | "targetResolution" | "targetFps">): string {
  return `${formatCostPerHour(estimateIngestCostPerHour(settings))} · ${settings.targetResolution}p/${settings.targetFps}fps`;
}

export function currentIngestPreset(settings: IndexIngestSettings): string {
  const match = INGEST_PRESETS.find((preset) => (
    preset.settings.chunkDuration === settings.chunkDuration &&
    preset.settings.overlap === settings.overlap &&
    preset.settings.targetResolution === settings.targetResolution &&
    preset.settings.targetFps === settings.targetFps &&
    preset.settings.preprocess === settings.preprocess &&
    preset.settings.skipStill === settings.skipStill
  ));
  return match?.id || "custom";
}

export function useIndexIngestSettings({ desktop, consumerErrorMessage }: UseIndexIngestSettingsOptions) {
  const [indexIngestSettings, setIndexIngestSettings] = useState<IndexIngestSettings>(DEFAULT_INDEX_INGEST_SETTINGS);
  const [indexIngestLimits, setIndexIngestLimits] = useState<IndexIngestLimits>(DEFAULT_INDEX_INGEST_LIMITS);
  const [indexSettingsStatus, setIndexSettingsStatus] = useState<"idle" | "saving">("idle");
  const [indexSettingsError, setIndexSettingsError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop || typeof desktop.getIndexIngestSettings !== "function") return;
    desktop.getIndexIngestSettings().then((result) => {
      setIndexIngestSettings({ ...DEFAULT_INDEX_INGEST_SETTINGS, ...result });
      setIndexIngestLimits(result.limits || DEFAULT_INDEX_INGEST_LIMITS);
    }).catch(() => undefined);
  }, [desktop]);

  async function saveIndexIngestSettings(patch: Partial<IndexIngestSettings>) {
    const optimistic = { ...indexIngestSettings, ...patch };
    setIndexIngestSettings(optimistic);
    if (!desktop || typeof desktop.setIndexIngestSettings !== "function") return;
    setIndexSettingsStatus("saving");
    setIndexSettingsError(null);
    try {
      const saved = await desktop.setIndexIngestSettings(patch);
      setIndexIngestSettings({ ...DEFAULT_INDEX_INGEST_SETTINGS, ...saved });
      setIndexIngestLimits(saved.limits || DEFAULT_INDEX_INGEST_LIMITS);
    } catch (error) {
      setIndexSettingsError(consumerErrorMessage(error instanceof Error ? error.message : String(error), "Could not save ingest settings."));
    } finally {
      setIndexSettingsStatus("idle");
    }
  }

  function chooseIngestPreset(presetId: string) {
    const preset = INGEST_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    void saveIndexIngestSettings(preset.settings);
  }

  return {
    indexIngestSettings,
    indexIngestLimits,
    indexSettingsStatus,
    indexSettingsError,
    saveIndexIngestSettings,
    chooseIngestPreset,
  };
}
