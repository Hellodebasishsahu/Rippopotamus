import type { PresetOption, ProviderId, ProviderOption } from "../../electron/types";

export const PREFERRED_PRESETS_STORAGE_KEY = "rippo:queue:preferredPresets";

export function readPreferredPresets(): Partial<Record<ProviderId, string>> {
  try {
    const raw = localStorage.getItem(PREFERRED_PRESETS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Partial<Record<ProviderId, string>>;
  } catch {
    return {};
  }
}

export function writePreferredPresets(map: Partial<Record<ProviderId, string>>) {
  try {
    localStorage.setItem(PREFERRED_PRESETS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    undefined;
  }
}

function catalogDefaultPreset(provider: ProviderId, providers: ProviderOption[]): string {
  return providers.find((option) => option.id === provider)?.defaultPreset || providers[0]?.defaultPreset || "";
}

export function defaultPresetForProvider(provider: ProviderId, providers: ProviderOption[]): string {
  return catalogDefaultPreset(provider, providers);
}

/** Valid preset id for provider, or catalog default. */
export function preferredPresetForProvider(
  provider: ProviderId,
  presets: PresetOption[],
  providers: ProviderOption[],
  preferred: Partial<Record<ProviderId, string>>,
): string {
  const fallback = catalogDefaultPreset(provider, providers);
  const wanted = preferred[provider];
  if (wanted && presets.some((p) => p.id === wanted && p.provider === provider)) return wanted;
  return fallback;
}

export function presetsForProvider(provider: ProviderId, presets: PresetOption[]): PresetOption[] {
  return presets.filter((p) => p.provider === provider);
}
