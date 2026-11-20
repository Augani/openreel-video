/**
 * Spectral repair regions: the data model stored in a clip's "spectralRepair" audio effect.
 *
 * Regions live in SOURCE time (seconds of the decoded media), not clip time, so trimming, moving,
 * retiming or reversing the clip never shifts an edit off the sound it was painted on. This module
 * is deliberately free of DSP so the realtime graph and the export engine can import it cheaply.
 */
import type { Effect } from "../../types/timeline";

export const SPECTRAL_REPAIR_EFFECT_TYPE = "spectralRepair";
export const MAX_SPECTRAL_REGIONS = 256;
/** Deepest attenuation a region can ask for (below this "remove" is the right tool). */
export const MIN_SPECTRAL_ATTENUATION_DB = -120;
export const DEFAULT_SPECTRAL_ATTENUATION_DB = -12;
const MAX_REGION_HZ = 192000;
const MIN_REGION_SECONDS = 1e-4;

export type SpectralRegionMode = "attenuate" | "remove";

export interface SpectralRegion {
  readonly id: string;
  /** attenuate: scale the selection by `gainDb`. remove: replace it by interpolating the surrounding frames/bins. */
  readonly mode: SpectralRegionMode;
  /** Source-time bounds in seconds. A frequency-band marquee spans the whole source. */
  readonly startTime: number;
  readonly endTime: number;
  readonly lowHz: number;
  readonly highHz: number;
  /** Attenuate only: gain in dB, <= 0 (a "12 dB cut" is -12). Unused (stored as the minimum) for remove. */
  readonly gainDb: number;
  readonly enabled: boolean;
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Normalises untrusted input (saved project, agent call, UI); invalid entries are dropped. */
export function sanitizeSpectralRegions(raw: unknown): SpectralRegion[] {
  if (!Array.isArray(raw)) return [];
  const out: SpectralRegion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_SPECTRAL_REGIONS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const mode: SpectralRegionMode | null = r.mode === "remove" ? "remove" : r.mode === "attenuate" ? "attenuate" : null;
    const t0 = finite(r.startTime);
    const t1 = finite(r.endTime);
    const f0 = finite(r.lowHz);
    const f1 = finite(r.highHz);
    if (!mode || t0 === null || t1 === null || f0 === null || f1 === null) continue;
    const startTime = Math.max(0, Math.min(t0, t1));
    const endTime = Math.max(0, Math.max(t0, t1));
    const lowHz = Math.max(0, Math.min(f0, f1));
    const highHz = Math.min(MAX_REGION_HZ, Math.max(f0, f1));
    if (endTime - startTime < MIN_REGION_SECONDS || highHz - lowHz <= 0) continue;
    const gain = finite(r.gainDb);
    const gainDb =
      mode === "attenuate"
        ? Math.max(MIN_SPECTRAL_ATTENUATION_DB, Math.min(0, gain ?? DEFAULT_SPECTRAL_ATTENUATION_DB))
        : MIN_SPECTRAL_ATTENUATION_DB;
    let id = typeof r.id === "string" && r.id ? r.id : `region-${out.length + 1}`;
    while (seen.has(id)) id = `${id}-x`;
    seen.add(id);
    out.push({ id, mode, startTime, endTime, lowHz, highHz, gainDb, enabled: r.enabled !== false });
  }
  return out;
}

/** The regions that actually process audio (enabled), in order. */
export const activeSpectralRegions = (regions: readonly SpectralRegion[]): SpectralRegion[] => regions.filter((region) => region.enabled);

/** Stable cache key of what the regions do to the audio ("" when nothing is processed). Ids and the enabled flag of off regions do not matter. */
export function spectralRegionsKey(regions: readonly SpectralRegion[]): string {
  return activeSpectralRegions(regions)
    .map((r) => `${r.mode[0]}${r.startTime.toFixed(5)},${r.endTime.toFixed(5)},${r.lowHz.toFixed(2)},${r.highHz.toFixed(2)},${r.gainDb.toFixed(3)}`)
    .join(";");
}

interface EffectLike {
  readonly type: string;
  readonly enabled?: boolean;
  readonly params?: Readonly<Record<string, unknown>>;
}

export const isSpectralRepairEffect = (effect: Pick<Effect, "type">): boolean => effect.type === SPECTRAL_REPAIR_EFFECT_TYPE;

/** Active regions of every enabled "spectralRepair" effect in a clip's chain, concatenated in chain order. */
export function getSpectralRepairRegions(effects: readonly EffectLike[] | undefined): SpectralRegion[] {
  const out: SpectralRegion[] = [];
  for (const effect of effects ?? []) {
    if (effect.type !== SPECTRAL_REPAIR_EFFECT_TYPE || effect.enabled === false) continue;
    out.push(...activeSpectralRegions(sanitizeSpectralRegions(effect.params?.regions)));
  }
  return out;
}

export const hasSpectralRepair = (effects: readonly EffectLike[] | undefined): boolean => getSpectralRepairRegions(effects).length > 0;

/** Builds the effect that carries a region list (one per clip; edits replace its `regions`). */
export function createSpectralRepairEffect(id: string, regions: readonly SpectralRegion[] = []): Effect {
  return { id, type: SPECTRAL_REPAIR_EFFECT_TYPE, enabled: true, params: { regions: sanitizeSpectralRegions(regions) } };
}

let regionCounter = 0;
/** A fresh region id (unique within a session; collisions inside one clip are repaired by sanitize). */
export const newSpectralRegionId = (): string => `sr-${Date.now().toString(36)}-${(regionCounter++).toString(36)}`;
