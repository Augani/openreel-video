import type { Project, MediaItem } from "../types/project";
import { TRANSITION_TYPES, AUDIO_EFFECT_TYPES } from "../types/effects";
import { EASING_TYPES } from "../types/timeline";
import { editObject as obj, editArray as arr, editEnum as en, editId as id, editString as str, editNumber as num, editTime as time, editBoolean as bool, validateEditJSON, type EditSchema } from "./safe-json";

export const EDIT_FORMAT = "openreel-edit";
export const EDIT_VERSION = 2;
const pair = obj({ x: num(), y: num() }, ["x", "y"]);
export const transformSchema = obj({ position: pair, scale: pair, rotation: num(), anchor: pair, opacity: num(0, 1), fitMode: en(["contain", "cover", "stretch", "none"]), borderRadius: num(0, 10000), crop: obj({ x: num(0, 1), y: num(0, 1), width: num(0, 1), height: num(0, 1) }, ["x", "y", "width", "height"]) });
export const numericParams: EditSchema = { type: "object", additionalProperties: num(-100000, 100000) };
export const PORTABLE_VIDEO_EFFECTS = ["brightness", "contrast", "saturation", "hue", "blur", "sharpen", "vignette", "grain"] as const;
const videoEffects = PORTABLE_VIDEO_EFFECTS;
export const VIDEO_EDIT_PARAM_SCHEMAS: Record<string, EditSchema> = {
  brightness: obj({ value: num(-1, 1) }), contrast: obj({ value: num(0, 3) }), saturation: obj({ value: num(0, 3) }), hue: obj({ rotation: num(-180, 180) }),
  blur: obj({ radius: num(0, 100) }), sharpen: obj({ amount: num(0, 5), radius: num(0, 100), threshold: num(0, 1) }),
  vignette: obj({ amount: num(0, 1), midpoint: num(0, 1), roundness: num(0, 1), feather: num(0, 1) }), grain: obj({ amount: num(0, 1), size: num(0, 10), roughness: num(0, 1) }),
};
const fullTransformSchema = { ...transformSchema, required: ["position", "scale", "rotation", "anchor", "opacity"] };
export const AUDIO_EDIT_PARAM_SCHEMAS: Record<string, EditSchema> = {
  gain: obj({ value: num(0, 4) }), pan: obj({ value: num(-1, 1) }),
  eq: obj({ bands: arr(obj({ type: en(["lowshelf", "highshelf", "peaking", "lowpass", "highpass", "notch"]), frequency: num(20, 20000), gain: num(-24, 24), q: num(0.1, 18) }, ["type", "frequency", "gain", "q"]), 32) }),
  compressor: obj({ threshold: num(-60, 0), ratio: num(1, 20), attack: num(0.001, 1), release: num(0.01, 3), knee: num(0, 40), makeupGain: num(0, 24) }),
  reverb: obj({ roomSize: num(0, 1), damping: num(0, 1), wetLevel: num(0, 1), dryLevel: num(0, 1), preDelay: num(0, 100) }),
  delay: obj({ time: num(0, 2), feedback: num(0, 0.95), wetLevel: num(0, 1), sync: bool }),
  noiseReduction: obj({ threshold: num(-60, 0), reduction: num(0, 1), attack: num(0, 100), release: num(0, 500), focus: en(["balanced", "speech", "whiteNoise", "music", "heavy", "wind", "hum"]) }),
  fadeIn: obj({ duration: time, curve: en(["linear", "exponential", "logarithmic", "s-curve"]) }),
  fadeOut: obj({ duration: time, curve: en(["linear", "exponential", "logarithmic", "s-curve"]) }),
};
export const audioParamsSchema = obj(Object.fromEntries(Object.entries(Object.assign({}, ...Object.values(AUDIO_EDIT_PARAM_SCHEMAS).map((schema) => schema.properties))).map(([key, schema]) => [key, (schema as EditSchema).type === "number" ? num() : schema as EditSchema])));
export const transitionParamsSchema = obj({ direction: en(["left", "right", "up", "down", "diagonal", "vertical", "horizontal"]), axis: en(["x", "y"]), orientation: en(["vertical", "horizontal"]), clockwise: bool, center: pair, softness: num(0, 1), intensity: num(0, 10), blurIntensity: num(0, 100), holdDuration: num(0, 30), maxPixelSize: num(1, 1000), count: num(1, 100), slices: num(1, 100), rotations: num(-20, 20), scale: num(0.01, 100), startAngle: num(-360, 360), warmth: num(0, 1), pushOut: bool, curve: en(["linear", "ease-in", "ease-out", "ease-in-out"]) });
export const effectSchema = obj({ id, type: en(videoEffects), params: numericParams, enabled: bool }, ["id", "type", "params", "enabled"]);
const audioEffectSchema = obj({ id, type: en(AUDIO_EFFECT_TYPES), params: audioParamsSchema, enabled: bool }, ["id", "type", "params", "enabled"]);
export const keyframeSchema = obj({ id, time, property: en(["position.x", "position.y", "scale.x", "scale.y", "rotation", "opacity", "volume"]), value: num(), easing: en(EASING_TYPES) }, ["id", "time", "property", "value", "easing"]);
export const textStyleSchema = obj({ fontFamily: { ...str, maxLength: 200, pattern: "^[a-zA-Z0-9 ,_-]+$" }, fontSize: num(1, 1000), fontWeight: { enum: [100, 200, 300, 400, 500, 600, 700, 800, 900, "normal", "bold"] }, fontStyle: en(["normal", "italic"]), color: str, backgroundColor: str, strokeColor: str, strokeWidth: num(0, 100), shadowColor: str, shadowBlur: num(0, 100), shadowOffsetX: num(), shadowOffsetY: num(), textAlign: en(["left", "center", "right", "justify"]), verticalAlign: en(["top", "middle", "bottom"]), lineHeight: num(0.1, 10), letterSpacing: num(-100, 100), textDecoration: en(["none", "underline", "line-through", "overline"]) });
const clipSchema = obj({ id, mediaId: id, trackId: id, startTime: time, duration: num(0.001, 86400), inPoint: time, outPoint: time, effects: arr(effectSchema, 100), audioEffects: arr(audioEffectSchema, 100), transform: fullTransformSchema, volume: num(0, 4), fade: obj({ fadeIn: time, fadeOut: time }, ["fadeIn", "fadeOut"]), keyframes: arr(keyframeSchema), speed: num(0.1, 16), reversed: bool, pitchCorrection: bool }, ["id", "mediaId", "trackId", "startTime", "duration", "inPoint", "outPoint", "effects", "audioEffects", "transform", "volume", "keyframes"]);
export const transitionSchema = obj({ id, type: en(TRANSITION_TYPES), clipAId: id, clipBId: id, duration: num(0.001, 30), params: transitionParamsSchema, edge: en(["in", "out"]) }, ["id", "type", "clipAId", "duration", "params"]);
const metadataSchema = obj({ duration: time, width: num(0, 8192), height: num(0, 8192), frameRate: num(0, 240), codec: str, sampleRate: num(0, 192000), channels: num(0, 8), fileSize: num(0, 1e12), audioTrackCount: num(0, 64), hasVideo: bool, hasAudio: bool }, ["duration", "width", "height", "frameRate", "codec", "sampleRate", "channels", "fileSize"]);
const sourceSchema = obj({ name: str, size: num(0, 1e12), lastModified: num(0, 1e15) }, ["name", "size", "lastModified"]);
const mediaSchema = obj({ id, name: str, type: en(["video", "audio", "image"]), metadata: metadataSchema, sourceFile: sourceSchema }, ["id", "name", "type", "metadata"]);
export const settingsSchema = obj({ width: num(16, 8192), height: num(16, 8192), frameRate: num(1, 120), sampleRate: num(8000, 192000), channels: num(1, 8) }, ["width", "height", "frameRate", "sampleRate", "channels"]);
const subtitleStyle = obj({ fontFamily: str, fontSize: num(1, 1000), color: str, backgroundColor: str, position: en(["top", "center", "bottom"]), highlightColor: str, upcomingColor: str });
const projectSchema = obj({ id, name: str, settings: settingsSchema, media: arr(mediaSchema), timeline: obj({ tracks: arr(obj({ id, name: str, type: en(["video", "audio", "image", "text", "graphics"]), mode: en(["standard"]), role: en(["general", "captions", "dialogue", "music", "effects", "ambience"]), groupId: id, locked: bool, hidden: bool, muted: bool, solo: bool, clips: arr(clipSchema), transitions: arr(transitionSchema) }, ["id", "name", "type", "locked", "hidden", "muted", "solo", "clips", "transitions"]), 100), subtitles: arr(obj({ id, text: str, startTime: time, endTime: time, style: subtitleStyle }, ["id", "text", "startTime", "endTime"])), markers: arr(obj({ id, time, label: str, color: str }, ["id", "time", "label", "color"])), duration: time, backgroundFillMode: en(["color", "blur"]), layoutBackgroundColor: str }, ["tracks", "subtitles", "markers", "duration"]), textClips: arr(obj({ id, trackId: id, text: str, startTime: time, duration: num(0.001, 86400), style: { ...textStyleSchema, required: ["fontFamily", "fontSize", "fontWeight", "fontStyle", "color", "textAlign", "verticalAlign", "lineHeight", "letterSpacing"] }, transform: fullTransformSchema, keyframes: arr(keyframeSchema) }, ["id", "trackId", "text", "startTime", "duration", "style", "transform", "keyframes"])) }, ["id", "name", "settings", "media", "timeline", "textClips"]);
export const portableEditSchema = obj({ format: { enum: [EDIT_FORMAT] }, version: { enum: [EDIT_VERSION] }, project: projectSchema }, ["format", "version", "project"]);

export interface PortableEdit {
  format: typeof EDIT_FORMAT;
  version: typeof EDIT_VERSION;
  project: Pick<Project, "id" | "name" | "settings" | "timeline"> & { media: Array<Pick<MediaItem, "id" | "name" | "type" | "metadata" | "sourceFile">>; textClips: NonNullable<Project["textClips"]> };
}

export function validatePortableEdit(doc: unknown): asserts doc is PortableEdit {
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
      if (Math.abs(clip.duration - (clip.outPoint - clip.inPoint) / (clip.speed ?? 1)) > 0.05) throw new Error(`Clip ${clip.id}: duration does not match source range and speed`);
      if (clip.fade && (clip.fade.fadeIn > clip.duration || clip.fade.fadeOut > clip.duration)) throw new Error(`Clip ${clip.id}: audio fade exceeds clip duration`);
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

export function parsePortableEdit(json: string): PortableEdit {
  if (json.length > 5_000_000) throw new Error("Edit JSON exceeds the 5 MB limit");
  const doc = JSON.parse(json) as PortableEdit & { project: PortableEdit["project"] & { assets?: PortableEdit["project"]["media"] } };
  // v1 named the local media references `assets`. No instructions are migrated.
  if (doc?.format === EDIT_FORMAT && (doc.version as number) === 1 && doc.project?.assets) {
    doc.project.media = doc.project.assets;
    delete doc.project.assets;
    doc.version = EDIT_VERSION;
  }
  validatePortableEdit(doc);
  return doc;
}

export function createPortableEdit(project: Project): PortableEdit {
  for (const key of ["shapeClips", "svgClips", "stickerClips", "adjustmentLayers", "masks", "multicamGroups", "compoundClips", "nestedInstances", "motionCompositions", "motionInstances", "generatedShaders"] as const) {
    if (project[key]?.length) throw new Error(`Portable edits do not yet support ${key}; use the ordinary project format to retain them`);
  }
  if (project.creation) throw new Error("Portable edits do not yet support creation scenes");
  const doc = JSON.parse(JSON.stringify({ format: EDIT_FORMAT, version: EDIT_VERSION, project: { id: project.id, name: project.name, settings: project.settings, timeline: project.timeline, textClips: project.textClips ?? [], media: project.mediaLibrary.items.map((m) => ({ id: m.id, name: m.name, type: m.type, metadata: m.metadata, ...(m.sourceFile ? { sourceFile: { name: m.sourceFile.name, size: m.sourceFile.size, lastModified: m.sourceFile.lastModified } } : {}) })) } })) as PortableEdit;
  validatePortableEdit(doc);
  return doc;
}

export function materializePortableEdit(doc: PortableEdit, current: Project): { project: Project; missing: string[] } {
  validatePortableEdit(doc);
  const missing: string[] = [];
  const items: MediaItem[] = doc.project.media.map((ref) => {
    const candidates = current.mediaLibrary.items.filter((m) => m.type === ref.type && m.blob && (m.id === ref.id || ref.sourceFile && m.sourceFile?.name === ref.sourceFile.name && m.sourceFile.size === ref.sourceFile.size));
    const exact = candidates.find((m) => m.id === ref.id);
    const found = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!found) missing.push(ref.id);
    return { ...ref, metadata: found?.metadata ?? ref.metadata, fileHandle: found?.fileHandle ?? null, blob: found?.blob ?? null, thumbnailUrl: found?.thumbnailUrl ?? null, waveformData: found?.waveformData ?? null, filmstripThumbnails: found?.filmstripThumbnails, isPlaceholder: !found };
  });
  const duration = Math.max(0, ...doc.project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.startTime + c.duration)), ...doc.project.textClips.map((c) => c.startTime + c.duration), ...doc.project.timeline.subtitles.map((s) => s.endTime));
  const project = { ...current, name: doc.project.name, settings: doc.project.settings, timeline: { ...doc.project.timeline, duration }, textClips: doc.project.textClips, mediaLibrary: { items }, shapeClips: [], svgClips: [], stickerClips: [], adjustmentLayers: [], masks: [], multicamGroups: [], compoundClips: [], nestedInstances: [], motionCompositions: [], motionInstances: [], generatedShaders: [], creation: undefined };
  createPortableEdit(project);
  return { project, missing };
}

export interface EditPreset { format: "openreel-preset"; version: 1; name: string; effects: Project["timeline"]["tracks"][number]["clips"][number]["effects"]; transition?: { type: string; duration: number; params: Record<string, unknown> } }
export const presetSchema = obj({ format: { enum: ["openreel-preset"] }, version: { enum: [1] }, name: str, effects: arr(effectSchema, 100), transition: obj({ type: en(TRANSITION_TYPES), duration: num(0.001, 30), params: transitionParamsSchema }, ["type", "duration", "params"]) }, ["format", "version", "name", "effects"]);
export function parseEditPreset(json: string): EditPreset { if (json.length > 100000) throw new Error("Preset exceeds 100 KB"); const preset: unknown = JSON.parse(json); validateEditJSON(preset, presetSchema); const result = preset as EditPreset; result.effects.forEach((effect) => validateEditJSON(effect.params, VIDEO_EDIT_PARAM_SCHEMAS[effect.type])); if (!result.effects.length && !result.transition) throw new Error("A preset must contain an effect or transition"); return result; }
