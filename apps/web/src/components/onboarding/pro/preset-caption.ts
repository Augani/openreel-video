import type { PresetDiff } from "../../../services/keyboard-shortcuts";

/** The keymap chips of the Pro row, in display order. `id` is a keyboard-shortcuts preset id. */
export const KEYMAP_CHOICES = [
  { id: "openreel", label: "OpenReel", short: "OpenReel" },
  { id: "premiere", label: "Premiere", short: "Premiere" },
  { id: "davinci", label: "Resolve", short: "Resolve" },
  { id: "finalcut", label: "Final Cut", short: "Final Cut" },
  { id: "capcut", label: "CapCut", short: "CapCut" },
] as const;

export type KeymapId = (typeof KEYMAP_CHOICES)[number]["id"];

export function keymapShortName(presetId: string): string {
  return KEYMAP_CHOICES.find((c) => c.id === presetId)?.short ?? presetId;
}

/**
 * Honest one-line summary of a preset, computed from the live diff. It always carries the count, so it can
 * never claim "Premiere keys" without saying how many keys actually change.
 */
export function describePresetDiff(diff: PresetDiff): string {
  const name = keymapShortName(diff.presetId);
  if (diff.count === 0) {
    return diff.presetId === "openreel"
      ? "OpenReel defaults. No keys are remapped."
      : `${name}-style: 0 keys changed. OpenReel's own keys already match.`;
  }
  const noun = diff.count === 1 ? "key" : "keys";
  const base = `${name}-style: ${diff.count} ${noun} changed.`;
  return diff.searchPaletteMoved ? `${base} Search moves to ${diff.searchPaletteLabel}.` : base;
}
