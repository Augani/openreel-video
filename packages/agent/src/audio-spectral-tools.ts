import type { Clip } from "@openreel/core/types/timeline";
import {
  DEFAULT_SPECTRAL_ATTENUATION_DB,
  MAX_SPECTRAL_REGIONS,
  regionShape,
  sanitizeSpectralRegions,
  type SpectralRegion,
} from "@openreel/core/audio/spectral/spectral-regions";
import { clipSpectralRegions, planSpectralRegionsAction } from "@openreel/core/audio/spectral/spectral-edit";
import { adviseHeal } from "@openreel/core/audio/spectral/spectral-heal-advice";
import { clickRegion, findSpectralClicks, findSpectralTones, toneRegion } from "@openreel/core/audio/spectral/spectral-detect";
import { computeMagicWand, wandFailureMessage } from "@openreel/core/audio/spectral/spectral-wand";
import { findBoxSeed, trackHarmonics } from "@openreel/core/audio/spectral/spectral-harmonic";
import type { RegisteredTool } from "./registry";
import type { EditingHost } from "./host";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Spectral editing (Audio tab > Spectral editing) for agents: list, add, change and remove the regions of a clip's
 * "spectralRepair" effect, and find and heal steady tones and clicks. Regions are in SOURCE time (seconds of the
 * clip's media, not of the timeline), so trimming or moving the clip never shifts an edit off the sound. Every call
 * that changes regions is ONE undo step; the preview and the export play the same repaired samples.
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const bool: JSONSchema = { type: "boolean" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({ type: "object", properties, required, additionalProperties: true });
const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const MODES = ["attenuate", "remove", "heal"] as const;
const SHAPES = ["rect", "band", "lasso", "brush"] as const;
const points: JSONSchema = { type: "array", items: obj({ t: num, hz: num }, ["t", "hz"]) };
const CHANNELS = ["both", "left", "right"] as const;
const regionProps: Record<string, JSONSchema> = {
  mode: { type: "string", enum: [...MODES] },
  channel: { type: "string", enum: [...CHANNELS] },
  startTime: num,
  endTime: num,
  lowHz: num,
  highHz: num,
  points,
  brushSeconds: num,
  brushOctaves: num,
  gainDb: num,
  feather: num,
  enabled: bool,
};

const findClip = (host: EditingHost, clipId: string): Clip | undefined => {
  for (const track of host.getProject().timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
};

const sourceDuration = (host: EditingHost, clip: Clip): number => {
  const media = host.getProject().mediaLibrary.items.find((item) => item.id === clip.mediaId);
  return media?.metadata?.duration ?? Math.max(clip.outPoint ?? 0, (clip.inPoint ?? 0) + clip.duration);
};

const describe = (region: SpectralRegion): Record<string, unknown> => ({
  id: region.id,
  mode: region.mode,
  shape: regionShape(region),
  enabled: region.enabled,
  startTime: round(region.startTime),
  endTime: round(region.endTime),
  lowHz: round(region.lowHz),
  highHz: round(region.highHz),
  gainDb: region.mode === "attenuate" ? region.gainDb : undefined,
  feather: region.feather,
  points: region.shape === "harmonic" ? undefined : region.points,
  brushSeconds: region.brushSeconds,
  brushOctaves: region.brushOctaves,
  channel: region.channel ?? "both",
  wand: region.wand ? { seedTime: round(region.wand.seed.t), seedHz: round(region.wand.seed.hz), toleranceDb: region.wand.toleranceDb, localContrast: region.wand.localContrast, frames: region.wand.frames, bins: region.wand.bins } : undefined,
  harmonic: region.harmonic && region.points ? { ...region.harmonic, f0Start: round(region.points[0].hz), f0End: round(region.points[region.points.length - 1].hz), f0Min: round(Math.min(...region.points.map((p) => p.hz))), f0Max: round(Math.max(...region.points.map((p) => p.hz))), trackPoints: region.points.length } : undefined,
  // A harmonic region's `points` is its fundamental track; it is summarised above rather than repeated here.
});
const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Applies a new region list as one undoable action and returns the stored list. */
async function commit(host: EditingHost, clip: Clip, regions: SpectralRegion[]): Promise<ToolResult | SpectralRegion[]> {
  const action = planSpectralRegionsAction(clip, regions, { actionId: genId(), effectId: `spectral-${genId()}` });
  if (action) {
    const result = await host.applyAction(action);
    if (!result.success) return fail(result.error?.message ?? "Could not edit the spectral regions.", "SPECTRAL_FAILED");
  }
  return clipSpectralRegions(findClip(host, clip.id));
}

type Parsed = { region: SpectralRegion } | { error: string };

/** Builds one region from tool arguments (rect / band / lasso / brush). */
function regionFromArgs(args: Record<string, unknown>, id: string, duration: number): Parsed {
  const shapeArg = args.shape === undefined ? "rect" : args.shape;
  if (typeof shapeArg !== "string" || !(SHAPES as readonly string[]).includes(shapeArg)) return { error: `shape must be one of ${SHAPES.join(", ")}.` };
  // Heal continues a steady partial through a short gap, so it is the default only when the selection spans the whole
  // source; a partial-duration selection defaults to "remove" unless the caller asks for heal.
  const wholeSource = shapeArg === "band" || (typeof args.startTime === "number" && typeof args.endTime === "number" && args.startTime <= 0.001 && args.endTime >= duration - 0.001);
  const mode = args.mode === undefined ? (wholeSource ? "heal" : "remove") : args.mode;
  if (typeof mode !== "string" || !(MODES as readonly string[]).includes(mode)) return { error: `mode must be one of ${MODES.join(", ")}.` };
  const input: Record<string, unknown> = { id, mode, enabled: args.enabled !== false };
  if (typeof args.gainDb === "number") input.gainDb = args.gainDb;
  else if (mode === "attenuate") input.gainDb = DEFAULT_SPECTRAL_ATTENUATION_DB;
  if (typeof args.feather === "number") input.feather = args.feather;
  if (args.channel !== undefined) {
    if (typeof args.channel !== "string" || !(CHANNELS as readonly string[]).includes(args.channel)) return { error: `channel must be one of ${CHANNELS.join(", ")}.` };
    input.channel = args.channel;
  }
  if (shapeArg === "lasso" || shapeArg === "brush") {
    if (!Array.isArray(args.points)) return { error: `${shapeArg} needs points: [{t, hz}, ...] in source seconds and Hz.` };
    input.shape = shapeArg;
    input.points = args.points;
    if (typeof args.brushSeconds === "number") input.brushSeconds = args.brushSeconds;
    if (typeof args.brushOctaves === "number") input.brushOctaves = args.brushOctaves;
  } else {
    if (typeof args.lowHz !== "number" || typeof args.highHz !== "number") return { error: "lowHz and highHz are required." };
    if (shapeArg === "band") {
      input.startTime = 0;
      input.endTime = duration;
    } else {
      if (typeof args.startTime !== "number" || typeof args.endTime !== "number") return { error: "startTime and endTime (source seconds) are required for a rect." };
      input.startTime = args.startTime;
      input.endTime = args.endTime;
    }
    input.lowHz = args.lowHz;
    input.highHz = args.highHz;
  }
  const [region] = sanitizeSpectralRegions([input]);
  if (!region) return { error: "That region is empty or invalid (needs a positive time span and frequency span; a lasso needs 3 or more points)." };
  return { region };
}

const resolveSource = async (host: EditingHost, clipId: string) => {
  const bridge = host.spectralSource;
  if (!bridge) return fail("Finding tones and clicks needs the live editor's audio decoder.", "UNSUPPORTED_HOST");
  try {
    return await bridge.getSource(clipId);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not decode the clip's audio.", "DECODE_FAILED");
  }
};

/**
 * A heal over only part of a persistent partial leaves it in. When the live decoder is available, checks whether a
 * steady partial in the region's band continues on both sides of it and returns a warning if so.
 */
async function healWarning(host: EditingHost, clipId: string, region: SpectralRegion, duration: number): Promise<string | undefined> {
  if (!host.spectralSource || (region.startTime <= 0.001 && region.endTime >= duration - 0.001)) return undefined;
  try {
    const source = await host.spectralSource.getSource(clipId);
    const advice = adviseHeal(source.mono, source.sampleRate, region);
    return advice.continuesBothSides
      ? "Warning: a steady partial in this band continues on both sides of the region, and heal carries it through, so it will stay. Use mode \"remove\" (or cover the partial's full duration) to take it out."
      : undefined;
  } catch {
    return undefined;
  }
}

const parseMode = (args: Record<string, unknown>): { mode?: SpectralRegion["mode"]; error?: string } => {
  if (args.mode === undefined) return {};
  if (typeof args.mode !== "string" || !(MODES as readonly string[]).includes(args.mode)) return { error: `mode must be one of ${MODES.join(", ")}.` };
  return { mode: args.mode as SpectralRegion["mode"] };
};

const TIME_NOTE = "Times are SOURCE seconds (the clip's media, not the timeline), so they stay on the sound when the clip is trimmed or moved.";

export const AUDIO_SPECTRAL_TOOLS: RegisteredTool[] = [
  {
    name: "list_spectral_regions",
    domain: "audio",
    title: "List spectral regions",
    description: `List the spectral edits (Audio tab > Spectral editing) on a clip: data.regions[] with id, mode (attenuate | remove | heal), shape (rect | lasso | brush | wand | harmonic; a frequency band is a rect over the whole source), channel (both | left | right), enabled, startTime/endTime/lowHz/highHz (the bounding box), gainDb (attenuate), feather, points / brush size for lasso and brush, wand {seedTime, seedHz, toleranceDb, localContrast, frames, bins} for a magic-wand region and harmonic {harmonics, maxHz, bandCents, f0Start, f0End, f0Min, f0Max, trackPoints} for a harmonic one. ${TIME_NOTE} Read-only.`,
    inputSchema: obj({ clipId: str }, ["clipId"]),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      if (!clipId) return fail("clipId is required.");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const regions = clipSpectralRegions(clip);
      return ok(regions.length ? `${regions.length} spectral region(s).` : "No spectral regions on this clip.", { clipId, regions: regions.map(describe) });
    },
  },
  {
    name: "add_spectral_region",
    domain: "audio",
    title: "Add spectral region",
    description: `Add one spectral edit to a clip's "spectralRepair" effect as ONE undo step. shape: "rect" (startTime, endTime, lowHz, highHz), "band" (lowHz, highHz over the whole source), "lasso" (points: [{t, hz}, ...], at least 3, a free-form polygon on the time / log-frequency plane) or "brush" (points = the stroke's path, brushSeconds and brushOctaves = its half-size, default 0.04 s x 0.12 octave). mode: "remove" (default for a selection that covers only part of the source's duration) or "heal" (default for a band or a selection that spans the whole source; refills the selection with the surrounding background at its own level and texture, so it leaves no quiet hole, and carries steady partials such as a held note or hum harmonics through gaps up to about a quarter of a second; a longer selection is treated as the sound to remove, not continued. Heal on only a slice of a persistent whistle or hum leaves it in, because it continues the partial from both sides, so a heal on a narrow band whose steady energy continues on both sides of the selection comes back with data.warning; use "remove" for that or cover the whole duration). "remove" is a smooth interpolated fill, 5 to 10 dB quieter than its surroundings: use it when the background underneath is silence or cannot be predicted and a notch does not matter. Or "attenuate" (gainDb <= 0, default -12). feather softens a lasso or brush edge in STFT cells (0-8, default 1). channel (both | left | right, default both) edits only one channel of a stereo source (a mono source is its "left"). For a click-to-select region use add_spectral_magic_wand, and for a pitch-following overtone selection add_spectral_harmonic_region. ${TIME_NOTE} Computed once per source and cached; the preview plays the original until ready, the export waits. Returns data.regionId.`,
    inputSchema: obj({ clipId: str, shape: { type: "string", enum: [...SHAPES] }, ...regionProps }, ["clipId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      if (!clipId) return fail("clipId is required.");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const existing = clipSpectralRegions(clip);
      if (existing.length >= MAX_SPECTRAL_REGIONS) return fail(`A clip holds at most ${MAX_SPECTRAL_REGIONS} spectral regions.`, "LIMIT");
      const parsed = regionFromArgs(args, `sr-${genId()}`, sourceDuration(host, clip));
      if ("error" in parsed) return fail(parsed.error);
      const warning = parsed.region.mode === "heal" ? await healWarning(host, clipId, parsed.region, sourceDuration(host, clip)) : undefined;
      const stored = await commit(host, clip, [...existing, parsed.region]);
      if (!Array.isArray(stored)) return stored;
      return ok(`Added a ${regionShape(parsed.region)} ${parsed.region.mode} region.${warning ? ` ${warning}` : ""}`, { clipId, regionId: parsed.region.id, mode: parsed.region.mode, warning, regions: stored.map(describe) });
    },
  },
  {
    name: "update_spectral_region",
    domain: "audio",
    title: "Update spectral region",
    description: `Change one spectral region of a clip as ONE undo step: any of mode (attenuate | remove | heal), enabled (show / hide), gainDb, feather, startTime/endTime/lowHz/highHz (rect), points (lasso / brush), brushSeconds, brushOctaves. Fields you leave out keep their value. channel (both | left | right) chooses which channel of a stereo source the region edits (a mono source is its "left"). A harmonic region also takes harmonics (1-64), maxHz and bandCents; a wand region takes toleranceDb and localContrast, which re-run the wand from its stored seed against the live editor's decoder (its stored cells are otherwise never recomputed). ${TIME_NOTE}`,
    inputSchema: obj({ clipId: str, regionId: str, ...regionProps, harmonics: num, maxHz: num, bandCents: num, toleranceDb: num, localContrast: bool }, ["clipId", "regionId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      const regionId = typeof args.regionId === "string" ? args.regionId : "";
      if (!clipId || !regionId) return fail("clipId and regionId are required.");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const existing = clipSpectralRegions(clip);
      const target = existing.find((region) => region.id === regionId);
      if (!target) return fail(`Spectral region not found: ${regionId}`, "REGION_NOT_FOUND");
      if (args.mode !== undefined && !(typeof args.mode === "string" && (MODES as readonly string[]).includes(args.mode))) return fail(`mode must be one of ${MODES.join(", ")}.`);
      if (args.channel !== undefined && !(typeof args.channel === "string" && (CHANNELS as readonly string[]).includes(args.channel))) return fail(`channel must be one of ${CHANNELS.join(", ")}.`);
      const merged: Record<string, unknown> = { ...target };
      for (const key of Object.keys(regionProps)) if (args[key] !== undefined) merged[key] = args[key];
      if (args.channel === "both") delete merged.channel;
      if (target.shape === "harmonic" && target.harmonic) {
        merged.harmonic = {
          harmonics: typeof args.harmonics === "number" ? args.harmonics : target.harmonic.harmonics,
          maxHz: typeof args.maxHz === "number" ? args.maxHz : target.harmonic.maxHz,
          bandCents: typeof args.bandCents === "number" ? args.bandCents : target.harmonic.bandCents,
        };
      } else if ((args.harmonics !== undefined || args.maxHz !== undefined || args.bandCents !== undefined) && target.shape !== "harmonic") {
        return fail("harmonics, maxHz and bandCents only apply to a harmonic region.");
      }
      if (target.shape === "wand" && target.wand && (args.toleranceDb !== undefined || args.localContrast !== undefined)) {
        const source = await resolveSource(host, clipId);
        if ("ok" in source) return source;
        const rerun = computeMagicWand(source.mono, source.sampleRate, target.wand.seed, {
          toleranceDb: typeof args.toleranceDb === "number" ? args.toleranceDb : target.wand.toleranceDb,
          localContrast: typeof args.localContrast === "boolean" ? args.localContrast : target.wand.localContrast,
        });
        if (!rerun.ok) return fail(wandFailureMessage(rerun.reason));
        merged.wand = rerun.wand;
      }
      if (merged.mode === "attenuate" && typeof merged.gainDb === "number" && merged.gainDb <= -120 && args.gainDb === undefined) merged.gainDb = DEFAULT_SPECTRAL_ATTENUATION_DB;
      const [updated] = sanitizeSpectralRegions([merged]);
      if (!updated) return fail("That change leaves the region empty or invalid.");
      const stored = await commit(host, clip, existing.map((region) => (region.id === regionId ? updated : region)));
      if (!Array.isArray(stored)) return stored;
      return ok(`Updated region ${regionId}.`, { clipId, regionId, regions: stored.map(describe) });
    },
  },
  {
    name: "remove_spectral_region",
    domain: "audio",
    title: "Remove spectral region",
    description: "Delete one spectral region (regionId) or every region of a clip (all: true), as ONE undo step. Deleting the last region removes the clip's spectral effect.",
    inputSchema: obj({ clipId: str, regionId: str, all: bool }, ["clipId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      if (!clipId) return fail("clipId is required.");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const existing = clipSpectralRegions(clip);
      let next: SpectralRegion[];
      if (args.all === true) next = [];
      else {
        const regionId = typeof args.regionId === "string" ? args.regionId : "";
        if (!regionId) return fail("Give regionId, or all: true.");
        if (!existing.some((region) => region.id === regionId)) return fail(`Spectral region not found: ${regionId}`, "REGION_NOT_FOUND");
        next = existing.filter((region) => region.id !== regionId);
      }
      const stored = await commit(host, clip, next);
      if (!Array.isArray(stored)) return stored;
      return ok(args.all === true ? "Removed every spectral region." : `Removed region ${String(args.regionId)}.`, { clipId, regions: stored.map(describe) });
    },
  },
  {
    name: "find_spectral_tones",
    domain: "audio",
    title: "Find steady tones",
    description: "Find stationary tones (a whine, carrier, whistle that holds one pitch, hum) in a clip's source audio. Returns data.tones[] with hz, startTime, endTime (source seconds) and prominenceDb, strongest first; gliding harmonics (voices, instruments) are ignored. Options: minSeconds (0.25), minProminenceDb (15), maxTones (4), minHz (60). Needs the live editor's audio decoder. Read-only; use remove_spectral_tones to take them out.",
    inputSchema: obj({ clipId: str, minSeconds: num, minProminenceDb: num, maxTones: num, minHz: num }, ["clipId"]),
    readOnly: true,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      if (!clipId) return fail("clipId is required.");
      if (!findClip(host, clipId)) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const source = await resolveSource(host, clipId);
      if ("ok" in source) return source;
      const tones = findSpectralTones(source.mono, source.sampleRate, toneOptions(args));
      return ok(tones.length ? `Found ${tones.length} steady tone(s): ${tones.map((tone) => `${tone.hz} Hz`).join(", ")}.` : "No steady tones found.", { clipId, tones });
    },
  },
  {
    name: "remove_spectral_tones",
    domain: "audio",
    title: "Remove steady tones",
    description: "Find the stationary tones of a clip (as find_spectral_tones) and add one thin band over each as ONE undo step. mode defaults to \"remove\" for a tone that covers only part of the clip, and to \"heal\" only when the tone lasts the whole clip: heal continues a steady partial from both sides, so healing a slice of a persistent whistle or hum leaves it in. Pass mode \"heal\" or \"attenuate\" to choose (a heal that would carry the tone through comes back with data.warnings). Pass hz to act only on the tone nearest that frequency (within 5 %). Same options as find_spectral_tones. Returns data.regionIds, data.modes and data.tones; nothing is added when nothing is found.",
    inputSchema: obj({ clipId: str, hz: num, mode: { type: "string", enum: [...MODES] }, minSeconds: num, minProminenceDb: num, maxTones: num, minHz: num }, ["clipId"]),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      if (!clipId) return fail("clipId is required.");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const source = await resolveSource(host, clipId);
      if ("ok" in source) return source;
      let tones = findSpectralTones(source.mono, source.sampleRate, toneOptions(args));
      if (typeof args.hz === "number") {
        const wanted = args.hz;
        tones = tones.filter((tone) => Math.abs(tone.hz - wanted) <= wanted * 0.05).slice(0, 1);
      }
      if (tones.length === 0) return ok("No steady tones found; nothing changed.", { clipId, tones: [], regionIds: [] });
      const requested = parseMode(args);
      if (requested.error) return fail(requested.error);
      const whole = (tone: { startTime: number; endTime: number }): boolean => tone.startTime <= 0.05 && tone.endTime >= source.duration - 0.05;
      let added = tones.map((tone) => toneRegion(tone, `sr-${genId()}`, source.sampleRate, 0.02, requested.mode ?? (whole(tone) ? "heal" : "remove")));
      if (requested.mode === "attenuate") added = added.map((region) => ({ ...region, gainDb: DEFAULT_SPECTRAL_ATTENUATION_DB }));
      const warnings: string[] = [];
      for (const [index, region] of added.entries()) {
        if (region.mode !== "heal") continue;
        if (adviseHeal(source.mono, source.sampleRate, region).continuesBothSides) warnings.push(`${tones[index].hz} Hz continues steadily on both sides of its region, so heal keeps it; use mode "remove".`);
      }
      const stored = await commit(host, clip, [...clipSpectralRegions(clip), ...sanitizeSpectralRegions(added)].slice(0, MAX_SPECTRAL_REGIONS));
      if (!Array.isArray(stored)) return stored;
      const verb = added.every((region) => region.mode === "heal") ? "Healing" : added.every((region) => region.mode === "remove") ? "Removing" : "Treating";
      return ok(`${verb} ${tones.length} tone(s): ${tones.map((tone) => `${tone.hz} Hz`).join(", ")}.${warnings.length ? ` Warning: ${warnings.join(" ")}` : ""}`, {
        clipId,
        tones,
        regionIds: added.map((region) => region.id),
        modes: added.map((region) => region.mode),
        warnings,
      });
    },
  },
  {
    name: "remove_spectral_clicks",
    domain: "audio",
    title: "Remove clicks (spectral)",
    description: "Find clicks (impulsive transients) in a clip's source audio and add one box (50 ms, above 2.5 kHz, where a click stands out from speech and music) over each, as ONE undo step. mode defaults to \"heal\": a click is short and its box covers the whole of it, so heal refills it from the background on both sides (pass \"remove\" or \"attenuate\" to choose). sensitivity 0-1 (default 0.5); maxClicks (default 64). dryRun: true only reports data.clicks[] (source seconds). Needs the live editor's audio decoder. For many small clicks the DeClick effect (add_audio_repair) is lighter.",
    inputSchema: obj({ clipId: str, mode: { type: "string", enum: [...MODES] }, sensitivity: num, maxClicks: num, dryRun: bool }, ["clipId"]),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      if (!clipId) return fail("clipId is required.");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const source = await resolveSource(host, clipId);
      if ("ok" in source) return source;
      const sensitivity = typeof args.sensitivity === "number" ? Math.max(0, Math.min(1, args.sensitivity)) : 0.5;
      const max = typeof args.maxClicks === "number" ? Math.max(1, Math.min(MAX_SPECTRAL_REGIONS, Math.floor(args.maxClicks))) : 64;
      const clicks = findSpectralClicks(source.mono, source.sampleRate, sensitivity, max);
      if (clicks.length === 0) return ok("No clicks found; nothing changed.", { clipId, clicks: [], regionIds: [] });
      if (args.dryRun === true) return ok(`Found ${clicks.length} click(s).`, { clipId, clicks: clicks.map((click) => ({ time: round(click.time) })) });
      const requested = parseMode(args);
      if (requested.error) return fail(requested.error);
      let added = clicks.map((click) => clickRegion(click, `sr-${genId()}`, source.sampleRate, source.duration, requested.mode ?? "heal"));
      if (requested.mode === "attenuate") added = added.map((region) => ({ ...region, gainDb: DEFAULT_SPECTRAL_ATTENUATION_DB }));
      const stored = await commit(host, clip, [...clipSpectralRegions(clip), ...sanitizeSpectralRegions(added)].slice(0, MAX_SPECTRAL_REGIONS));
      if (!Array.isArray(stored)) return stored;
      return ok(`${requested.mode === "remove" ? "Removing" : requested.mode === "attenuate" ? "Attenuating" : "Healing"} ${clicks.length} click(s).`, { clipId, clicks: clicks.map((click) => ({ time: round(click.time) })), regionIds: added.map((region) => region.id) });
    },
  },
  {
    name: "add_spectral_magic_wand",
    domain: "audio",
    title: "Add spectral magic wand",
    description: `Magic wand in the spectrogram as ONE undo step: select the connected region of similar energy around one time-frequency point (time in source seconds, hz). toleranceDb (default 6, 0.1-60) is how far a cell's level may be from the clicked cell's, in dB, measured on 3 x 3 smoothed power; a small tolerance takes one tone line or one click, a large one floods into the noise floor and selects most of the clip. localContrast: true measures how far a cell stands above its own surroundings instead (one-sided, so a louder part of the same ridge is kept), which follows a whistle or hum whose level wanders. The seed snaps to the loudest of its 3 x 3 cells. The result is stored as the selected cells themselves (run-length coded on the STFT grid) together with the seed and settings, so it renders identically after a reload and never depends on this algorithm again. mode defaults to "remove" (pass "heal" or "attenuate" with gainDb <= 0, default -12); feather defaults to 0 for a wand (a thin tone line is thinned by a feather); channel (both | left | right) edits one channel of a stereo source. Analysis is of the clip's mono mix within 20 s either side of the point. Returns data.regionId, data.cells, data.startTime/endTime/lowHz/highHz. Needs the live editor's audio decoder (headless hosts return UNSUPPORTED_HOST). ${TIME_NOTE}`,
    inputSchema: obj({ clipId: str, time: num, hz: num, toleranceDb: num, localContrast: bool, mode: { type: "string", enum: [...MODES] }, gainDb: num, feather: num, channel: { type: "string", enum: [...CHANNELS] } }, ["clipId", "time", "hz"]),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      if (!clipId) return fail("clipId is required.");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      if (typeof args.time !== "number" || typeof args.hz !== "number") return fail("time (source seconds) and hz are required.");
      const existing = clipSpectralRegions(clip);
      if (existing.length >= MAX_SPECTRAL_REGIONS) return fail(`A clip holds at most ${MAX_SPECTRAL_REGIONS} spectral regions.`, "LIMIT");
      const common = commonRegionArgs(args, "remove");
      if ("error" in common) return fail(common.error);
      const source = await resolveSource(host, clipId);
      if ("ok" in source) return source;
      const result = computeMagicWand(source.mono, source.sampleRate, { t: args.time, hz: args.hz }, {
        toleranceDb: typeof args.toleranceDb === "number" ? args.toleranceDb : undefined,
        localContrast: args.localContrast === true,
      });
      if (!result.ok) return fail(wandFailureMessage(result.reason), result.reason === "out-of-range" ? "INVALID_PARAMS" : "SPECTRAL_FAILED");
      const [region] = sanitizeSpectralRegions([{ ...common.input, id: `sr-${genId()}`, shape: "wand", wand: result.wand }]);
      if (!region) return fail("The wand produced an empty region.", "SPECTRAL_FAILED");
      const stored = await commit(host, clip, [...existing, region]);
      if (!Array.isArray(stored)) return stored;
      return ok(`Added a magic-wand ${region.mode} region of ${result.cells} cells (${round(region.startTime)}-${round(region.endTime)} s, ${round(region.lowHz)}-${round(region.highHz)} Hz).`, {
        clipId, regionId: region.id, mode: region.mode, cells: result.cells, startTime: round(region.startTime), endTime: round(region.endTime), lowHz: round(region.lowHz), highHz: round(region.highHz), regions: stored.map(describe),
      });
    },
  },
  {
    name: "add_spectral_harmonic_region",
    domain: "audio",
    title: "Add spectral harmonic region",
    description: `Harmonic (overtone-following) selection as ONE undo step: pick a fundamental and the tool tracks its pitch through time (vibrato and glides included) and selects its overtones as one region. Give the seed as a point (time in source seconds, hz of the FUNDAMENTAL; refined within 200 cents) to track the whole source from it, or as a box (startTime, endTime, lowHz, highHz) to take the strongest peak inside it and track only within its time span. harmonics (1-64, default 8) partials, the fundamental counting as 1; maxHz (default 20000) drops partials above it; bandCents (5-400, default 50) is the half-width of each partial's band in cents (never narrower than 1.5 STFT bins, about 35 Hz at 48 kHz). The tracker follows the pitch to a few cents on a clean tone (median about 1.4 cents on an analytic vibrato and glide) and stops where the partials fade or stop looking like the seed's; on a dense mix it can follow a neighbouring voice, so read data.f0Start/f0End/startTime/endTime and check them. The fundamental track (at most 512 points) is stored, so the region renders identically after a reload. mode defaults to "remove" (heal would carry a steady partial through; pass "heal" or "attenuate" with gainDb <= 0, default -12); feather defaults to 0; channel (both | left | right) edits one channel of a stereo source. Returns data.regionId, data.startTime/endTime, data.f0Start/f0End/f0Min/f0Max and data.trackPoints. Needs the live editor's audio decoder (headless hosts return UNSUPPORTED_HOST). ${TIME_NOTE}`,
    inputSchema: obj({ clipId: str, time: num, hz: num, startTime: num, endTime: num, lowHz: num, highHz: num, harmonics: num, maxHz: num, bandCents: num, mode: { type: "string", enum: [...MODES] }, gainDb: num, feather: num, channel: { type: "string", enum: [...CHANNELS] } }, ["clipId"]),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      if (!clipId) return fail("clipId is required.");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const hasPoint = typeof args.time === "number" && typeof args.hz === "number";
      const hasBox = ["startTime", "endTime", "lowHz", "highHz"].every((key) => typeof args[key] === "number");
      if (!hasPoint && !hasBox) return fail("Give the fundamental as time + hz, or as a box (startTime, endTime, lowHz, highHz).");
      const existing = clipSpectralRegions(clip);
      if (existing.length >= MAX_SPECTRAL_REGIONS) return fail(`A clip holds at most ${MAX_SPECTRAL_REGIONS} spectral regions.`, "LIMIT");
      const common = commonRegionArgs(args, "remove");
      if ("error" in common) return fail(common.error);
      const harmonics = typeof args.harmonics === "number" ? Math.max(1, Math.min(64, Math.round(args.harmonics))) : 8;
      const bandCents = typeof args.bandCents === "number" ? Math.max(5, Math.min(400, args.bandCents)) : 50;
      const source = await resolveSource(host, clipId);
      if ("ok" in source) return source;
      const maxHz = typeof args.maxHz === "number" ? Math.max(20, Math.min(source.sampleRate / 2, args.maxHz)) : Math.min(20000, source.sampleRate / 2);
      let seed = hasPoint ? { t: args.time as number, hz: args.hz as number } : null;
      if (!hasPoint) {
        seed = findBoxSeed(source.mono, source.sampleRate, { startTime: args.startTime as number, endTime: args.endTime as number, lowHz: args.lowHz as number, highHz: args.highHz as number });
        if (!seed) return fail("The box holds no audible peak to follow.", "SPECTRAL_FAILED");
      }
      const tracked = trackHarmonics(source.mono, source.sampleRate, seed as { t: number; hz: number }, {
        harmonics,
        maxHz,
        startTime: hasPoint ? undefined : (args.startTime as number),
        endTime: hasPoint ? undefined : (args.endTime as number),
      });
      if (!tracked.ok) return fail(tracked.reason === "out-of-range" ? "That fundamental is outside the audio or too high to carry overtones." : "No steady harmonic sound was found at that point.", tracked.reason === "out-of-range" ? "INVALID_PARAMS" : "SPECTRAL_FAILED");
      const [region] = sanitizeSpectralRegions([{ ...common.input, id: `sr-${genId()}`, shape: "harmonic", points: tracked.points, harmonic: { harmonics, maxHz, bandCents } }]);
      if (!region || !region.points) return fail("The track produced an empty region.", "SPECTRAL_FAILED");
      const stored = await commit(host, clip, [...existing, region]);
      if (!Array.isArray(stored)) return stored;
      const hz = region.points.map((p) => p.hz);
      return ok(`Added a harmonic ${region.mode} region: fundamental ${round(hz[0])} Hz to ${round(hz[hz.length - 1])} Hz over ${round(region.startTime)}-${round(region.endTime)} s, ${harmonics} partial(s).`, {
        clipId, regionId: region.id, mode: region.mode, startTime: round(region.startTime), endTime: round(region.endTime), f0Start: round(hz[0]), f0End: round(hz[hz.length - 1]), f0Min: round(Math.min(...hz)), f0Max: round(Math.max(...hz)), trackPoints: region.points.length, harmonics, maxHz, bandCents, regions: stored.map(describe),
      });
    },
  },
];

/** mode, gainDb, feather, channel and enabled shared by the click-to-select tools. */
function commonRegionArgs(args: Record<string, unknown>, defaultMode: SpectralRegion["mode"]): { input: Record<string, unknown> } | { error: string } {
  const parsed = parseMode(args);
  if (parsed.error) return { error: parsed.error };
  const mode = parsed.mode ?? defaultMode;
  const input: Record<string, unknown> = { mode, enabled: args.enabled !== false };
  if (typeof args.gainDb === "number") input.gainDb = args.gainDb;
  else if (mode === "attenuate") input.gainDb = DEFAULT_SPECTRAL_ATTENUATION_DB;
  if (typeof args.feather === "number") input.feather = args.feather;
  if (args.channel !== undefined) {
    if (typeof args.channel !== "string" || !(CHANNELS as readonly string[]).includes(args.channel)) return { error: `channel must be one of ${CHANNELS.join(", ")}.` };
    input.channel = args.channel;
  }
  return { input };
}

function toneOptions(args: Record<string, unknown>) {
  const pick = (key: string): number | undefined => (typeof args[key] === "number" ? (args[key] as number) : undefined);
  return { minSeconds: pick("minSeconds"), minProminenceDb: pick("minProminenceDb"), maxTones: pick("maxTones"), minHz: pick("minHz") };
}
