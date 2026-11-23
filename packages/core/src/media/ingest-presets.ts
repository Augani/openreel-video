import type { DesktopIngestConfig, DesktopProxyProfile, IngestPreset, Project } from "../types/project";
import { DEFAULT_DESKTOP_PROXY_PROFILE, isDesktopProxyProfile } from "./desktop-ingest";

/**
 * Named, user-editable proxy presets (Premiere's Ingest Settings presets). A preset is a name plus a full proxy
 * profile (codec, size, audio, burn-in, destination). The built-in presets cannot be edited or deleted, but they
 * can be duplicated. The user's own presets live in app settings (see apps/web/src/services/ingest-presets-store.ts);
 * a project stores a copy of the profile it uses, so it stays portable. Pure: no I/O.
 */

export interface ProxyPresetEntry {
  /** Stable id. Built-ins use fixed ids; user presets get `user-<random>`. */
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  readonly profile: DesktopProxyProfile;
}

export const MAX_USER_PRESETS = 50;
export const MAX_PRESET_NAME = 60;

const builtIn = (id: string, name: string, profile: DesktopProxyProfile): ProxyPresetEntry => ({ id, name, builtIn: true, profile });

/** Frame rate is always kept (no preset changes it), and audio is kept unless a preset says "strip". */
export const BUILTIN_INGEST_PRESETS: readonly ProxyPresetEntry[] = [
  builtIn("prores-proxy", "ProRes Proxy", { codec: "prores-proxy", size: "half" }),
  builtIn("prores-lt", "ProRes LT", { codec: "prores-lt", size: "half" }),
  builtIn("prores-422", "ProRes 422", { codec: "prores-422", size: "half" }),
  builtIn("h264-half", "H.264 1/2 resolution", { codec: "h264", size: "half" }),
  builtIn("h264-quarter", "H.264 1/4 resolution", { codec: "h264", size: "quarter" }),
  builtIn("h264-720-burn-in", "H.264 720p with burn-in", { codec: "h264", size: "720p", burnIn: { clipName: true, timecode: true } }),
  builtIn("dnxhr-lb", "DNxHR LB", { codec: "dnxhr-lb", size: "half" }),
  builtIn("dnxhr-sq", "DNxHR SQ", { codec: "dnxhr-sq", size: "half" }),
];

export const DEFAULT_INGEST_PRESET_ID = "h264-half";

const clean = (profile: DesktopProxyProfile): DesktopProxyProfile => {
  // Drop defaults so two ways of writing the same profile compare equal.
  const out: { -readonly [K in keyof DesktopProxyProfile]: DesktopProxyProfile[K] } = { codec: profile.codec, size: profile.size };
  if (profile.size === "custom" && profile.customWidth) out.customWidth = profile.customWidth;
  if (profile.audio === "strip") out.audio = "strip";
  const burn = { ...(profile.burnIn?.clipName ? { clipName: true } : {}), ...(profile.burnIn?.timecode ? { timecode: true } : {}) };
  if (Object.keys(burn).length) out.burnIn = burn;
  if (profile.destination && profile.destination.mode !== "project") out.destination = profile.destination.mode === "custom" ? { mode: "custom", folder: profile.destination.folder } : { mode: "media" };
  return out;
};

export const sameProxyProfile = (a: DesktopProxyProfile, b: DesktopProxyProfile): boolean => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

export const normalizeProxyProfile = clean;

/** Built-ins first, then the user's presets. */
export const allIngestPresets = (user: readonly ProxyPresetEntry[]): ProxyPresetEntry[] => [...BUILTIN_INGEST_PRESETS, ...user];

export function findIngestPreset(user: readonly ProxyPresetEntry[], id: string | undefined | null): ProxyPresetEntry | undefined {
  return id ? allIngestPresets(user).find((preset) => preset.id === id) : undefined;
}

/** The preset whose profile equals `profile` (a stored project profile), preferring the id the project remembers. */
export function presetMatchingProfile(user: readonly ProxyPresetEntry[], profile: DesktopProxyProfile, preferredId?: string): ProxyPresetEntry | undefined {
  const all = allIngestPresets(user);
  const preferred = preferredId ? all.find((preset) => preset.id === preferredId) : undefined;
  if (preferred && sameProxyProfile(preferred.profile, profile)) return preferred;
  return all.find((preset) => sameProxyProfile(preset.profile, profile));
}

export type PresetResult = { ok: true; presets: ProxyPresetEntry[]; preset: ProxyPresetEntry } | { ok: false; error: string };

export function validatePresetName(name: string, user: readonly ProxyPresetEntry[], exceptId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the preset a name.";
  if (trimmed.length > MAX_PRESET_NAME) return `Keep the name under ${MAX_PRESET_NAME} characters.`;
  const taken = allIngestPresets(user).some((preset) => preset.id !== exceptId && preset.name.toLowerCase() === trimmed.toLowerCase());
  return taken ? "A preset with that name already exists." : null;
}

let counter = 0;
const newId = (): string => `user-${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Create a user preset. `id` is injectable for tests. */
export function createIngestPreset(user: readonly ProxyPresetEntry[], name: string, profile: DesktopProxyProfile, id: string = newId()): PresetResult {
  const error = validatePresetName(name, user);
  if (error) return { ok: false, error };
  if (user.length >= MAX_USER_PRESETS) return { ok: false, error: `You can keep up to ${MAX_USER_PRESETS} presets.` };
  if (!isDesktopProxyProfile(profile)) return { ok: false, error: "That combination of settings is not valid." };
  const preset: ProxyPresetEntry = { id, name: name.trim(), builtIn: false, profile: clean(profile) };
  return { ok: true, presets: [...user, preset], preset };
}

/** Copy any preset (built-in or user) under a new name ("<name> copy" when none is given). */
export function duplicateIngestPreset(user: readonly ProxyPresetEntry[], sourceId: string, name?: string, id?: string): PresetResult {
  const source = findIngestPreset(user, sourceId);
  if (!source) return { ok: false, error: "That preset no longer exists." };
  let chosen = name?.trim();
  if (!chosen) {
    chosen = `${source.name} copy`;
    for (let n = 2; validatePresetName(chosen, user); n++) chosen = `${source.name} copy ${n}`;
  }
  return createIngestPreset(user, chosen, source.profile, id);
}

export function renameIngestPreset(user: readonly ProxyPresetEntry[], id: string, name: string): PresetResult {
  const target = user.find((preset) => preset.id === id);
  if (!target) return { ok: false, error: findIngestPreset(user, id)?.builtIn ? "Built-in presets cannot be renamed. Duplicate one instead." : "That preset no longer exists." };
  const error = validatePresetName(name, user, id);
  if (error) return { ok: false, error };
  const preset = { ...target, name: name.trim() };
  return { ok: true, presets: user.map((entry) => (entry.id === id ? preset : entry)), preset };
}

/** Replace a user preset's settings. */
export function updateIngestPresetProfile(user: readonly ProxyPresetEntry[], id: string, profile: DesktopProxyProfile): PresetResult {
  const target = user.find((preset) => preset.id === id);
  if (!target) return { ok: false, error: findIngestPreset(user, id)?.builtIn ? "Built-in presets cannot be edited. Duplicate one instead." : "That preset no longer exists." };
  if (!isDesktopProxyProfile(profile)) return { ok: false, error: "That combination of settings is not valid." };
  const preset = { ...target, profile: clean(profile) };
  return { ok: true, presets: user.map((entry) => (entry.id === id ? preset : entry)), preset };
}

export function deleteIngestPreset(user: readonly ProxyPresetEntry[], id: string): { ok: true; presets: ProxyPresetEntry[] } | { ok: false; error: string } {
  if (!user.some((preset) => preset.id === id)) return { ok: false, error: findIngestPreset(user, id)?.builtIn ? "Built-in presets cannot be deleted." : "That preset no longer exists." };
  return { ok: true, presets: user.filter((preset) => preset.id !== id) };
}

/** Persisted shape of the user's presets (app settings). */
export interface PersistedIngestPresets {
  readonly version: 1;
  readonly presets: ProxyPresetEntry[];
}

/** Read whatever was stored: bad entries, duplicate ids and ids that collide with a built-in are dropped, never thrown on. */
export function sanitizeUserPresets(raw: unknown): ProxyPresetEntry[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { presets?: unknown }).presets) ? (raw as { presets: unknown[] }).presets : [];
  const out: ProxyPresetEntry[] = [];
  const ids = new Set(BUILTIN_INGEST_PRESETS.map((preset) => preset.id));
  const names = new Set(BUILTIN_INGEST_PRESETS.map((preset) => preset.name.toLowerCase()));
  for (const entry of list) {
    if (out.length >= MAX_USER_PRESETS) break;
    if (!entry || typeof entry !== "object") continue;
    const { id, name, profile } = entry as { id?: unknown; name?: unknown; profile?: unknown };
    if (typeof id !== "string" || !id || id.length > 80 || ids.has(id)) continue;
    if (typeof name !== "string" || !name.trim() || name.trim().length > MAX_PRESET_NAME) continue;
    if (!isDesktopProxyProfile(profile)) continue;
    let unique = name.trim();
    for (let n = 2; names.has(unique.toLowerCase()); n++) unique = `${name.trim()} (${n})`;
    ids.add(id);
    names.add(unique.toLowerCase());
    out.push({ id, name: unique, builtIn: false, profile: clean(profile) });
  }
  return out;
}

export const serializeUserPresets = (presets: readonly ProxyPresetEntry[]): PersistedIngestPresets => ({ version: 1, presets: [...presets] });

// ---- The four ingest settings of Premiere's Ingest dialog --------------------------------------------

/** What import does with new media: nothing, copy, copy then build proxies, or build proxies only. */
export type IngestMode = "none" | "copy" | "copy-proxies" | "proxies";

export const INGEST_MODES: readonly { id: IngestMode; label: string; desktopOnly: boolean }[] = [
  { id: "none", label: "None", desktopOnly: false },
  { id: "copy", label: "Copy to destination", desktopOnly: true },
  { id: "copy-proxies", label: "Copy and create proxies", desktopOnly: true },
  { id: "proxies", label: "Create proxies", desktopOnly: false },
];

export function ingestModeOf(project: Pick<Project, "mediaLibrary">): IngestMode {
  const preset = project.mediaLibrary.ingestPreset ?? "none";
  if (preset === "copy") return project.mediaLibrary.desktopIngest?.proxiesWithCopy ? "copy-proxies" : "copy";
  return preset;
}

/** The project settings an ingest mode stands for: the stored preset, and the "proxies with copy" flag. */
export function ingestModeSettings(mode: IngestMode): { ingestPreset: IngestPreset; proxiesWithCopy: boolean } {
  if (mode === "copy") return { ingestPreset: "copy", proxiesWithCopy: false };
  if (mode === "copy-proxies") return { ingestPreset: "copy", proxiesWithCopy: true };
  return { ingestPreset: mode, proxiesWithCopy: false };
}

/** The profile a batch builds with: an explicit per-batch choice, else the project's, else the default. */
export function resolveBatchProfile(project: Pick<Project, "mediaLibrary">, batch?: DesktopProxyProfile | null): DesktopProxyProfile {
  return batch ?? (project.mediaLibrary.desktopIngest as DesktopIngestConfig | undefined)?.proxyProfile ?? DEFAULT_DESKTOP_PROXY_PROFILE;
}
