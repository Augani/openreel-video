/**
 * Timeline anchoring for clip-level modulated effects (chorus, flanger, phaser).
 *
 * The LFO of those effects is a function of TIMELINE time, so the live clip chain (which starts at an arbitrary
 * context time, possibly mid-clip) and the offline export (a per-clip buffer that starts at context time 0) modulate in
 * phase. Both chains sit AFTER the speed change: their input is already at timeline rate, in timeline order (reversed
 * clips are reversed before the chain), so speed, stretch and reverse never change the clock; only where the chain's
 * first sample lies on the timeline does.
 */
import type { Effect } from "../types/timeline";
import { isCreativeFxType, type CreativeFxType } from "./creative/creative-fx-definitions";

const MODULATED: ReadonlySet<CreativeFxType> = new Set<CreativeFxType>(["chorus", "flanger", "phaser"]);

/** True when any enabled effect has an LFO (its phase is only right when timeline-anchored). */
export function hasModulatedCreativeFx(effects: readonly Pick<Effect, "type" | "enabled">[]): boolean {
  return effects.some((effect) => effect.enabled && isCreativeFxType(effect.type) && MODULATED.has(effect.type));
}

/**
 * Live preview: seconds to add to context time to get timeline time at a clip's chain input.
 * `clipOffset` is how far into the clip (timeline seconds) the source starts, `sourceStartTime` the context time it starts.
 */
export function previewClipChainClockOffset(scheduleStartTime: number, clipOffset: number, sourceStartTime: number): number {
  return scheduleStartTime + clipOffset - sourceStartTime;
}

/** Offline export: the chain's buffer plays from context 0, so the offset is the timeline time of its first sample. */
export function offlineClipChainClockOffset(timelineStartTime: number): number {
  return timelineStartTime;
}

/**
 * Resamples a source-domain excerpt to timeline rate (linear interpolation, `speed` source samples per output sample)
 * so effects run on the signal the listener hears, as the live chain (which sits after `playbackRate`) does.
 */
export function resampleToTimelineRate(channels: readonly Float32Array[], speed: number): Float32Array[] {
  const ratio = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return channels.map((data) => {
    const length = Math.max(1, Math.floor(data.length / ratio));
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const position = i * ratio;
      const index = Math.floor(position);
      const fraction = position - index;
      const a = data[index] ?? 0;
      const b = data[index + 1] ?? a;
      out[i] = a + (b - a) * fraction;
    }
    return out;
  });
}
