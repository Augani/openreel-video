/**
 * The OCIO choices a project stores (`project.settings.ocio`, used when `colorManagement` is "ocio"). The config text and
 * the LUT files travel inside the project so a project opens the same everywhere; nothing here needs the OCIO runtime,
 * which loads lazily when a frame is rendered.
 */

export interface OcioProjectSettings {
  /** File name of the loaded config, for display. */
  readonly configName: string;
  readonly configText: string;
  /** LUT files provided with the config: relative path (forward slashes) to the file's text. */
  readonly files: Readonly<Record<string, string>>;
  /** Scene-linear colour space the compositor blends in. */
  readonly workingSpace: string;
  /** What 8-bit graphics and footage without a per-clip choice are interpreted as. */
  readonly defaultInputSpace: string;
  readonly display: string;
  readonly view: string;
  /** OCIO looks applied before the view, in order; a leading "-" runs a look in reverse. */
  readonly looks?: readonly string[];
}

export const MAX_OCIO_CONFIG_CHARS = 8 * 1024 * 1024;
export const MAX_OCIO_FILE_CHARS = 32 * 1024 * 1024;
export const MAX_OCIO_FILES = 256;
export const MAX_OCIO_TOTAL_CHARS = 48 * 1024 * 1024;

function isStringRecord(v: unknown): v is Record<string, string> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}

/** Null when `value` is well-formed OCIO project settings, else the reason it is not. */
export function validateOcioSettings(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "OCIO settings must be an object.";
  const v = value as Record<string, unknown>;
  for (const key of ["configName", "configText", "workingSpace", "defaultInputSpace", "display", "view"] as const) {
    if (typeof v[key] !== "string") return `OCIO settings need a string "${key}".`;
  }
  if ((v.configText as string).length === 0) return "The OCIO config is empty.";
  if ((v.configText as string).length > MAX_OCIO_CONFIG_CHARS) return "The OCIO config is too large.";
  if (!isStringRecord(v.files)) return "OCIO files must map a path to its text.";
  const entries = Object.entries(v.files);
  if (entries.length > MAX_OCIO_FILES) return `At most ${MAX_OCIO_FILES} LUT files can be stored with a project.`;
  let total = (v.configText as string).length;
  for (const [path, text] of entries) {
    if (path.length === 0 || path.length > 512 || path.startsWith("/") || path.split("/").includes("..")) return `"${path}" is not a valid relative LUT path.`;
    if (text.length > MAX_OCIO_FILE_CHARS) return `The LUT file "${path}" is too large.`;
    total += text.length;
  }
  if (total > MAX_OCIO_TOTAL_CHARS) return "The OCIO config and LUT files together are too large to store in a project.";
  if (v.looks !== undefined && !(Array.isArray(v.looks) && v.looks.every((l) => typeof l === "string"))) return "OCIO looks must be a list of names.";
  return null;
}

/** A short stable key of everything that changes what the settings compute (cache keys, pipeline reuse). */
export function ocioSettingsKey(s: OcioProjectSettings): string {
  const cached = keyCache.get(s);
  if (cached) return cached;
  const key = computeKey(s);
  keyCache.set(s, key);
  return key;
}

const keyCache = new WeakMap<OcioProjectSettings, string>();

function computeKey(s: OcioProjectSettings): string {
  let h = 2166136261 >>> 0;
  const mix = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(s.configText);
  for (const path of Object.keys(s.files).sort()) {
    mix(path);
    mix(s.files[path]);
  }
  mix(s.workingSpace);
  mix(s.defaultInputSpace);
  mix(s.display);
  mix(s.view);
  mix((s.looks ?? []).join("\u0001"));
  return `ocio:${h.toString(36)}:${s.configText.length}`;
}

export function isOcioMode(settings: { readonly colorManagement?: string } | undefined): boolean {
  return settings?.colorManagement === "ocio";
}
