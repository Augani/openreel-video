import type { Project, MediaItem, MediaMetadata } from "../types/project";
import { toRuntimeVideoEffectParams, toNormalizedVideoEffectParams } from "../video/effect-parameter-units";
import { TRANSITION_TYPES, AUDIO_EFFECT_TYPES } from "../types/effects";
import { EASING_TYPES } from "../types/timeline";
import { EFFECT_KEYFRAME_INPUT_ALTERNATIVES } from "../video/effect-instance-keyframes";
import { PRO_EFFECT_SPECS, PRO_EFFECT_TYPES } from "../video/pro-effects";
import { editObject as obj, editArray as arr, editEnum as en, editId as id, editString as str, editNumber as num, editTime as time, editBoolean as bool, validateEditJSON, type EditSchema } from "./safe-json";

const EDIT_FORMAT = "openreel-edit";
const EDIT_VERSION = 3;
const EDIT_FADE_ORIGIN_VERSION = 4;
const pair = obj({ x: num(), y: num() }, ["x", "y"]);
export const transformSchema = obj({ position: pair, scale: pair, rotation: num(), anchor: pair, opacity: num(0, 1), fitMode: en(["contain", "cover", "stretch", "none"]), borderRadius: num(0, 10000), crop: obj({ x: num(0, 1), y: num(0, 1), width: num(0, 1), height: num(0, 1) }, ["x", "y", "width", "height"]) });
export const numericParams: EditSchema = { type: "object", additionalProperties: num(-100000, 100000) };
export const PORTABLE_VIDEO_EFFECTS = ["brightness", "contrast", "saturation", "hue", "blur", "sharpen", "vignette", "grain", ...PRO_EFFECT_TYPES] as const;
const videoEffects = PORTABLE_VIDEO_EFFECTS;
/** Pro effect param schemas come straight from PRO_EFFECT_SPECS so ranges can never drift. */
const proEffectEditSchemas: Record<string, EditSchema> = Object.fromEntries(PRO_EFFECT_TYPES.map((type) => [
  type,
  obj(Object.fromEntries(PRO_EFFECT_SPECS[type].params.map((param) => [
    param.key,
    param.kind === "number" ? num(param.min, param.max) : param.kind === "toggle" ? bool : en((param.options ?? []).map((option) => option.value)),
  ]))),
]));
export const VIDEO_EDIT_PARAM_SCHEMAS: Record<string, EditSchema> = {
  brightness: obj({ value: num(-1, 1) }), contrast: obj({ value: num(0, 3) }), saturation: obj({ value: num(0, 3) }), hue: obj({ rotation: num(-360, 360) }),
  blur: obj({ radius: num(0, 100), type: en(["gaussian", "box", "motion"]), angle: num(0, 360) }), sharpen: obj({ amount: num(0, 5), radius: num(0, 100), threshold: num(0, 255) }),
  vignette: obj({ amount: num(0, 1), midpoint: num(0, 1), roundness: num(0, 1), feather: num(0, 1) }), grain: obj({ amount: num(0, 1), size: num(0, 10), roughness: num(0, 1), colored: bool }),
  ...proEffectEditSchemas,
};
const fullTransformSchema = { ...transformSchema, required: ["position", "scale", "rotation", "anchor", "opacity"] };
export const AUDIO_EDIT_PARAM_SCHEMAS: Record<string, EditSchema> = {
  gain: obj({ value: num(0, 4) }), pan: obj({ value: num(-1, 1) }),
  eq: obj({ bands: arr(obj({ type: en(["lowshelf", "highshelf", "peaking", "lowpass", "highpass", "notch"]), frequency: num(20, 20000), gain: num(-24, 24), q: num(0.1, 18) }, ["type", "frequency", "gain", "q"]), 32) }),
  compressor: obj({ threshold: num(-60, 0), ratio: num(1, 20), attack: num(0.001, 1), release: num(0.01, 3), knee: num(0, 40), makeupGain: num(0, 24) }),
  reverb: obj({ roomSize: num(0, 1), damping: num(0, 1), wetLevel: num(0, 1), dryLevel: num(0, 1), preDelay: num(0, 100) }),
  delay: obj({ time: num(0, 2), feedback: num(0, 0.95), wetLevel: num(0, 1), sync: bool }),
  noiseReduction: obj({ threshold: num(-60, 0), reduction: num(0, 1), attack: num(0, 100), release: num(0, 500), focus: en(["balanced", "speech", "whiteNoise", "music", "heavy", "wind", "hum"]) }),
  deHum: obj({ frequency: num(20, 400), harmonics: num(1, 12), q: num(2, 200), depth: num(0, 1) }),
  deClick: obj({ sensitivity: num(0, 1), maxWidth: num(1, 64) }),
  deClip: obj({ threshold: num(-24, 0), maxRun: num(4, 160) }),
  deEss: obj({ frequency: num(1000, 24000), bandwidthQ: num(0.3, 8), threshold: num(-80, 0), ratio: num(1, 20), attack: num(0.0001, 0.1), release: num(0.005, 1), listen: num(0, 1) }),
  deReverb: obj({ amount: num(0, 1), rt60: num(0.1, 5), floor: num(-40, 0) }),
  gate: obj({ threshold: num(-90, 0), range: num(-90, 0), attack: num(0.0002, 0.5), hold: num(0, 2), release: num(0.005, 3) }),
  brickwallLimiter: obj({ ceiling: num(-24, 0), release: num(0.01, 1) }),
  lowPass: obj({ frequency: num(100, 20000), slope: num(12, 48) }),
  spectralRepair: obj({ regions: arr(obj({ id, mode: en(["attenuate", "remove"]), startTime: num(0, 86400), endTime: num(0, 86400), lowHz: num(0, 192000), highHz: num(0, 192000), gainDb: num(-120, 0), enabled: bool }, ["mode", "startTime", "endTime", "lowHz", "highHz"]), 256) }),
  fadeIn: obj({ duration: time, curve: en(["linear", "exponential", "logarithmic", "s-curve"]) }),
  fadeOut: obj({ duration: time, curve: en(["linear", "exponential", "logarithmic", "s-curve"]) }),
};
export const audioParamsSchema = obj(Object.fromEntries(Object.entries(Object.assign({}, ...Object.values(AUDIO_EDIT_PARAM_SCHEMAS).map((schema) => schema.properties))).map(([key, schema]) => [key, (schema as EditSchema).type === "number" ? num() : schema as EditSchema])));
export const transitionParamsSchema = obj({ direction: en(["left", "right", "up", "down", "diagonal", "vertical", "horizontal"]), axis: en(["x", "y"]), orientation: en(["vertical", "horizontal"]), clockwise: bool, center: pair, softness: num(0, 1), intensity: num(0, 10), blurIntensity: num(0, 100), holdDuration: num(0, 30), maxPixelSize: num(1, 1000), count: num(1, 100), slices: num(1, 100), rotations: num(-20, 20), scale: num(0.01, 100), startAngle: num(-360, 360), warmth: num(0, 1), pushOut: bool, curve: en(["linear", "ease-in", "ease-out", "ease-in-out"]) });
const portableVideoParams: EditSchema = { ...numericParams, properties: { colored: bool, type: en(["gaussian", "box", "motion"]), mode: en(["none", "horizontal", "vertical", "quad"]), compensate: bool, invert: bool } };
const filterPresetSourceSchema = obj({ presetId: id, applicationId: id, index: num(0, 99) }, ["presetId", "applicationId", "index"]);
const effectSchema = obj({ id, type: en(videoEffects), params: portableVideoParams, enabled: bool, metadata: obj({ filterPreset: filterPresetSourceSchema }, ["filterPreset"]) }, ["id", "type", "params", "enabled"]);
const essentialTagSchema = obj({ block: en(["loudness", "repair", "clarity", "ducking"]), key: str, sig: str }, ["block", "key", "sig"]);
const audioEffectSchema = obj({ id, type: en(AUDIO_EFFECT_TYPES), params: audioParamsSchema, enabled: bool, metadata: obj({ essentialSound: essentialTagSchema }, ["essentialSound"]) }, ["id", "type", "params", "enabled"]);
export const keyframeSchema = obj({ id, time, property: { type: "string", maxLength: 300, pattern: `^(?:position\\.x|position\\.y|scale\\.x|scale\\.y|rotation|opacity|volume|${EFFECT_KEYFRAME_INPUT_ALTERNATIVES})$` }, value: num(), easing: en(EASING_TYPES) }, ["id", "time", "property", "value", "easing"]);
export const textStyleSchema = obj({ fontFamily: { ...str, maxLength: 200, pattern: "^[a-zA-Z0-9 ,_-]+$" }, fontSize: num(1, 1000), fontWeight: { enum: [100, 200, 300, 400, 500, 600, 700, 800, 900, "normal", "bold"] }, fontStyle: en(["normal", "italic"]), color: str, backgroundColor: str, strokeColor: str, strokeWidth: num(0, 100), shadowColor: str, shadowBlur: num(0, 100), shadowOffsetX: num(), shadowOffsetY: num(), textAlign: en(["left", "center", "right", "justify"]), verticalAlign: en(["top", "middle", "bottom"]), lineHeight: num(0.1, 10), letterSpacing: num(-100, 100), textDecoration: en(["none", "underline", "line-through", "overline"]) });
const laneSchema = arr(obj({ time, value: num(0, 4) }, ["time", "value"]));
const essentialStateSchema = obj({
  options: obj({ loudness: bool, repair: bool, clarity: bool, ducking: bool, reduceNoise: bool, reduceRumble: bool, clarityAmount: num(0, 1), duckAmountDb: num(0, 60), duckFadeMs: num(0, 10000), dialogueTargetLufs: num(-60, 0) }, ["loudness", "repair", "clarity", "ducking", "reduceNoise", "reduceRumble", "clarityAmount", "duckAmountDb", "duckFadeMs", "dialogueTargetLufs"]),
  loudness: obj({ targetLufs: num(-60, 0), beforeLufs: num(-200, 100), afterLufs: num(-200, 100), clamped: bool, previousVolume: num(0, 4), previousVolumeLane: laneSchema, appliedVolume: num(0, 4), appliedVolumeLane: laneSchema }, ["targetLufs", "clamped", "previousVolume", "appliedVolume"]),
  ducking: obj({ live: bool, previousVolumeLane: laneSchema, appliedVolumeLane: laneSchema }),
}, ["options"]);
const liveDuckingSchema = obj({ enabled: bool, amountDb: num(1, 40), attackMs: num(10, 3000), releaseMs: num(10, 3000), holdMs: num(0, 3000) }, ["enabled", "amountDb", "attackMs", "releaseMs", "holdMs"]);
const clipLinkMetadataSchema = obj({ splitSourceClipId: id, separatedFromClipId: id, sourceAudioTrackIndex: num(0, 63), essentialSound: essentialStateSchema, liveDucking: liveDuckingSchema });
const clipKeyframeSchema = { ...keyframeSchema, properties: { ...keyframeSchema.properties, time: num(-86400, 86400), bezierHandles: obj({ in: pair, out: pair }, ["in", "out"]), roving: bool, interpolationIn: en(["auto-bezier", "continuous-bezier"]), interpolationOut: en(["auto-bezier", "continuous-bezier"]) } };
const automation = obj({ volume: arr(obj({ time, value: num(0, 4) }, ["time", "value"])), pan: arr(obj({ time, value: num(-1, 1) }, ["time", "value"])) });
const clipSchema = obj({ id, mediaId: id, trackId: id, startTime: time, duration: num(0.001, 86400), inPoint: time, outPoint: time, effects: arr(effectSchema, 100), audioEffects: arr(audioEffectSchema, 100), transform: fullTransformSchema, volume: num(0, 4), fade: obj({ fadeIn: time, fadeOut: time, origin: obj({ offset: num(-86400, 86400), duration: num(0.000001, 86400), fadeIn: bool, fadeOut: bool, out: obj({ offset: num(-86400, 86400), duration: num(0.000001, 86400) }, ["offset", "duration"]) }, ["offset", "duration"]) }, ["fadeIn", "fadeOut"]), keyframes: arr(clipKeyframeSchema), automation, speed: num(-20, 20), reversed: bool, pitchCorrection: bool, audioType: en(["dialogue", "music", "sfx", "ambience"]), audioTrackIndex: num(0, 63), metadata: clipLinkMetadataSchema }, ["id", "mediaId", "trackId", "startTime", "duration", "inPoint", "outPoint", "effects", "audioEffects", "transform", "volume", "keyframes"]);
const transitionSchema = obj({ id, type: en(TRANSITION_TYPES), clipAId: id, clipBId: id, duration: num(0.001, 30), params: transitionParamsSchema, edge: en(["in", "out"]) }, ["id", "type", "clipAId", "duration", "params"]);
const metadataSchema = obj({ duration: time, width: num(0, 8192), height: num(0, 8192), frameRate: num(0, 240), codec: str, sampleRate: num(0, 192000), channels: num(0, 8), fileSize: num(0, 1e12), audioTrackCount: num(0, 64), hasVideo: bool, hasAudio: bool }, ["duration", "width", "height", "frameRate", "codec", "sampleRate", "channels", "fileSize"]);
const sourceSchema = obj({ name: str, size: num(0, 1e12), lastModified: num(0, 1e15) }, ["name", "size", "lastModified"]);
const mediaSchema = obj({ id, name: str, type: en(["video", "audio", "image"]), metadata: metadataSchema, sourceFile: sourceSchema }, ["id", "name", "type", "metadata"]);
export const settingsSchema = obj({ width: num(16, 8192), height: num(16, 8192), frameRate: num(1, 120), sampleRate: num(8000, 192000), channels: num(1, 8) }, ["width", "height", "frameRate", "sampleRate", "channels"]);
const subtitleStyle = obj({ fontFamily: str, fontSize: num(1, 1000), color: str, backgroundColor: str, position: en(["top", "center", "bottom"]), highlightColor: str, upcomingColor: str });
const projectSchema = obj({ id, name: str, settings: settingsSchema, media: arr(mediaSchema), timeline: obj({ tracks: arr(obj({ id, name: str, type: en(["video", "audio", "image", "text", "graphics"]), mode: en(["standard"]), role: en(["general", "captions", "dialogue", "music", "effects", "ambience"]), groupId: id, locked: bool, syncLock: bool, hidden: bool, muted: bool, solo: bool, soloSafe: bool, clips: arr(clipSchema), transitions: arr(transitionSchema) }, ["id", "name", "type", "locked", "hidden", "muted", "solo", "clips", "transitions"]), 100), subtitles: arr(obj({ id, text: str, startTime: time, endTime: time, style: subtitleStyle }, ["id", "text", "startTime", "endTime"])), markers: arr(obj({ id, time, label: str, color: str, duration: time, comment: str, kind: en(["comment", "chapter", "segmentation", "web"]), author: str, status: en(["open", "resolved"]), createdAt: num(0, 1e15), replies: arr(obj({ id, author: str, text: str, createdAt: num(0, 1e15) }, ["id", "author", "text", "createdAt"]), 1000) }, ["id", "time", "label", "color"])), duration: time, backgroundFillMode: en(["color", "blur"]), layoutBackgroundColor: str }, ["tracks", "subtitles", "markers", "duration"]), textClips: arr(obj({ id, trackId: id, text: str, startTime: time, duration: num(0.001, 86400), style: { ...textStyleSchema, required: ["fontFamily", "fontSize", "fontWeight", "fontStyle", "color", "textAlign", "verticalAlign", "lineHeight", "letterSpacing"] }, transform: fullTransformSchema, keyframes: arr(keyframeSchema) }, ["id", "trackId", "text", "startTime", "duration", "style", "transform", "keyframes"])) }, ["id", "name", "settings", "media", "timeline", "textClips"]);
const portableEditSchema = obj({ format: { enum: [EDIT_FORMAT] }, version: { enum: [EDIT_VERSION, EDIT_FADE_ORIGIN_VERSION] }, project: projectSchema }, ["format", "version", "project"]);

interface PortableEdit {
  format: typeof EDIT_FORMAT;
  version: typeof EDIT_VERSION | typeof EDIT_FADE_ORIGIN_VERSION;
  project: Pick<Project, "id" | "name" | "settings" | "timeline"> & { media: Array<Pick<MediaItem, "id" | "name" | "type" | "metadata" | "sourceFile">>; textClips: NonNullable<Project["textClips"]> };
}

function validatePortableEdit(doc: unknown): asserts doc is PortableEdit {
  validateEditJSON(doc, portableEditSchema);
  const { project } = doc as PortableEdit;
  const seen = new Set<string>();
  const unique = (value: string) => { if (seen.has(value)) throw new Error(`Duplicate element ID: ${value}`); seen.add(value); };
  const media = new Map(project.media.map((m) => [m.id, m]));
  project.media.forEach((m) => unique(m.id));
  const tracks = new Map(project.timeline.tracks.map((t) => [t.id, t]));
  for (const track of project.timeline.tracks) {
    unique(track.id);
    for (const clip of track.clips) {
      unique(clip.id);
      const asset = media.get(clip.mediaId);
      if (!asset || clip.trackId !== track.id) throw new Error(`Clip ${clip.id}: missing media or incorrect track reference`);
      if (track.mode !== "standard" && track.type !== asset.type && !(track.type === "video" && asset.type === "image")) throw new Error(`Clip ${clip.id}: incompatible media and track`);
      if (clip.outPoint <= clip.inPoint || asset.type !== "image" && clip.outPoint > asset.metadata.duration + 0.05) throw new Error(`Clip ${clip.id}: source range exceeds media duration`);
      if (clip.speed !== undefined && Math.abs(clip.speed) < 0.1) throw new Error(`Clip ${clip.id}: playback speed is outside the supported range`);
      if (Math.abs(clip.duration - (clip.outPoint - clip.inPoint) / Math.abs(clip.speed ?? 1)) > 0.05) throw new Error(`Clip ${clip.id}: duration does not match source range and speed`);
      if ((clip.fade?.origin || clip.automation || (clip.speed !== undefined && (clip.speed < 0 || clip.speed > 16)) || clip.keyframes.some(key => key.time < 0 || key.bezierHandles || key.roving !== undefined || key.interpolationIn !== undefined || key.interpolationOut !== undefined)) && (doc as PortableEdit).version !== EDIT_FADE_ORIGIN_VERSION) throw new Error(`Clip ${clip.id}: retained clip clocks require portable edit version 4`);
      const origin = clip.fade?.origin;
      if (clip.fade && (clip.fade.fadeIn > (origin && origin.fadeIn !== false ? origin.duration : clip.duration) || clip.fade.fadeOut > (origin && origin.fadeOut !== false ? origin.out?.duration ?? origin.duration : clip.duration))) throw new Error(`Clip ${clip.id}: audio fade exceeds its authored duration`);
      [...clip.effects, ...clip.audioEffects, ...clip.keyframes].forEach((x) => unique(x.id));
      clip.effects.forEach((effect) => validateEditJSON(effect.params, VIDEO_EDIT_PARAM_SCHEMAS[effect.type], `effect ${effect.id}.params`));
      clip.audioEffects.forEach((effect) => validateEditJSON(effect.params, AUDIO_EDIT_PARAM_SCHEMAS[effect.type], `audio effect ${effect.id}.params`));
    }
    for (const transition of track.transitions) {
      unique(transition.id);
      const a = track.clips.find((c) => c.id === transition.clipAId);
      const b = track.clips.find((c) => c.id === transition.clipBId);
      if (!a || transition.clipBId && !b || transition.duration > a.duration || b && (transition.duration > b.duration || Math.abs(a.startTime + a.duration - b.startTime) > 0.01)) throw new Error(`Transition ${transition.id}: invalid clips, adjacency or duration`);
    }
  }
  for (const text of project.textClips) {
    unique(text.id);
    const track = tracks.get(text.trackId);
    if (!track || track.mode !== "standard" && track.type !== "text") throw new Error(`Text ${text.id}: missing text track`);
    text.keyframes.forEach((keyframe) => unique(keyframe.id));
  }
  for (const subtitle of project.timeline.subtitles) { unique(subtitle.id); if (subtitle.endTime <= subtitle.startTime) throw new Error(`Subtitle ${subtitle.id}: invalid time range`); }
  project.timeline.markers.forEach((m) => unique(m.id));
}

function mapTimelineEffectParams(timeline: Project["timeline"], convert: typeof toRuntimeVideoEffectParams): Project["timeline"] {
  return { ...timeline, tracks: timeline.tracks.map(track => ({ ...track,
    clips: track.clips.map(clip => ({ ...clip, effects: clip.effects.map(effect => ({
      ...effect, params: convert(effect.type, effect.params),
    })) })),
  })) };
}

export function parsePortableEdit(json: string): PortableEdit {
  if (json.length > 5_000_000) throw new Error("Edit JSON exceeds the 5 MB limit");
  const doc = JSON.parse(json) as Omit<PortableEdit, "version"> & { version: number; project: PortableEdit["project"] & { assets?: PortableEdit["project"]["media"] } };
  if (doc?.format === EDIT_FORMAT && (doc.version === 1 || doc.version === 2)) {
    if (doc.version === 1 && doc.project?.assets) {
      doc.project.media = doc.project.assets;
      delete doc.project.assets;
    }
    // Old exports copied runtime parameters directly. Validate their closed
    // structure first, then normalize their known units without magnitude guesses.
    validateEditJSON(doc, { ...portableEditSchema, properties: { ...portableEditSchema.properties, version: { enum: [1, 2] } } });
    const migrated = { ...doc, version: EDIT_VERSION, project: { ...doc.project,
      timeline: mapTimelineEffectParams(doc.project.timeline, toNormalizedVideoEffectParams),
    } };
    validatePortableEdit(migrated);
    return migrated;
  }
  validatePortableEdit(doc);
  return doc;
}

// UI provenance stays in saved projects. Keep the closed version-3 metadata
// contract readable by existing clients when sharing a portable edit.
function portableMediaMetadata(metadata: MediaMetadata): MediaMetadata {
  const result = { ...metadata };
  delete result.soundLibraryId;
  delete result.recordedTake;
  return result;
}

export function createPortableEdit(project: Project): PortableEdit {
  if ((project.sequences?.length ?? 0) > 1) throw new Error("Portable edits hold a single timeline; this project has several sequences. Use the ordinary project format to retain them");
  for (const key of ["shapeClips", "svgClips", "stickerClips", "adjustmentLayers", "masks", "particleEffects", "multicamGroups", "compoundClips", "nestedInstances", "motionCompositions", "motionInstances", "generatedShaders", "graphicInstances", "linkedCompositions"] as const) {
    if (project[key]?.length) throw new Error(`Portable edits do not yet support ${key}; use the ordinary project format to retain them`);
  }
  if (project.creation) throw new Error("Portable edits do not yet support creation scenes");
  const version = project.timeline.tracks.some(track => track.clips.some(clip => clip.fade?.origin || clip.automation || (clip.speed !== undefined && (clip.speed < 0 || clip.speed > 16)) || clip.keyframes.some(key => key.time < 0 || key.bezierHandles || key.roving !== undefined || key.interpolationIn !== undefined || key.interpolationOut !== undefined))) ? EDIT_FADE_ORIGIN_VERSION : EDIT_VERSION;
  const doc = JSON.parse(JSON.stringify({ format: EDIT_FORMAT, version, project: { id: project.id, name: project.name, settings: project.settings, timeline: project.timeline, textClips: project.textClips ?? [], media: project.mediaLibrary.items.map((m) => ({ id: m.id, name: m.name, type: m.type, metadata: portableMediaMetadata(m.metadata), ...(m.sourceFile ? { sourceFile: { name: m.sourceFile.name, size: m.sourceFile.size, lastModified: m.sourceFile.lastModified } } : {}) })) } })) as PortableEdit;
  const normalized = { ...doc, project: { ...doc.project, timeline: mapTimelineEffectParams(doc.project.timeline, toNormalizedVideoEffectParams) } };
  validatePortableEdit(normalized);
  return normalized;
}

export function materializePortableEdit(doc: PortableEdit, current: Project): { project: Project; missing: string[] } {
  validatePortableEdit(doc);
  const missing: string[] = [];
  const items: MediaItem[] = doc.project.media.map((ref) => {
    const candidates = current.mediaLibrary.items.filter((m) => m.type === ref.type && m.blob && (m.id === ref.id || ref.sourceFile && m.sourceFile?.name === ref.sourceFile.name && m.sourceFile.size === ref.sourceFile.size));
    const exact = candidates.find((m) => m.id === ref.id);
    const found = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!found) missing.push(ref.id);
    return { ...ref, metadata: found?.metadata ?? ref.metadata, fileHandle: found?.fileHandle ?? null, blob: found?.blob ?? null, thumbnailUrl: found?.thumbnailUrl ?? null, waveformData: found?.waveformData ?? null, filmstripThumbnails: found?.filmstripThumbnails, thumbnailPixelAspect: found?.thumbnailPixelAspect, isPlaceholder: !found };
  });
  const duration = Math.max(0, ...doc.project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.startTime + c.duration)), ...doc.project.textClips.map((c) => c.startTime + c.duration), ...doc.project.timeline.subtitles.map((s) => s.endTime));
  const project = { ...current, name: doc.project.name, settings: doc.project.settings, timeline: { ...mapTimelineEffectParams(doc.project.timeline, toRuntimeVideoEffectParams), duration }, textClips: doc.project.textClips, mediaLibrary: { items }, shapeClips: [], svgClips: [], stickerClips: [], adjustmentLayers: [], masks: [], particleEffects: [], multicamGroups: [], compoundClips: [], nestedInstances: [], motionCompositions: [], motionInstances: [], generatedShaders: [], creation: undefined };
  createPortableEdit(project);
  return { project, missing };
}

export interface EditPreset { format: "openreel-preset"; version: 2; name: string; effects: Project["timeline"]["tracks"][number]["clips"][number]["effects"]; transition?: { type: string; duration: number; params: Record<string, unknown> } }
export const presetSchema = obj({ format: { enum: ["openreel-preset"] }, version: { enum: [2] }, name: str, effects: arr(effectSchema, 100), transition: obj({ type: en(TRANSITION_TYPES), duration: num(0.001, 30), params: transitionParamsSchema }, ["type", "duration", "params"]) }, ["format", "version", "name", "effects"]);

export function normalizeEditPreset(input: unknown): EditPreset {
  validateEditJSON(input, { ...presetSchema, properties: { ...presetSchema.properties, version: { enum: [1, 2] } } });
  const source = input as Omit<EditPreset, "version"> & { version: number };
  const result: EditPreset = { ...source, version: 2, effects: source.effects.map(effect => ({
    ...effect, params: source.version === 1 ? toNormalizedVideoEffectParams(effect.type, effect.params) : { ...effect.params },
  })) };
  validateEditJSON(result, presetSchema);
  result.effects.forEach(effect => validateEditJSON(effect.params, VIDEO_EDIT_PARAM_SCHEMAS[effect.type]));
  if (!result.effects.length && !result.transition) throw new Error("A preset must contain an effect or transition");
  return result;
}

export function createEditPreset(preset: Omit<EditPreset, "format" | "version">): EditPreset {
  return normalizeEditPreset({ ...preset, format: "openreel-preset", version: 2,
    effects: preset.effects.map(effect => ({ ...effect, params: toNormalizedVideoEffectParams(effect.type, effect.params) })),
  });
}

export function parseEditPreset(json: string): EditPreset {
  if (json.length > 100000) throw new Error("Preset exceeds 100 KB");
  return normalizeEditPreset(JSON.parse(json));
}
