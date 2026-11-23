import { fpsOf, makeFrameRate, resolveFrameRate, secondsToFrames, type FrameRate } from "./timecode";
import type {
  SeqClipMarker,
  InterchangeReport,
  Sequence,
  SeqClip,
  SeqMarker,
  SeqMedia,
  SeqTrack,
  SeqTransition,
  SeqTransitionKind,
} from "./model";
import { TRANSITION_NAMES, transitionTypeFromName } from "./transition-names";
import type { TransitionType } from "../types/effects";
import { MARKER_KINDS, type MarkerKind } from "../types/timeline";
import { nearestMarkerColorName } from "./marker-export";

/**
 * OpenTimelineIO (.otio JSON). Written with the current core schemas
 * (Timeline.1, Stack.1, Track.1, Clip.2, Gap.1, Transition.1, Marker.2,
 * ExternalReference.1, LinearTimeWarp.1); read accepts Clip.1 / Clip.2 and
 * ExternalReference / MissingReference. OpenReel-only facts that OTIO has no
 * field for (opacity, level, sync lock, targeting, link ids, exact out points)
 * live under `metadata.openreel`, which every OTIO tool preserves.
 */

export const OTIO_NAMESPACE = "openreel";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const rt = (value: number, rate: number): JsonObject => ({
  OTIO_SCHEMA: "RationalTime.1",
  rate,
  value,
});
const range = (start: JsonObject, duration: JsonObject): JsonObject => ({
  OTIO_SCHEMA: "TimeRange.1",
  duration,
  start_time: start,
});

const markerJson = (m: SeqMarker, rate: number): JsonObject => {
  const meta: JsonObject = {};
  if (m.color) meta.color = m.color;
  if (m.kind) meta.kind = m.kind;
  return {
    OTIO_SCHEMA: "Marker.2",
    name: m.name,
    color: m.color ? nearestMarkerColorName(m.color) : "RED",
    comment: m.comment ?? "",
    marked_range: range(rt(m.frame, rate), rt(m.durationFrames ?? 0, rate)),
    metadata: Object.keys(meta).length ? { [OTIO_NAMESPACE]: meta } : {},
  };
};

/** A clip / master-clip marker: `sec` is source-media time, so it is written in the media's own rate. */
const clipMarkerJson = (m: SeqClipMarker, rate: number): JsonObject => {
  const meta: JsonObject = { scope: "clip" };
  if (m.color) meta.color = m.color;
  if (m.kind) meta.kind = m.kind;
  return {
    OTIO_SCHEMA: "Marker.2",
    name: m.name,
    color: m.color ? nearestMarkerColorName(m.color) : "RED",
    comment: m.comment ?? "",
    marked_range: range(rt(Math.round(m.sec * rate), rate), rt(Math.round((m.durationSec ?? 0) * rate), rate)),
    metadata: { [OTIO_NAMESPACE]: meta },
  };
};

const TRANSITION_TYPE: Record<SeqTransitionKind, string> = {
  dissolve: "SMPTE_Dissolve",
  dipToBlack: "Custom_Transition",
  dipToWhite: "Custom_Transition",
  wipe: "Custom_Transition",
  push: "Custom_Transition",
  slide: "Custom_Transition",
};

const KIND_BY_NAME: Record<string, SeqTransitionKind> = {
  dissolve: "dissolve",
  dipToBlack: "dipToBlack",
  dipToWhite: "dipToWhite",
  wipe: "wipe",
  push: "push",
  slide: "slide",
};

const ratio = (r: FrameRate): number => r.num / r.den;

// ── serialize ──────────────────────────────────────────────────────────────

export function serializeOtio(input: Sequence): string {
  // One sequence's tracks as OTIO Tracks. A nested sequence recurses: it becomes a Stack
  // (OTIO's own nesting) of its tracks, in its own rate and media.
  const buildTracks = (seq: Sequence): Json[] => {
  const seqFps = ratio(seq.rate);
  const mediaByKey = new Map(seq.media.map((m) => [m.key, m]));

  const mediaRef = (media: SeqMedia): JsonObject => ({
    OTIO_SCHEMA: "ExternalReference.1",
    name: media.name,
    target_url: media.pathUrl ?? media.name,
    available_range: range(
      rt(0, ratio(media.rate)),
      rt(secondsToFrames(media.durationSec, media.rate), ratio(media.rate)),
    ),
    available_image_bounds: null,
    metadata: {
      [OTIO_NAMESPACE]: {
        key: media.key,
        kind: media.kind,
        width: media.width,
        height: media.height,
        hasVideo: media.hasVideo,
        hasAudio: media.hasAudio,
        sampleRate: media.sampleRate,
        channels: media.channels,
      },
    },
  });

  const retimeEffects = (clip: SeqClip): Json[] =>
    clip.speed !== 1 || clip.reversed
      ? [{
          OTIO_SCHEMA: "LinearTimeWarp.1",
          name: "",
          effect_name: "LinearTimeWarp",
          time_scalar: clip.speed * (clip.reversed ? -1 : 1),
          metadata: {},
        }]
      : [];

  const nestJson = (clip: SeqClip, nested: Sequence, linkId: string | undefined): JsonObject => {
    const nestedFps = ratio(nested.rate);
    return {
      OTIO_SCHEMA: "Stack.1",
      name: clip.name,
      children: buildTracks(nested),
      // Same convention as a media clip: start in the nested sequence's time, duration in the parent's.
      source_range: range(rt(secondsToFrames(clip.inSec, nested.rate), nestedFps), rt(clip.endFrame - clip.startFrame, seqFps)),
      effects: retimeEffects(clip),
      markers: nested.markers.map((m) => markerJson(m, nestedFps)),
      enabled: true,
      metadata: {
        [OTIO_NAMESPACE]: {
          id: clip.id,
          ...(linkId ? { linkId } : {}),
          nestedSequence: {
            ...(nested.id ? { id: nested.id } : {}),
            name: nested.name,
            rate: { timebase: nested.rate.timebase, ntsc: nested.rate.ntsc, dropFrame: nested.rate.dropFrame },
            width: nested.width,
            height: nested.height,
          },
          outFrames: secondsToFrames(clip.outSec, nested.rate),
          speed: clip.speed,
          reversed: clip.reversed,
          opacity: clip.opacity,
          volume: clip.volume,
        },
      },
    };
  };

  const clipJson = (clip: SeqClip, kind: "video" | "audio", linkId: string | undefined): JsonObject | null => {
    if (clip.nested) return nestJson(clip, clip.nested, linkId);
    const media = mediaByKey.get(clip.mediaKey);
    if (!media) return null;
    const mrate = ratio(media.rate);
    const inFrames = secondsToFrames(clip.inSec, media.rate);
    const outFrames = secondsToFrames(clip.outSec, media.rate);
    const effects = retimeEffects(clip);
    return {
      OTIO_SCHEMA: "Clip.2",
      name: clip.name,
      // start in media time; duration in timeline time (OTIO items lay out by this duration)
      source_range: range(rt(inFrames, mrate), rt(clip.endFrame - clip.startFrame, seqFps)),
      media_references: { DEFAULT_MEDIA: mediaRef(media) },
      active_media_reference_key: "DEFAULT_MEDIA",
      effects,
      markers: (clip.markers ?? []).map((m) => clipMarkerJson(m, mrate)),
      enabled: true,
      metadata: {
        [OTIO_NAMESPACE]: {
          id: clip.id,
          ...(linkId ? { linkId } : {}),
          mediaKey: media.key,
          outFrames,
          speed: clip.speed,
          reversed: clip.reversed,
          ...(kind === "video" ? { opacity: clip.opacity } : {}),
          volume: clip.volume,
        },
      },
    };
  };

  const trackJson = (track: SeqTrack, kind: "video" | "audio", extraMeta: JsonObject = {}): JsonObject => {
    const children: Json[] = [];
    const clips = [...track.clips].sort((a, b) => a.startFrame - b.startFrame);
    let cursor = 0;
    const emitted = new Map<SeqClip, number>(); // clip -> index in children
    for (const clip of clips) {
      const start = Math.max(clip.startFrame, cursor);
      if (start > cursor) {
        children.push({
          OTIO_SCHEMA: "Gap.1",
          name: "",
          source_range: range(rt(0, seqFps), rt(start - cursor, seqFps)),
          effects: [],
          markers: [],
          enabled: true,
          metadata: {},
        });
      }
      const linkId = kind === "video" || extraMeta.linkedAudioOf !== undefined ? `link-${clip.id}` : undefined;
      const json = clipJson(clip, kind, linkId);
      if (!json) continue;
      emitted.set(clip, children.length);
      children.push(json);
      cursor = start + (clip.endFrame - clip.startFrame);
    }
    // Transitions sit between the clips they join; insert back to front to keep indexes valid.
    const placed: { index: number; json: JsonObject }[] = [];
    for (const tr of track.transitions) {
      const cut = tr.startFrame + Math.floor((tr.endFrame - tr.startFrame) / 2);
      const a = clips.find((c) => emitted.has(c) && Math.abs(c.endFrame - cut) <= 1);
      const b = clips.find((c) => emitted.has(c) && Math.abs(c.startFrame - cut) <= 1 && c !== a);
      if (!a || !b) continue;
      const ai = emitted.get(a)!;
      const bi = emitted.get(b)!;
      if (bi !== ai + 1) continue;
      placed.push({
        index: bi,
        json: {
          OTIO_SCHEMA: "Transition.1",
          name: (tr.type && TRANSITION_NAMES[tr.type]?.name) || tr.kind,
          transition_type: tr.type ? "Custom_Transition" : TRANSITION_TYPE[tr.kind],
          in_offset: rt(cut - tr.startFrame, seqFps),
          out_offset: rt(tr.endFrame - cut, seqFps),
          metadata: { [OTIO_NAMESPACE]: { kind: tr.kind, ...(tr.type ? { type: tr.type } : {}), alignment: tr.alignment } },
        },
      });
    }
    placed.sort((x, y) => y.index - x.index).forEach((p) => children.splice(p.index, 0, p.json));
    return {
      OTIO_SCHEMA: "Track.1",
      name: track.name,
      kind: kind === "video" ? "Video" : "Audio",
      children,
      source_range: null,
      effects: [],
      markers: [],
      enabled: !track.disabled,
      metadata: {
        [OTIO_NAMESPACE]: {
          locked: track.locked,
          ...(track.syncLock !== undefined ? { syncLock: track.syncLock } : {}),
          ...(track.targeted !== undefined ? { targeted: track.targeted } : {}),
          ...extraMeta,
        },
      },
    };
  };

  const videoTracks = seq.tracks.filter((t) => t.kind === "video");
  const realAudio = seq.tracks.filter((t) => t.kind === "audio");
  const tracksJson: Json[] = videoTracks.map((t) => trackJson(t, "video"));
  for (const vt of videoTracks) {
    // A nest's audio lives inside its Stack, so only media clips get a synthesized linked audio track.
    const carrying = vt.clips.filter((c) => c.withAudio && !c.nested);
    if (carrying.length === 0) continue;
    tracksJson.push(
      trackJson(
        { ...vt, kind: "audio", name: `${vt.name} audio`, clips: carrying, transitions: [], targeted: undefined },
        "audio",
        { linkedAudioOf: vt.name },
      ),
    );
  }
  for (const t of realAudio) tracksJson.push(trackJson(t, "audio"));
  return tracksJson;
  };

  const seq = input;
  const seqFps = ratio(seq.rate);
  const tracksJson = buildTracks(seq);
  const markers: Json[] = seq.markers.map((m) => markerJson(m, seqFps));

  const root: JsonObject = {
    OTIO_SCHEMA: "Timeline.1",
    name: seq.name,
    global_start_time: rt(0, seqFps),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      children: tracksJson,
      source_range: null,
      effects: [],
      markers,
      enabled: true,
      metadata: {},
    },
    metadata: {
      [OTIO_NAMESPACE]: {
        rate: { timebase: seq.rate.timebase, ntsc: seq.rate.ntsc, dropFrame: seq.rate.dropFrame },
        width: seq.width,
        height: seq.height,
      },
    },
  };
  return `${JSON.stringify(root, null, 2)}\n`;
}

// ── structural validation (OTIO has no DTD; this checks the schema contract) ──

const isObj = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const schemaName = (v: unknown): string => (isObj(v) && typeof v.OTIO_SCHEMA === "string" ? v.OTIO_SCHEMA.split(".")[0] : "");

/** Returns a list of structural problems; empty means the document satisfies the OTIO core schema contract. */
export function validateOtio(text: string): string[] {
  const problems: string[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return [`not valid JSON: ${(e as Error).message}`];
  }
  const checkTime = (v: unknown, where: string): void => {
    if (!isObj(v) || schemaName(v) !== "RationalTime" || typeof v.value !== "number" || typeof v.rate !== "number" || v.rate <= 0) {
      problems.push(`${where} is not a RationalTime with numeric value and positive rate`);
    }
  };
  const checkRange = (v: unknown, where: string): void => {
    if (!isObj(v) || schemaName(v) !== "TimeRange") {
      problems.push(`${where} is not a TimeRange`);
      return;
    }
    checkTime(v.start_time, `${where}.start_time`);
    checkTime(v.duration, `${where}.duration`);
  };
  if (schemaName(doc) !== "Timeline") return ["root is not a Timeline"];
  const tl = doc as JsonObject;
  if (typeof tl.name !== "string") problems.push("Timeline.name must be a string");
  const stack = tl.tracks;
  if (schemaName(stack) !== "Stack") return [...problems, "Timeline.tracks is not a Stack"];
  const kids = (stack as JsonObject).children;
  if (!Array.isArray(kids)) return [...problems, "Stack.children must be an array"];
  kids.forEach((track, ti) => {
    const tw = `tracks[${ti}]`;
    if (schemaName(track) !== "Track") {
      problems.push(`${tw} is not a Track`);
      return;
    }
    const t = track as JsonObject;
    if (t.kind !== "Video" && t.kind !== "Audio") problems.push(`${tw}.kind must be "Video" or "Audio"`);
    if (!Array.isArray(t.children)) {
      problems.push(`${tw}.children must be an array`);
      return;
    }
    const items = t.children;
    items.forEach((item, ii) => {
      const iw = `${tw}.children[${ii}]`;
      const name = schemaName(item);
      const o = item as JsonObject;
      if (name === "Clip") {
        checkRange(o.source_range, `${iw}.source_range`);
        const refs = isObj(o.media_references) ? o.media_references : isObj(o.media_reference) ? { DEFAULT: o.media_reference } : null;
        if (!refs) problems.push(`${iw} has no media reference`);
        else {
          for (const [k, ref] of Object.entries(refs)) {
            const rn = schemaName(ref);
            if (rn === "ExternalReference") {
              if (typeof (ref as JsonObject).target_url !== "string") problems.push(`${iw}.media_references.${k}.target_url missing`);
              if ((ref as JsonObject).available_range) checkRange((ref as JsonObject).available_range, `${iw}.media_references.${k}.available_range`);
            } else if (rn !== "MissingReference" && rn !== "GeneratorReference") {
              problems.push(`${iw}.media_references.${k} has unsupported schema "${rn}"`);
            }
          }
          if (schemaName(o) === "Clip" && String(o.OTIO_SCHEMA).startsWith("Clip.2") && typeof o.active_media_reference_key !== "string") {
            problems.push(`${iw}.active_media_reference_key missing`);
          }
        }
      } else if (name === "Gap") {
        checkRange(o.source_range, `${iw}.source_range`);
      } else if (name === "Transition") {
        checkTime(o.in_offset, `${iw}.in_offset`);
        checkTime(o.out_offset, `${iw}.out_offset`);
        if (typeof o.transition_type !== "string") problems.push(`${iw}.transition_type missing`);
        const prev = schemaName(items[ii - 1]);
        const next = schemaName(items[ii + 1]);
        if (ii === 0 || ii === items.length - 1 || prev === "Transition" || next === "Transition") {
          problems.push(`${iw} must sit between two non-transition items`);
        }
      } else if (name !== "Stack" && name !== "Track") {
        problems.push(`${iw} has unsupported schema "${name}"`);
      }
      if (name === "Clip" || name === "Stack" || name === "Track") {
        const fx = Array.isArray(o.effects) ? o.effects : [];
        fx.forEach((effect, ei) => {
          if (schemaName(effect) !== "LinearTimeWarp") return;
          const scalar = (effect as JsonObject).time_scalar;
          if (typeof scalar !== "number" || !Number.isFinite(scalar) || scalar === 0) {
            problems.push(`${iw}.effects[${ei}].time_scalar must be a finite, non-zero number (negative plays backwards)`);
          }
        });
      }
      if (name === "Stack") {
        checkRange(o.source_range, `${iw}.source_range`);
        if (!Array.isArray(o.children) || o.children.some((c) => schemaName(c) !== "Track")) {
          problems.push(`${iw} (nested sequence) must contain Track items`);
        }
      }
    });
  });
  const markers = (stack as JsonObject).markers;
  if (markers !== undefined && !Array.isArray(markers)) problems.push("Stack.markers must be an array");
  (Array.isArray(markers) ? markers : []).forEach((m, i) => {
    if (schemaName(m) !== "Marker") problems.push(`markers[${i}] is not a Marker`);
    else checkRange((m as JsonObject).marked_range, `markers[${i}].marked_range`);
  });
  return problems;
}

// ── parse ──────────────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|tiff?|webp|heic|svg)$/i;
const AUDIO_EXT = /\.(wav|mp3|aac|m4a|flac|ogg|aif+|opus)$/i;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function timeRate(v: unknown): number | undefined {
  return isObj(v) ? num(v.rate) : undefined;
}
const seconds = (v: unknown): number | undefined => {
  if (!isObj(v)) return undefined;
  const value = num(v.value);
  const rate = num(v.rate);
  return value === undefined || !rate ? undefined : value / rate;
};

/** Last path segment of a target_url; tolerates Windows separators and malformed percent escapes. */
function fileNameOf(url: string): string {
  const last = url.split(/[?#]/)[0].split(/[\\/]/).pop() || url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function ownMeta(item: unknown): JsonObject {
  const meta = isObj(item) && isObj(item.metadata) ? item.metadata[OTIO_NAMESPACE] : undefined;
  return isObj(meta) ? meta : {};
}

const rateFromMeta = (value: unknown): FrameRate | undefined =>
  isObj(value) && num(value.timebase) ? makeFrameRate(num(value.timebase)!, value.ntsc === true, value.dropFrame === true) : undefined;

export function parseOtio(source: string): { sequence: Sequence; report: InterchangeReport } {
  const warnings: string[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(source);
  } catch (e) {
    throw new Error(`The OTIO file is not valid JSON: ${(e as Error).message}`);
  }
  let stack: JsonObject;
  let timeline: JsonObject | null = null;
  if (schemaName(doc) === "Timeline" && isObj((doc as JsonObject).tracks)) {
    timeline = doc as JsonObject;
    stack = (doc as JsonObject).tracks as JsonObject;
  } else if (schemaName(doc) === "Stack") {
    stack = doc as JsonObject;
  } else {
    throw new Error("This file is not an OpenTimelineIO timeline (expected a Timeline or Stack).");
  }
  const tlMeta = ownMeta(timeline);

  interface MutableMedia {
    key: string;
    name: string;
    pathUrl?: string;
    kind: SeqMedia["kind"];
    durationSec: number;
    rate: FrameRate;
    width: number;
    height: number;
    hasVideo: boolean;
    hasAudio: boolean;
    sampleRate: number;
    channels: number;
    /** The reference's available_range, used when a clip has no source_range. */
    available?: JsonObject;
  }
  const mediaMap = new Map<string, MutableMedia>();
  /** Nested sequences by the OpenReel sequence id they were written from, so every instance shares one definition. */
  const nestById = new Map<string, Sequence>();

  interface ParsedClip {
    clip: SeqClip;
    linkId?: string;
  }
  interface ParsedTrack {
    track: SeqTrack;
    parsed: ParsedClip[];
    linkedAudioOf?: string;
  }

  /** One sequence from a Stack's Tracks: the file's own timeline, or (recursively) a nested Stack. */
  function buildSequence(args: {
    name: string;
    stack: JsonObject;
    meta: JsonObject;
    id?: string;
    parentRate?: FrameRate;
    width: number;
    height: number;
    startRate?: unknown;
  }): Sequence {
    const { stack: stackEl, meta: seqMeta } = args;
    // Sequence rate: ours if present, else the first video duration's rate, else any rate seen.
    const trackItems = arr(stackEl.children).filter((c): c is JsonObject => isObj(c) && schemaName(c) === "Track");
    const firstRate = (kind: string): number | undefined => {
      for (const t of trackItems) {
        if (str(t.kind)?.toLowerCase() !== kind) continue;
        for (const item of arr(t.children)) {
          const r = isObj(item) ? timeRate(isObj(item.source_range) ? item.source_range.duration : undefined) : undefined;
          if (r) return r;
        }
      }
      return undefined;
    };
    const rate: FrameRate =
      rateFromMeta(seqMeta.rate) ??
      resolveFrameRate(firstRate("video") ?? firstRate("audio") ?? timeRate(args.startRate) ?? (args.parentRate ? ratio(args.parentRate) : 24));
    const fps = fpsOf(rate);
    const toFrames = (time: unknown): number => {
      const s = seconds(time);
      return s === undefined ? 0 : Math.round(s * fps + 1e-9);
    };
    const width = num(seqMeta.width) ?? args.width;
    const height = num(seqMeta.height) ?? args.height;
    const used = new Map<string, MutableMedia>();

    const mediaFor = (clip: JsonObject, trackKind: "video" | "audio"): MutableMedia | null => {
      const refs = isObj(clip.media_references) ? clip.media_references : null;
      const activeKey = str(clip.active_media_reference_key) ?? "DEFAULT_MEDIA";
      const ref = refs ? (refs[activeKey] ?? Object.values(refs)[0]) : clip.media_reference;
      if (!isObj(ref)) return null;
      const refMeta = ownMeta(ref);
      const url = str(ref.target_url);
      const name = str(ref.name) || (url ? fileNameOf(url) : str(clip.name) ?? "Media");
      const key = str(refMeta.key) ?? url ?? name;
      const available = isObj(ref.available_range) ? ref.available_range : null;
      const mrateRaw = timeRate(available?.start_time) ?? timeRate(isObj(clip.source_range) ? clip.source_range.start_time : undefined);
      const mrate = mrateRaw ? resolveFrameRate(mrateRaw) : rate;
      const existing = mediaMap.get(key);
      if (existing) {
        if (!str(refMeta.kind)) {
          if (trackKind === "video") existing.hasVideo = true;
          else existing.hasAudio = true;
        }
        return existing;
      }
      const kindMeta = str(refMeta.kind);
      const kind: SeqMedia["kind"] =
        kindMeta === "video" || kindMeta === "audio" || kindMeta === "image"
          ? kindMeta
          : IMAGE_EXT.test(name)
            ? "image"
            : trackKind === "audio" || AUDIO_EXT.test(name)
              ? "audio"
              : "video";
      const media: MutableMedia = {
        key,
        name,
        pathUrl: url,
        kind,
        durationSec: seconds(available?.duration) ?? 0,
        rate: mrate,
        width: num(refMeta.width) ?? width,
        height: num(refMeta.height) ?? height,
        hasVideo: typeof refMeta.hasVideo === "boolean" ? refMeta.hasVideo : kind !== "audio" && trackKind === "video",
        hasAudio: typeof refMeta.hasAudio === "boolean" ? refMeta.hasAudio : kind === "audio" || trackKind === "audio",
        sampleRate: num(refMeta.sampleRate) ?? 48000,
        channels: num(refMeta.channels) ?? 2,
        ...(available ? { available } : {}),
      };
      mediaMap.set(key, media);
      return media;
    };

    /** Retime of an item: OTIO's LinearTimeWarp (signed time_scalar); anything else is reported. */
    const retimeOf = (item: JsonObject, name: string, reversedMeta: boolean): { speed: number; reversed: boolean } => {
      let speed = 1;
      let reversed = reversedMeta;
      for (const fx of arr(item.effects)) {
        if (!isObj(fx)) continue;
        const fxSchema = schemaName(fx);
        if (fxSchema === "LinearTimeWarp") {
          const scalar = num(fx.time_scalar) ?? 1;
          if (scalar !== 0) {
            speed = Math.abs(scalar);
            if (scalar < 0) reversed = true;
          }
        } else {
          warnings.push(`Clip "${name}": effect "${str(fx.effect_name) ?? fxSchema}" is not imported.`);
        }
      }
      return { speed, reversed };
    };

    /** A Stack (or a bare Track) inside a track becomes a nested sequence of its own tracks. */
    const nestFrom = (item: JsonObject, schema: string): Sequence | null => {
      const nm = isObj(ownMeta(item).nestedSequence) ? (ownMeta(item).nestedSequence as JsonObject) : {};
      const nestedId = str(nm.id);
      const known = nestedId ? nestById.get(nestedId) : undefined;
      if (known) return known;
      const itemStack: JsonObject =
        schema === "Stack" ? item : { OTIO_SCHEMA: "Stack.1", name: str(item.name) ?? "Track", children: [item], markers: [], effects: [], metadata: {} };
      const nested = buildSequence({
        name: str(nm.name) ?? str(item.name) ?? "Nested Sequence",
        stack: itemStack,
        meta: nm,
        id: nestedId ? `otio:${nestedId}` : undefined,
        parentRate: rate,
        width,
        height,
      });
      if (nested.tracks.every((t) => t.clips.length === 0)) return null;
      if (nestedId) nestById.set(nestedId, nested);
      return nested;
    };

    const parseTrack = (t: JsonObject, kind: "video" | "audio", index: number): ParsedTrack => {
      const meta = ownMeta(t);
      const clips: ParsedClip[] = [];
      const transitions: SeqTransition[] = [];
      let cursor = 0;
      const trackName = str(t.name) || (kind === "video" ? `V${index + 1}` : `A${index + 1}`);
      for (const item of arr(t.children)) {
        if (!isObj(item)) continue;
        const schema = schemaName(item);
        if (schema === "Gap") {
          cursor += toFrames(isObj(item.source_range) ? item.source_range.duration : undefined);
        } else if (schema === "Transition") {
          const inOff = toFrames(item.in_offset);
          const outOff = toFrames(item.out_offset);
          if (inOff + outOff <= 0) continue;
          const tm = ownMeta(item);
          const typeName = str(item.transition_type) ?? "";
          const kindMeta = str(tm.kind);
          const kindOf: SeqTransitionKind | undefined =
            (kindMeta && KIND_BY_NAME[kindMeta]) ||
            (typeName === "SMPTE_Dissolve" ? "dissolve" : undefined);
          const typeMeta = str(tm.type);
          const named = typeMeta && TRANSITION_NAMES[typeMeta as keyof typeof TRANSITION_NAMES] ? (typeMeta as TransitionType) : transitionTypeFromName(str(item.name) ?? "");
          if (!kindOf && !named) warnings.push(`Transition "${typeName || str(item.name) || "custom"}" is not supported; imported as a cross dissolve.`);
          transitions.push({ kind: kindOf ?? "dissolve", ...(named ? { type: named } : {}), startFrame: cursor - inOff, endFrame: cursor + outOff, alignment: "center" });
        } else if (schema === "Clip") {
          const cm = ownMeta(item);
          const media = mediaFor(item, kind);
          // OTIO allows a null source_range: the clip then plays its whole available range.
          const itemRange = isObj(item.source_range) ? item.source_range : media?.available ?? null;
          const dur = toFrames(itemRange?.duration);
          const name = str(item.name) ?? media?.name ?? "Clip";
          if (!media) {
            warnings.push(`Clip "${name}" has no media reference and was skipped.`);
            cursor += dur;
            continue;
          }
          used.set(media.key, media);
          if (item.enabled === false) warnings.push(`Clip "${name}" is disabled in the source; it was imported enabled.`);
          if (arr(item.markers).length) warnings.push(`Clip "${name}" has clip markers, which are not imported.`);
          const { speed, reversed } = retimeOf(item, name, cm.reversed === true);
          const durFrames = Math.max(1, dur);
          const inSec = seconds(itemRange?.start_time) ?? 0;
          const outFrames = num(cm.outFrames);
          const outSec =
            outFrames !== undefined
              ? outFrames / ratio(media.rate)
              : inSec + (durFrames / fps) * speed;
          clips.push({
            clip: {
              id: str(cm.id) ?? `otio-${kind}-${index}-${clips.length}`,
              name,
              mediaKey: media.key,
              startFrame: cursor,
              endFrame: cursor + durFrames,
              inSec,
              outSec: Math.max(inSec, outSec),
              speed: num(cm.speed) ?? speed,
              reversed,
              opacity: num(cm.opacity) ?? 1,
              volume: num(cm.volume) ?? 1,
              withAudio: false,
            },
            linkId: str(cm.linkId),
          });
          cursor += durFrames;
        } else if (schema === "Stack" || schema === "Track") {
          const cm = ownMeta(item);
          const name = str(item.name) ?? schema;
          const nested = nestFrom(item, schema);
          const given = isObj(item.source_range) ? item.source_range : null;
          if (!nested) {
            warnings.push(`Nested sequence "${name}" on track ${trackName} has no clips and was skipped.`);
            cursor += toFrames(given?.duration);
            continue;
          }
          if (item.enabled === false) warnings.push(`Nested sequence "${name}" is disabled in the source; it was imported enabled.`);
          const nestedFps = fpsOf(nested.rate);
          // No source_range: the nest plays its whole length (the longest of its tracks).
          const dur = given
            ? toFrames(given.duration)
            : Math.round((nested.durationFrames / nestedFps) * fps + 1e-9);
          const durFrames = Math.max(1, dur);
          const inSec = given ? seconds(given.start_time) ?? 0 : 0;
          const { speed, reversed } = retimeOf(item, name, cm.reversed === true);
          const outFrames = num(cm.outFrames);
          const outSec = outFrames !== undefined ? outFrames / nestedFps : inSec + (durFrames / fps) * speed;
          clips.push({
            clip: {
              id: str(cm.id) ?? `otio-${kind}-${index}-${clips.length}`,
              name,
              mediaKey: "",
              startFrame: cursor,
              endFrame: cursor + durFrames,
              inSec,
              outSec: Math.max(inSec, outSec),
              speed: num(cm.speed) ?? speed,
              reversed,
              opacity: num(cm.opacity) ?? 1,
              volume: num(cm.volume) ?? 1,
              withAudio: kind === "video" && nested.tracks.some((nt) => nt.kind === "audio" && nt.clips.length > 0),
              nested,
            },
            linkId: str(cm.linkId),
          });
          cursor += durFrames;
        } else {
          warnings.push(`Unsupported item "${schema || "unknown"}" on track ${trackName} was skipped.`);
        }
      }
      return {
        track: {
          kind,
          name: trackName,
          clips: clips.map((c) => c.clip),
          transitions,
          disabled: t.enabled === false,
          locked: meta.locked === true,
          ...(typeof meta.syncLock === "boolean" ? { syncLock: meta.syncLock } : {}),
          ...(meta.targeted === true ? { targeted: true } : {}),
        },
        parsed: clips,
        linkedAudioOf: str(meta.linkedAudioOf),
      };
    };

    let vi = 0;
    let ai = 0;
    const parsedTracks: ParsedTrack[] = [];
    for (const t of trackItems) {
      const kind = str(t.kind)?.toLowerCase() === "audio" ? "audio" : "video";
      parsedTracks.push(parseTrack(t, kind, kind === "video" ? vi++ : ai++));
    }

    // Fold OpenReel's synthesized linked-audio tracks back into their video clips.
    const videoByLink = new Map<string, SeqClip>();
    for (const p of parsedTracks) {
      if (p.track.kind !== "video") continue;
      for (const c of p.parsed) if (c.linkId) videoByLink.set(c.linkId, c.clip);
    }
    const withAudio = new Map<SeqClip, number>();
    const absorbed = new Set<SeqClip>();
    for (const p of parsedTracks) {
      if (p.track.kind !== "audio" || p.linkedAudioOf === undefined) continue;
      for (const a of p.parsed) {
        const v = a.linkId ? videoByLink.get(a.linkId) : undefined;
        if (v && v.mediaKey === a.clip.mediaKey && v.startFrame === a.clip.startFrame && v.endFrame === a.clip.endFrame) {
          absorbed.add(a.clip);
          withAudio.set(v, a.clip.volume);
        }
      }
    }
    const tracks: SeqTrack[] = [];
    let audioCount = 0;
    for (const p of parsedTracks) {
      if (p.track.kind === "video") {
        tracks.push({
          ...p.track,
          clips: p.track.clips.map((c) => (withAudio.has(c) ? { ...c, withAudio: true, volume: withAudio.get(c) ?? c.volume } : c)),
        });
        continue;
      }
      const remaining = p.track.clips.filter((c) => !absorbed.has(c));
      if (remaining.length === 0 && p.track.clips.length > 0 && p.linkedAudioOf !== undefined) continue;
      audioCount++;
      tracks.push({ ...p.track, clips: remaining, name: p.linkedAudioOf !== undefined ? `A${audioCount}` : p.track.name });
    }

    const seqMarkers: SeqMarker[] = [];
    const pushMarkers = (list: unknown): void => {
      for (const m of arr(list)) {
        if (!isObj(m)) continue;
        const r = isObj(m.marked_range) ? m.marked_range : null;
        const frame = Math.max(0, toFrames(r?.start_time));
        const durationFrames = toFrames(r?.duration);
        const comment = str(m.comment);
        const meta = isObj(m.metadata) && isObj(m.metadata.openreel) ? m.metadata.openreel : null;
        const color = typeof meta?.color === "string" ? meta.color : undefined;
        const kind = typeof meta?.kind === "string" && (MARKER_KINDS as readonly string[]).includes(meta.kind) ? (meta.kind as MarkerKind) : undefined;
        seqMarkers.push({
          frame,
          name: str(m.name) ?? "",
          ...(durationFrames > 0 ? { durationFrames } : {}),
          ...(comment ? { comment } : {}),
          ...(color ? { color } : {}),
          ...(kind ? { kind } : {}),
        });
      }
    };
    pushMarkers(stackEl.markers);
    for (const t of trackItems) pushMarkers(t.markers);

    const maxEnd = tracks.reduce((m, t) => t.clips.reduce((x, c) => Math.max(x, c.endFrame), m), 0);
    return {
      ...(args.id ? { id: args.id } : {}),
      name: args.name,
      rate,
      width,
      height,
      durationFrames: maxEnd,
      tracks,
      markers: seqMarkers.sort((a, b) => a.frame - b.frame),
      media: [...used.values()].map(({ available: _available, ...m }) => m),
    };
  }

  if (arr(stack.effects).length) warnings.push("Effects on the top-level stack are not imported.");
  const sequence = buildSequence({
    name: str(timeline?.name) || "Imported Sequence",
    stack,
    meta: tlMeta,
    width: 1920,
    height: 1080,
    startRate: timeline?.global_start_time,
  });
  return { sequence, report: { warnings } };
}
