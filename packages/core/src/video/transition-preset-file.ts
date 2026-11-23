import { createTransitionPreset, type TransitionPreset } from "./transition-presets";

/**
 * The small JSON file the app-wide transition preset library is exported to and imported from. It holds only what a
 * preset is (name, type, duration, parameters), so a file shared between people or machines carries no ids or
 * project data. Entries this build does not understand (a transition type from a newer version) are skipped and
 * reported, the rest still import.
 */
export const TRANSITION_PRESET_FILE_FORMAT = "openreel-transition-presets";
export const TRANSITION_PRESET_FILE_VERSION = 1;
export const MAX_TRANSITION_PRESET_FILE_BYTES = 2_000_000;
export const MAX_TRANSITION_PRESETS = 500;

export interface TransitionPresetFile {
  readonly format: typeof TRANSITION_PRESET_FILE_FORMAT;
  readonly version: typeof TRANSITION_PRESET_FILE_VERSION;
  readonly presets: readonly { readonly name: string; readonly type: string; readonly duration: number; readonly params: Record<string, unknown> }[];
}

export function serializeTransitionPresets(presets: readonly TransitionPreset[]): string {
  const file: TransitionPresetFile = {
    format: TRANSITION_PRESET_FILE_FORMAT,
    version: TRANSITION_PRESET_FILE_VERSION,
    presets: presets.map(({ name, type, duration, params }) => ({ name, type, duration, params })),
  };
  return JSON.stringify(file, null, 2);
}

/** `name`, or `name (2)`, `name (3)` ... when the name is already taken (case-insensitive). */
export function uniquePresetName(name: string, taken: ReadonlySet<string>): string {
  const base = name.trim().slice(0, 74);
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export interface ParsedTransitionPresets {
  readonly presets: TransitionPreset[];
  readonly skipped: { readonly name: string; readonly reason: string }[];
  /** Set when the file as a whole is not a preset file. */
  readonly error?: string;
}

export function parseTransitionPresetFile(
  text: string,
  makeId: () => string,
  existingNames: Iterable<string> = [],
  now: number = Date.now(),
): ParsedTransitionPresets {
  const fail = (error: string): ParsedTransitionPresets => ({ presets: [], skipped: [], error });
  if (typeof text !== "string" || text.length === 0) return fail("The file is empty");
  if (text.length > MAX_TRANSITION_PRESET_FILE_BYTES) return fail("The file is too large to be a preset file");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail("The file is not valid JSON");
  }
  const file = data as Partial<TransitionPresetFile> | null;
  if (!file || typeof file !== "object" || file.format !== TRANSITION_PRESET_FILE_FORMAT) return fail("This is not an OpenReel transition preset file");
  if (typeof file.version !== "number" || file.version > TRANSITION_PRESET_FILE_VERSION) {
    return fail("This preset file was made by a newer version of OpenReel");
  }
  if (!Array.isArray(file.presets)) return fail("The file has no presets");
  const taken = new Set([...existingNames].map((name) => name.toLowerCase()));
  const presets: TransitionPreset[] = [];
  const skipped: { name: string; reason: string }[] = [];
  file.presets.slice(0, MAX_TRANSITION_PRESETS).forEach((entry: unknown, index) => {
    const e = entry as { name?: unknown; type?: unknown; duration?: unknown; params?: unknown } | null;
    const label = typeof e?.name === "string" && e.name.trim() ? e.name : `Preset ${index + 1}`;
    if (!e || typeof e !== "object" || typeof e.name !== "string" || typeof e.type !== "string" || typeof e.duration !== "number") {
      skipped.push({ name: label, reason: "Not a preset" });
      return;
    }
    const name = uniquePresetName(e.name, taken);
    const created = createTransitionPreset({ id: makeId(), name, type: e.type, duration: e.duration, params: e.params ?? {}, createdAt: now + index });
    if (!created.ok) {
      skipped.push({ name: label, reason: created.error });
      return;
    }
    taken.add(created.value.name.toLowerCase());
    presets.push(created.value);
  });
  if (file.presets.length > MAX_TRANSITION_PRESETS) skipped.push({ name: "Remaining presets", reason: `Only the first ${MAX_TRANSITION_PRESETS} presets are imported` });
  return { presets, skipped };
}
