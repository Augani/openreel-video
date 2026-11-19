import {
  XmlWriter,
  child,
  childNumber,
  childText,
  childrenNamed,
  parseXml,
  type XmlElement,
} from "./xml";
import {
  fpsOf,
  framesToTimecode,
  timecodeToFrames,
  framesToSeconds,
  makeFrameRate,
  secondsToFrames,
  type FrameRate,
} from "./timecode";
import type {
  InterchangeReport,
  Sequence,
  SeqClip,
  SeqClipMarker,
  SeqMarker,
  SeqMedia,
  SeqMulticam,
  SeqMulticamAngle,
  SeqTrack,
  SeqTransition,
  SeqTransitionKind,
} from "./model";

/**
 * Final Cut Pro 7 XML (xmeml version 5) — the dialect Adobe Premiere Pro and
 * DaVinci Resolve import and export. One <sequence> per file.
 */

const bool = (v: boolean): string => (v ? "TRUE" : "FALSE");
const asBool = (text: string | undefined, fallback: boolean): boolean =>
  text === undefined ? fallback : text.toUpperCase() === "TRUE";

const TRANSITION_EFFECT: Record<SeqTransitionKind, { name: string; category: string }> = {
  dissolve: { name: "Cross Dissolve", category: "Dissolve" },
  dipToBlack: { name: "Dip to Black", category: "Dissolve" },
  dipToWhite: { name: "Dip to White", category: "Dissolve" },
  wipe: { name: "Band Wipe", category: "Wipe" },
  push: { name: "Push", category: "Slide" },
  slide: { name: "Slide", category: "Slide" },
};

export function transitionKindFromName(name: string): SeqTransitionKind | null {
  const n = name.toLowerCase();
  if (n.includes("dip to white") || n.includes("fade to white")) return "dipToWhite";
  if (n.includes("dip to black") || n.includes("fade to black") || n.includes("fade in") || n.includes("fade out"))
    return "dipToBlack";
  if (n.includes("dissolve") || n.includes("crossfade") || n.includes("cross fade")) return "dissolve";
  if (n.includes("wipe")) return "wipe";
  if (n.includes("push")) return "push";
  if (n.includes("slide")) return "slide";
  return null;
}

function writeRate(w: XmlWriter, rate: FrameRate): void {
  w.open("rate").leaf("timebase", rate.timebase).leaf("ntsc", bool(rate.ntsc)).close("rate");
}

const num = (value: number): string => String(Math.round(value * 1e6) / 1e6);

// ── serialize ──────────────────────────────────────────────────────────────

export function serializeXmeml(input: Sequence): string {
  const w = new XmlWriter();
  let sequenceCount = 1;
  /** Nested sequence (its own id, else the nest clip) -> the id of its <sequence>, so instances share one definition. */
  const nestSequenceIds = new Map<string, string>();
  const fileIds = new Map<string, string>();
  const writtenFiles = new Set<string>();
  const sourceFrames = (media: SeqMedia, seconds: number): number => secondsToFrames(seconds, media.rate);

  const fileId = (media: SeqMedia): string => {
    let id = fileIds.get(media.key);
    if (!id) {
      id = `file-${fileIds.size + 1}`;
      fileIds.set(media.key, id);
    }
    return id;
  };

  const writeFile = (media: SeqMedia): void => {
    const id = fileId(media);
    if (writtenFiles.has(id)) {
      w.empty("file", { id });
      return;
    }
    writtenFiles.add(id);
    w.open("file", { id });
    w.leaf("name", media.name);
    if (media.pathUrl) w.leaf("pathurl", media.pathUrl);
    writeRate(w, media.rate);
    w.leaf("duration", sourceFrames(media, media.durationSec));
    w.open("timecode");
    writeRate(w, media.rate);
    const startFrames = media.startSec ? sourceFrames(media, media.startSec) : 0;
    w.leaf("string", framesToTimecode(startFrames, media.rate)).leaf("frame", startFrames).leaf("displayformat", media.rate.dropFrame ? "DF" : "NDF");
    w.close("timecode");
    w.open("media");
    if (media.hasVideo) {
      w.open("video").open("samplecharacteristics");
      writeRate(w, media.rate);
      w.leaf("width", media.width).leaf("height", media.height);
      w.leaf("anamorphic", "FALSE").leaf("pixelaspectratio", "square").leaf("fielddominance", "none");
      w.close("samplecharacteristics").close("video");
    }
    if (media.hasAudio) {
      w.open("audio").open("samplecharacteristics");
      w.leaf("depth", 16).leaf("samplerate", media.sampleRate);
      w.close("samplecharacteristics");
      w.leaf("channelcount", media.channels);
      w.close("audio");
    }
    w.close("media");
    w.close("file");
  };

  const writeFilterParam = (
    id: string,
    name: string,
    value: string | number,
    min?: number,
    max?: number,
  ): void => {
    w.open("parameter", { authoringApp: "PremierePro" });
    w.leaf("parameterid", id).leaf("name", name);
    if (min !== undefined) w.leaf("valuemin", min);
    if (max !== undefined) w.leaf("valuemax", max);
    w.leaf("value", value);
    w.close("parameter");
  };

  const writeVideoFilters = (clip: SeqClip): void => {
    if (clip.speed !== 1 || clip.reversed) {
      w.open("filter").open("effect");
      w.leaf("name", "Time Remap").leaf("effectid", "timeremap");
      w.leaf("effectcategory", "motion").leaf("effecttype", "motion").leaf("mediatype", "video");
      writeFilterParam("variablespeed", "variablespeed", 0, 0, 1);
      writeFilterParam("speed", "speed", num(clip.speed * 100), -100000, 100000);
      writeFilterParam("reverse", "reverse", bool(clip.reversed));
      writeFilterParam("frameblending", "frameblending", "FALSE");
      w.close("effect").close("filter");
    }
    if (clip.opacity !== 1) {
      w.open("filter").open("effect");
      w.leaf("name", "Opacity").leaf("effectid", "opacity");
      w.leaf("effectcategory", "motion").leaf("effecttype", "motion").leaf("mediatype", "video");
      writeFilterParam("opacity", "opacity", num(clip.opacity * 100), 0, 100);
      w.close("effect").close("filter");
    }
  };

  /** Clip + master-clip markers as <marker> children of the clipitem; in/out are source frames of the media. */
  const writeClipMarkers = (clip: SeqClip, media: SeqMedia): void => {
    for (const m of clip.markers ?? []) {
      const inF = sourceFrames(media, m.sec);
      const outF = m.durationSec && m.durationSec > 0 ? sourceFrames(media, m.sec + m.durationSec) : -1;
      w.open("marker").leaf("name", m.name).leaf("comment", m.comment ?? "").leaf("in", inF).leaf("out", outF).close("marker");
    }
  };

  const writeAudioFilters = (clip: SeqClip): void => {
    if (clip.volume === 1) return;
    w.open("filter").open("effect");
    w.leaf("name", "Audio Levels").leaf("effectid", "audiolevels");
    w.leaf("effectcategory", "audiolevels").leaf("effecttype", "audiolevels").leaf("mediatype", "audio");
    writeFilterParam("level", "Level", num(clip.volume), 0, 3.98109);
    w.close("effect").close("filter");
  };

  const writeAudioRetime = (clip: SeqClip): void => {
    if (clip.speed === 1 && !clip.reversed) return;
    w.open("filter").open("effect");
    w.leaf("name", "Time Remap").leaf("effectid", "timeremap");
    w.leaf("effectcategory", "motion").leaf("effecttype", "motion").leaf("mediatype", "audio");
    writeFilterParam("speed", "speed", num(clip.speed * 100), -100000, 100000);
    writeFilterParam("reverse", "reverse", bool(clip.reversed));
    w.close("effect").close("filter");
  };

  /** The clipitem's nested <sequence>: in full the first time a nested sequence appears, an id reference afterwards. */
  const writeNestSequence = (clip: SeqClip, nested: Sequence): void => {
    const key = nested.id ?? `clip:${clip.id}`;
    const known = nestSequenceIds.get(key);
    if (known) {
      w.empty("sequence", { id: known });
      return;
    }
    const id = `sequence-${++sequenceCount}`;
    nestSequenceIds.set(key, id);
    writeSequence(nested, id);
  };

  /**
   * A multicam cut: the clipitem stays an ordinary clip of the active angle's file (any reader plays it),
   * and carries a <multiclip> naming every synchronised angle with its offset in the shared timeline and
   * which one is active. `offsetseconds` keeps sub-frame sync offsets exact; `syncoffset` is the same in frames.
   */
  const writeMulticam = (clip: SeqClip, seq: Sequence): void => {
    if (!clip.multicam) return;
    const mc = seq.multicam?.find((m) => m.id === clip.multicam?.sourceId);
    if (!mc) return;
    w.open("multiclip", { id: mc.id });
    w.leaf("name", mc.name).leaf("collapsed", "FALSE");
    writeRate(w, seq.rate);
    for (const angle of mc.angles) {
      const active = angle.id === clip.multicam.angleId;
      w.open("angle", { id: angle.id });
      w.leaf("name", angle.name);
      w.leaf("syncoffset", secondsToFrames(angle.offsetSec, seq.rate)).leaf("offsetseconds", num(angle.offsetSec));
      w.leaf("activevideo", bool(active)).leaf("activeaudio", bool(active && clip.withAudio));
      writeFile(angle.media);
      w.close("angle");
    }
    w.close("multiclip");
  };

  // A sequence element: the root one, or the one a nest clipitem carries (xmeml's nested sequence).
  const writeSequence = (seq: Sequence, sequenceId: string): void => {
  const mediaByKey = new Map(seq.media.map((m) => [m.key, m]));
  // Audio tracks: a synthesized track per video track that carries sound, then the real ones.
  interface AudioEntry {
    track: SeqTrack;
    /** For synthesized tracks: the video track index they pair with. */
    pairedVideo?: number;
  }
  const videoTracks = seq.tracks.filter((t) => t.kind === "video");
  const realAudio = seq.tracks.filter((t) => t.kind === "audio");
  const audioEntries: AudioEntry[] = [];
  videoTracks.forEach((vt, vi) => {
    const carrying = vt.clips.filter((c) => c.withAudio);
    if (carrying.length === 0) return;
    audioEntries.push({
      pairedVideo: vi,
      track: { ...vt, kind: "audio", name: `${vt.name} audio`, clips: carrying, transitions: [], targeted: false },
    });
  });
  for (const t of realAudio) audioEntries.push({ track: t });

  // Pre-compute link graph ids.
  const idPrefix = sequenceId === "sequence-1" ? "" : `${sequenceId}-`;
  const videoClipId = (vi: number, ci: number): string => `clipitem-${idPrefix}v${vi + 1}-${ci + 1}`;
  const audioClipId = (ai: number, ci: number): string => `clipitem-${idPrefix}a${ai + 1}-${ci + 1}`;
  const audioIndexOfLinked = new Map<string, { ai: number; ci: number }>();
  audioEntries.forEach((entry, ai) => {
    if (entry.pairedVideo === undefined) return;
    entry.track.clips.forEach((clip, ci) => audioIndexOfLinked.set(clip.id, { ai, ci }));
  });
  const videoIndexOfClip = new Map<string, { vi: number; ci: number }>();
  videoTracks.forEach((vt, vi) => vt.clips.forEach((c, ci) => videoIndexOfClip.set(c.id, { vi, ci })));

  const writeLink = (
    ref: string,
    mediatype: "video" | "audio",
    trackindex: number,
    clipindex: number,
    group?: number,
  ): void => {
    w.open("link").leaf("linkclipref", ref).leaf("mediatype", mediatype);
    w.leaf("trackindex", trackindex).leaf("clipindex", clipindex);
    if (group !== undefined) w.leaf("groupindex", group);
    w.close("link");
  };

  w.open("sequence", { id: sequenceId });
  w.leaf("name", seq.name).leaf("duration", seq.durationFrames);
  writeRate(w, seq.rate);
  for (const m of seq.markers) {
    w.open("marker").leaf("name", m.name).leaf("comment", m.comment ?? "").leaf("in", m.frame);
    w.leaf("out", m.durationFrames ? m.frame + m.durationFrames : -1).close("marker");
  }
  w.open("timecode");
  writeRate(w, seq.rate);
  const seqStart = (() => {
    if (!seq.startTimecode) return 0;
    try {
      return timecodeToFrames(seq.startTimecode, seq.rate);
    } catch {
      return 0;
    }
  })();
  w.leaf("string", framesToTimecode(seqStart, seq.rate)).leaf("frame", seqStart);
  w.leaf("displayformat", seq.rate.dropFrame ? "DF" : "NDF");
  w.close("timecode");
  w.open("media");

  w.open("video");
  w.open("format").open("samplecharacteristics");
  writeRate(w, seq.rate);
  w.leaf("width", seq.width).leaf("height", seq.height);
  w.leaf("anamorphic", "FALSE").leaf("pixelaspectratio", "square").leaf("fielddominance", "none");
  w.close("samplecharacteristics").close("format");
  const anyTargeted = seq.tracks.some((t) => t.targeted === true);
  /** Premiere's own per-track attribute; written only when the source tracked targeting. */
  const trackAttrs = (t: SeqTrack): Record<string, string> | undefined =>
    anyTargeted ? { "MZ.TrackTargeted": t.targeted ? "1" : "0" } : undefined;
  videoTracks.forEach((track, vi) => {
    w.open("track", trackAttrs(track));
    // Clips and transitions interleaved in time order, like Premiere writes them.
    type Item = { at: number; write: () => void };
    const items: Item[] = [];
    track.clips.forEach((clip, ci) => {
      if (clip.nested) {
        const nested = clip.nested;
        items.push({
          at: clip.startFrame,
          write: () => {
            const id = videoClipId(vi, ci);
            w.open("clipitem", { id });
            w.leaf("name", clip.name).leaf("enabled", "TRUE");
            w.leaf("duration", nested.durationFrames);
            writeRate(w, nested.rate);
            w.leaf("start", clip.startFrame).leaf("end", clip.endFrame);
            w.leaf("in", secondsToFrames(clip.inSec, nested.rate)).leaf("out", secondsToFrames(clip.outSec, nested.rate));
            writeNestSequence(clip, nested);
            writeVideoFilters(clip);
            const partner = audioIndexOfLinked.get(clip.id);
            writeLink(id, "video", vi + 1, ci + 1);
            if (partner) writeLink(audioClipId(partner.ai, partner.ci), "audio", partner.ai + 1, partner.ci + 1, 1);
            w.close("clipitem");
          },
        });
        return;
      }
      const media = mediaByKey.get(clip.mediaKey);
      if (!media) return;
      items.push({
        at: clip.startFrame,
        write: () => {
          const id = videoClipId(vi, ci);
          w.open("clipitem", { id });
          w.leaf("masterclipid", `masterclip-${fileId(media)}`);
          w.leaf("name", clip.name).leaf("enabled", "TRUE");
          w.leaf("duration", sourceFrames(media, media.durationSec));
          writeRate(w, media.rate);
          w.leaf("start", clip.startFrame).leaf("end", clip.endFrame);
          w.leaf("in", sourceFrames(media, clip.inSec)).leaf("out", sourceFrames(media, clip.outSec));
          writeFile(media);
          writeMulticam(clip, seq);
          writeClipMarkers(clip, media);
          writeVideoFilters(clip);
          const partner = audioIndexOfLinked.get(clip.id);
          writeLink(id, "video", vi + 1, ci + 1);
          if (partner) writeLink(audioClipId(partner.ai, partner.ci), "audio", partner.ai + 1, partner.ci + 1, 1);
          w.close("clipitem");
        },
      });
    });
    for (const tr of track.transitions) {
      items.push({
        at: tr.startFrame - 0.5,
        write: () => {
          const effect = TRANSITION_EFFECT[tr.kind];
          w.open("transitionitem");
          w.leaf("start", tr.startFrame).leaf("end", tr.endFrame).leaf("alignment", tr.alignment);
          writeRate(w, seq.rate);
          w.open("effect");
          w.leaf("name", effect.name).leaf("effectid", effect.name);
          w.leaf("effectcategory", effect.category).leaf("effecttype", "transition").leaf("mediatype", "video");
          w.leaf("wipecode", 0).leaf("wipeaccuracy", 100).leaf("startratio", 0).leaf("endratio", 1);
          w.leaf("reverse", "FALSE");
          w.close("effect");
          w.close("transitionitem");
        },
      });
    }
    items.sort((a, b) => a.at - b.at).forEach((i) => i.write());
    w.leaf("enabled", bool(!track.disabled)).leaf("locked", bool(track.locked));
    w.close("track");
  });
  w.close("video");

  w.open("audio");
  w.leaf("numOutputChannels", 2);
  w.open("format").open("samplecharacteristics").leaf("depth", 16).leaf("samplerate", 48000);
  w.close("samplecharacteristics").close("format");
  audioEntries.forEach((entry, ai) => {
    w.open("track", trackAttrs(entry.track));
    entry.track.clips.forEach((clip, ci) => {
      if (clip.nested) {
        // The nest's sound: an audio clipitem that references the nested <sequence> by id.
        const nested = clip.nested;
        const id = audioClipId(ai, ci);
        w.open("clipitem", { id, premiereChannelType: "stereo" });
        w.leaf("name", clip.name).leaf("enabled", "TRUE");
        w.leaf("duration", nested.durationFrames);
        writeRate(w, nested.rate);
        w.leaf("start", clip.startFrame).leaf("end", clip.endFrame);
        w.leaf("in", secondsToFrames(clip.inSec, nested.rate)).leaf("out", secondsToFrames(clip.outSec, nested.rate));
        writeNestSequence(clip, nested);
        w.open("sourcetrack").leaf("mediatype", "audio").leaf("trackindex", 1).close("sourcetrack");
        writeAudioRetime(clip);
        writeAudioFilters(clip);
        const v = videoIndexOfClip.get(clip.id);
        if (v) {
          writeLink(videoClipId(v.vi, v.ci), "video", v.vi + 1, v.ci + 1);
          writeLink(id, "audio", ai + 1, ci + 1, 1);
        }
        w.close("clipitem");
        return;
      }
      const media = mediaByKey.get(clip.mediaKey);
      if (!media) return;
      const id = audioClipId(ai, ci);
      w.open("clipitem", { id, premiereChannelType: "stereo" });
      w.leaf("masterclipid", `masterclip-${fileId(media)}`);
      w.leaf("name", clip.name).leaf("enabled", "TRUE");
      w.leaf("duration", sourceFrames(media, media.durationSec));
      writeRate(w, media.rate);
      w.leaf("start", clip.startFrame).leaf("end", clip.endFrame);
      w.leaf("in", sourceFrames(media, clip.inSec)).leaf("out", sourceFrames(media, clip.outSec));
      writeFile(media);
      if (entry.pairedVideo === undefined) writeClipMarkers(clip, media);
      w.open("sourcetrack").leaf("mediatype", "audio").leaf("trackindex", 1).close("sourcetrack");
      writeAudioRetime(clip);
      writeAudioFilters(clip);
      if (entry.pairedVideo !== undefined) {
        const v = videoIndexOfClip.get(clip.id);
        if (v) {
          writeLink(videoClipId(v.vi, v.ci), "video", v.vi + 1, v.ci + 1);
          writeLink(id, "audio", ai + 1, ci + 1, 1);
        }
      }
      w.close("clipitem");
    });
    w.leaf("enabled", bool(!entry.track.disabled)).leaf("locked", bool(entry.track.locked));
    w.close("track");
  });
  w.close("audio");

  w.close("media");
  w.close("sequence");
  };

  w.open("xmeml", { version: 5 });
  writeSequence(input, "sequence-1");
  w.close("xmeml");
  return w.toString(['<?xml version="1.0" encoding="UTF-8"?>', "<!DOCTYPE xmeml>"]);
}


// ── parse ──────────────────────────────────────────────────────────────────

function rateOf(el: XmlElement | undefined): FrameRate | undefined {
  const rate = child(el, "rate");
  const timebase = childNumber(rate, "timebase");
  if (!rate || !timebase) return undefined;
  return makeFrameRate(timebase, asBool(childText(rate, "ntsc"), false));
}

function findAll(root: XmlElement, name: string, into: XmlElement[] = []): XmlElement[] {
  if (root.name === name) into.push(root);
  for (const c of root.children) findAll(c, name, into);
  return into;
}

/** The sequences of the file itself: those not carried inside a clipitem (nests). */
function topLevelSequences(el: XmlElement, into: XmlElement[] = []): XmlElement[] {
  if (el.name === "sequence") {
    into.push(el);
    return into;
  }
  if (el.name === "clipitem") return into;
  for (const c of el.children) topLevelSequences(c, into);
  return into;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|tiff?|webp|heic|svg)$/i;

function paramValue(clipitem: XmlElement, effectId: string, paramId: string): string | undefined {
  for (const filter of childrenNamed(clipitem, "filter")) {
    const effect = child(filter, "effect");
    const id = (childText(effect, "effectid") ?? "").toLowerCase();
    const name = (childText(effect, "name") ?? "").toLowerCase();
    if (id !== effectId && name.replace(/\s+/g, "") !== effectId) continue;
    for (const p of childrenNamed(effect, "parameter")) {
      if ((childText(p, "parameterid") ?? "").toLowerCase() === paramId) return childText(p, "value");
    }
  }
  return undefined;
}

export function parseXmeml(source: string): { sequence: Sequence; report: InterchangeReport } {
  const warnings: string[] = [];
  const root = parseXml(source);
  if (root.name !== "xmeml") throw new Error("Not a Final Cut Pro XML (xmeml) document.");
  const topLevel = topLevelSequences(root);
  const seqEl = topLevel.find((s) => child(s, "media")) ?? topLevel[0];
  if (!seqEl) throw new Error("The XML does not contain a sequence.");
  if (topLevel.length > 1) warnings.push(`The file holds ${topLevel.length} sequences; only the first was imported.`);

  // Nested sequences are written in full once and referenced by id afterwards.
  const sequenceDefs = new Map<string, XmlElement>();
  for (const el of findAll(root, "sequence")) {
    if (el.attrs.id && el.children.length > 0 && !sequenceDefs.has(el.attrs.id)) sequenceDefs.set(el.attrs.id, el);
  }

  // file definitions (full body once, bare references afterwards), across the file and its nests
  const fileEls = new Map<string, XmlElement>();
  for (const f of findAll(root, "file")) {
    const id = f.attrs.id;
    if (!id) continue;
    const prev = fileEls.get(id);
    if (!prev || f.children.length > prev.children.length) fileEls.set(id, f);
  }
  const mediaMap = new Map<string, SeqMedia>();
  const mediaFor = (
    fileEl: XmlElement | undefined,
    clipName: string,
    fallbackRate: FrameRate,
    width: number,
    height: number,
  ): SeqMedia | null => {
    if (!fileEl) return null;
    const id = fileEl.attrs.id;
    const full = (id && fileEls.get(id)) || fileEl;
    const key = id ?? childText(full, "name") ?? clipName;
    const cached = mediaMap.get(key);
    if (cached) return cached;
    const fileRate = rateOf(full) ?? fallbackRate;
    const fm = child(full, "media");
    const hasVideo = !!child(fm, "video");
    const hasAudio = !!child(fm, "audio");
    const name = childText(full, "name") ?? clipName;
    const sc = child(child(fm, "video"), "samplecharacteristics");
    const ac = child(child(fm, "audio"), "samplecharacteristics");
    const dur = childNumber(full, "duration") ?? 0;
    const media: SeqMedia = {
      key,
      name,
      pathUrl: childText(full, "pathurl"),
      kind: !hasVideo && hasAudio ? "audio" : IMAGE_EXT.test(name) ? "image" : "video",
      durationSec: dur > 0 ? framesToSeconds(dur, fileRate) : 0,
      rate: fileRate,
      width: childNumber(sc, "width") ?? width,
      height: childNumber(sc, "height") ?? height,
      hasVideo: hasVideo || (!hasAudio && !fm),
      hasAudio,
      sampleRate: childNumber(ac, "samplerate") ?? 48000,
      channels: childNumber(child(fm, "audio"), "channelcount") ?? 2,
    };
    mediaMap.set(key, media);
    return media;
  };

  interface ParsedClip {
    clip: SeqClip;
    elementId: string | undefined;
    linkRefs: string[];
  }

  const builtNests = new Map<XmlElement, Sequence | null>();
  const inProgress = new Set<XmlElement>();

  /** The nested sequence a clipitem's <sequence> element stands for (a full body, or a reference to one). */
  const nestFor = (sequenceEl: XmlElement, label: string): Sequence | null => {
    const def =
      sequenceEl.children.length > 0 ? sequenceEl : sequenceEl.attrs.id ? sequenceDefs.get(sequenceEl.attrs.id) : undefined;
    if (!def) {
      warnings.push(`Nested sequence "${label}" references a sequence that is not in the file and was skipped.`);
      return null;
    }
    if (builtNests.has(def)) return builtNests.get(def) ?? null;
    if (inProgress.has(def)) {
      warnings.push(`Nested sequence "${label}" contains itself and was skipped.`);
      return null;
    }
    inProgress.add(def);
    const built = buildSequence(def, true);
    inProgress.delete(def);
    builtNests.set(def, built);
    return built;
  };

  function buildSequence(seqEl: XmlElement, isNest: boolean): Sequence {
    const seqRate = rateOf(seqEl) ?? makeFrameRate(30, false);
    const tcEl = child(seqEl, "timecode");
    const dropFrame = (childText(tcEl, "displayformat") ?? "").toUpperCase() === "DF";
    const sequenceRate = dropFrame ? makeFrameRate(seqRate.timebase, seqRate.ntsc, true) : seqRate;
    const fps = fpsOf(sequenceRate);

    const mediaEl = child(seqEl, "media");
    const videoEl = child(mediaEl, "video");
    const audioEl = child(mediaEl, "audio");
    const fmt = child(child(videoEl, "format"), "samplecharacteristics");
    const width = childNumber(fmt, "width") ?? 1920;
    const height = childNumber(fmt, "height") ?? 1080;

    /** Media this sequence's own clips use (nests list theirs on the nested sequence). */
    const used = new Map<string, SeqMedia>();
    const multicams = new Map<string, SeqMulticam>();
    const useMedia = (fileEl: XmlElement | undefined, clipName: string): SeqMedia | null => {
      const media = mediaFor(fileEl, clipName, sequenceRate, width, height);
      if (media) used.set(media.key, media);
      return media;
    };

    /** <multiclip>: the angles of a multicam source and which one this cut plays. */
    const parseMulticam = (el: XmlElement, activeKey: string): SeqClip["multicam"] => {
      const mcEl = child(el, "multiclip");
      if (!mcEl) return undefined;
      const sourceId = mcEl.attrs.id ?? `multiclip-${multicams.size + 1}`;
      const angles: SeqMulticamAngle[] = [];
      let activeAngleId: string | undefined;
      let fallbackAngleId: string | undefined;
      childrenNamed(mcEl, "angle").forEach((angleEl, index) => {
        const angleName = childText(angleEl, "name") ?? `Angle ${index + 1}`;
        const media = mediaFor(child(angleEl, "file"), angleName, sequenceRate, width, height);
        if (!media) return;
        const id = angleEl.attrs.id ?? `angle-${index + 1}`;
        const exact = childNumber(angleEl, "offsetseconds");
        const frames = childNumber(angleEl, "syncoffset") ?? 0;
        angles.push({ id, name: angleName, media, offsetSec: exact ?? frames / fps });
        if (asBool(childText(angleEl, "activevideo"), false)) activeAngleId = id;
        if (media.key === activeKey && !fallbackAngleId) fallbackAngleId = id;
      });
      const angleId = activeAngleId ?? fallbackAngleId;
      if (angles.length < 2 || !angleId) {
        warnings.push(`Multicam clip "${childText(mcEl, "name") ?? sourceId}" has no usable angles; imported as an ordinary clip.`);
        return undefined;
      }
      if (!multicams.has(sourceId)) multicams.set(sourceId, { id: sourceId, name: childText(mcEl, "name") ?? "Multicam", angles });
      return { sourceId, angleId };
    };

    const parseTrack = (
      trackEl: XmlElement,
      kind: "video" | "audio",
      index: number,
    ): { track: SeqTrack; parsed: ParsedClip[] } => {
      const clips: ParsedClip[] = [];
      const transitions: SeqTransition[] = [];
      const children = trackEl.children;
      // transition helpers for clipitems whose edges are -1 ("inside a transition")
      const cutOf = (t: SeqTransition): number => {
        const d = t.endFrame - t.startFrame;
        return t.alignment === "start" ? t.startFrame : t.alignment === "end" ? t.endFrame : t.startFrame + Math.floor(d / 2);
      };
      const parsedTransitions: { el: XmlElement; t: SeqTransition; at: number }[] = [];
      children.forEach((el, at) => {
        if (el.name !== "transitionitem") return;
        const start = childNumber(el, "start");
        const end = childNumber(el, "end");
        if (start === undefined || end === undefined || end <= start) return;
        const effectName = childText(child(el, "effect"), "name") ?? "";
        const kindOf = transitionKindFromName(effectName);
        if (!kindOf) warnings.push(`Transition "${effectName}" is not supported; imported as a cross dissolve.`);
        const alignmentRaw = (childText(el, "alignment") ?? "center").toLowerCase();
        const alignment = alignmentRaw.startsWith("start") ? "start" : alignmentRaw.startsWith("end") ? "end" : "center";
        const t: SeqTransition = { kind: kindOf ?? "dissolve", startFrame: start, endFrame: end, alignment };
        transitions.push(t);
        parsedTransitions.push({ el, t, at });
      });

      children.forEach((el, at) => {
        if (el.name !== "clipitem") return;
        const name = childText(el, "name") ?? "Clip";
        const nestEl = child(el, "sequence");
        const nested = nestEl ? nestFor(nestEl, name) : null;
        const media = nestEl ? null : useMedia(child(el, "file"), name);
        if (!nested && !media) {
          if (!nestEl) warnings.push(`Clip "${name}" has no file reference and was skipped.`);
          return;
        }
        const clipRate = rateOf(el) ?? media?.rate ?? nested?.rate ?? sequenceRate;
        let start = childNumber(el, "start") ?? 0;
        let end = childNumber(el, "end") ?? start;
        if (start < 0) {
          const prev = [...parsedTransitions].reverse().find((p) => p.at < at);
          if (prev) start = cutOf(prev.t);
          else start = 0;
        }
        if (end < 0) {
          const next = parsedTransitions.find((p) => p.at > at);
          if (next) end = cutOf(next.t);
          else end = start + 1;
        }
        const inF = childNumber(el, "in") ?? 0;
        const outF = childNumber(el, "out") ?? inF + (end - start);
        const inSec = framesToSeconds(inF, clipRate);
        const outSec = framesToSeconds(outF, clipRate);
        const speedParam = paramValue(el, "timeremap", "speed");
        let speed = 1;
        if (speedParam !== undefined && Number.isFinite(Number(speedParam)) && Number(speedParam) !== 0) {
          speed = Math.abs(Number(speedParam)) / 100;
        } else if (end > start && outSec > inSec) {
          const derived = (outSec - inSec) / ((end - start) / fps);
          speed = Math.abs(derived - 1) < 1e-3 ? 1 : Math.round(derived * 1e6) / 1e6;
        }
        const reversed = asBool(paramValue(el, "timeremap", "reverse"), false);
        const opacityParam = paramValue(el, "opacity", "opacity");
        const levelParam = paramValue(el, "audiolevels", "level");
        const opacity = opacityParam !== undefined && Number.isFinite(Number(opacityParam)) ? Number(opacityParam) / 100 : 1;
        const volume = levelParam !== undefined && Number.isFinite(Number(levelParam)) ? Number(levelParam) : 1;
        if (!asBool(childText(el, "enabled"), true)) warnings.push(`Clip "${name}" is disabled in the source; it was imported enabled.`);
        const multicam = media && kind === "video" ? parseMulticam(el, media.key) : undefined;
        const clipMarkers: SeqClipMarker[] = childrenNamed(el, "marker").flatMap((m) => {
          const inM = childNumber(m, "in");
          if (inM === undefined || inM < 0) return [];
          const outM = childNumber(m, "out");
          const comment = childText(m, "comment");
          return [
            {
              sec: framesToSeconds(inM, clipRate),
              name: childText(m, "name") ?? "",
              ...(outM !== undefined && outM > inM ? { durationSec: framesToSeconds(outM - inM, clipRate) } : {}),
              ...(comment ? { comment } : {}),
            },
          ];
        });
        clips.push({
          clip: {
            id: el.attrs.id ?? `${kind}-${index}-${clips.length}`,
            name,
            mediaKey: media?.key ?? "",
            startFrame: start,
            endFrame: Math.max(start + 1, end),
            inSec,
            outSec: Math.max(inSec, outSec),
            speed,
            reversed,
            opacity,
            volume,
            withAudio: false,
            ...(nested ? { nested } : {}),
            ...(multicam ? { multicam } : {}),
            ...(clipMarkers.length && !nested ? { markers: clipMarkers } : {}),
          },
          elementId: el.attrs.id,
          linkRefs: childrenNamed(el, "link").map((l) => childText(l, "linkclipref") ?? ""),
        });
      });
      const disabledEl = childText(trackEl, "enabled");
      return {
        track: {
          kind,
          name: kind === "video" ? `V${index + 1}` : `A${index + 1}`,
          clips: clips.map((c) => c.clip).sort((a, b) => a.startFrame - b.startFrame),
          transitions,
          disabled: !asBool(disabledEl, true),
          locked: asBool(childText(trackEl, "locked"), false),
          ...(trackEl.attrs["MZ.TrackTargeted"] === "1" ? { targeted: true } : {}),
        },
        parsed: clips,
      };
    };

    const videoParsed = childrenNamed(videoEl, "track").map((t, i) => parseTrack(t, "video", i));
    const audioParsed = childrenNamed(audioEl, "track").map((t, i) => parseTrack(t, "audio", i));

    // Fold audio items linked to a video item of the same file/time (or the same nest) into that video clip.
    const videoById = new Map<string, SeqClip>();
    videoParsed.forEach((p) => p.parsed.forEach((c) => c.elementId && videoById.set(c.elementId, c.clip)));
    const withAudio = new Set<SeqClip>();
    const audioVolume = new Map<SeqClip, number>();
    const absorbed = new Set<SeqClip>();
    for (const p of audioParsed) {
      for (const a of p.parsed) {
        for (const ref of a.linkRefs) {
          const v = videoById.get(ref);
          if (
            v &&
            v.mediaKey === a.clip.mediaKey &&
            v.nested === a.clip.nested &&
            v.startFrame === a.clip.startFrame &&
            v.endFrame === a.clip.endFrame
          ) {
            absorbed.add(a.clip);
            if (!withAudio.has(v)) {
              withAudio.add(v);
              audioVolume.set(v, a.clip.volume);
            }
            break;
          }
        }
      }
    }
    const videoTracks: SeqTrack[] = videoParsed.map((p) => ({
      ...p.track,
      clips: p.track.clips.map((c) =>
        withAudio.has(c) ? { ...c, withAudio: true, volume: audioVolume.get(c) ?? c.volume } : c,
      ),
    }));
    const audioTracks: SeqTrack[] = [];
    audioParsed.forEach((p) => {
      const remaining = p.track.clips.filter((c) => !absorbed.has(c));
      if (remaining.length === 0 && p.track.clips.length > 0) return;
      audioTracks.push({ ...p.track, clips: remaining, name: `A${audioTracks.length + 1}` });
    });

    const markers: SeqMarker[] = childrenNamed(seqEl, "marker").map((m) => {
      const frame = Math.max(0, childNumber(m, "in") ?? 0);
      const out = childNumber(m, "out");
      const comment = childText(m, "comment");
      return {
        frame,
        name: childText(m, "name") ?? "",
        ...(out !== undefined && out > frame ? { durationFrames: out - frame } : {}),
        ...(comment ? { comment } : {}),
      };
    });

    const tracks = [...videoTracks, ...audioTracks];
    const maxEnd = tracks.reduce((m, t) => t.clips.reduce((x, c) => Math.max(x, c.endFrame), m), 0);
    return {
      ...(isNest && seqEl.attrs.id ? { id: `xmeml:${seqEl.attrs.id}` } : {}),
      name: childText(seqEl, "name") ?? "Imported Sequence",
      rate: sequenceRate,
      width,
      height,
      durationFrames: Math.max(childNumber(seqEl, "duration") ?? 0, maxEnd),
      tracks,
      markers,
      media: [...used.values()],
      ...(multicams.size ? { multicam: [...multicams.values()] } : {}),
    };
  }

  return { sequence: buildSequence(seqEl, false), report: { warnings } };
}
