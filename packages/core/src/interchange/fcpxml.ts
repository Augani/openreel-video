import { XmlWriter, child, childrenNamed, parseXml, type XmlElement } from "./xml";
import { fpsOf, makeFrameRate, secondsToFrames, type FrameRate } from "./timecode";
import type {
  InterchangeReport,
  Sequence,
  SeqClip,
  SeqMarker,
  SeqMedia,
  SeqMulticam,
  SeqTrack,
  SeqTransition,
  SeqTransitionKind,
} from "./model";
import { transitionKindFromName } from "./xmeml";
import { TRANSITION_NAMES } from "./transition-names";

/**
 * Final Cut Pro X interchange (FCPXML 1.10). The bottom video track becomes
 * the primary storyline (spine); other tracks are connected clips on lanes
 * (video lanes 1.., audio lanes -1..). Times are exact rationals.
 *
 * Nests are compound clips: each nested sequence becomes a `<media>` resource
 * holding its own `<sequence>`, and every instance is a `<ref-clip>` (so editing
 * the nest in Final Cut changes every instance, like in OpenReel). A multicam cut
 * becomes `<mc-clip>` references into a `<media><multicam>` resource whose angles
 * hold the synchronised camera media.
 */

export const FCPXML_VERSION = "1.10";
/** FCPXML names of a clip's output channels, by OpenReel clip channel format. */
const FCP_OUT_CHANNELS = { mono: ["C"], stereo: ["L", "R"], "5.1": ["L", "R", "C", "LFE", "Ls", "Rs"] } as const;
const FCP_OUT_TO_FORMAT = (outCh: readonly string[]): "mono" | "stereo" | "5.1" =>
  outCh.some((name) => name === "LFE" || name === "Ls" || name === "Rs" || (name === "C" && outCh.length > 1))
    ? "5.1"
    : outCh.some((name) => name === "L" || name === "R")
      ? "stereo"
      : outCh.length <= 1
        ? "mono"
        : "stereo";
const CROSS_DISSOLVE_UID = "FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265";

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** Rational seconds string for `frames` frames of `rate`: "1001/30000s". */
export function framesToFcpTime(frames: number, rate: FrameRate): string {
  if (frames === 0) return "0s";
  const n = frames * rate.den;
  const d = rate.num;
  const g = gcd(n, d);
  const rn = n / g;
  const rd = d / g;
  return rd === 1 ? `${rn}s` : `${rn}/${rd}s`;
}

export function parseFcpTime(value: string | undefined): number {
  if (!value) return 0;
  const m = /^(-?[0-9.]+)(?:\/([0-9.]+))?s$/.exec(value.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const d = m[2] === undefined ? 1 : Number(m[2]);
  return d === 0 || !Number.isFinite(n / d) ? 0 : n / d;
}

const dbOf = (linear: number): string => {
  const db = linear <= 0 ? -96 : Math.max(-96, 20 * Math.log10(linear));
  return `${Math.round(db * 1e6) / 1e6}dB`;
};
const linearOf = (amount: string | undefined): number | undefined => {
  if (!amount) return undefined;
  const m = /^(-?[0-9.]+|-?inf)\s*dB$/i.exec(amount.trim());
  if (!m) return undefined;
  const db = Number(m[1]);
  if (!Number.isFinite(db) || db <= -95.999) return 0;
  return 10 ** (db / 20);
};

const audioRateLabel = (hz: number): string =>
  hz % 1000 === 0 ? `${hz / 1000}k` : `${Math.round(hz / 100) / 10}k`;

/** What a clip points at: a media asset, a nested sequence (ref-clip) or a multicam angle (mc-clip). */
interface ClipSource {
  readonly ref: string;
  readonly element: "asset-clip" | "ref-clip" | "mc-clip";
  readonly rate: FrameRate;
  /** Added to the clip's source seconds before writing (multicam angle placement in the shared timeline). */
  readonly shiftSec: number;
  readonly hasVideo: boolean;
  readonly angleId?: string;
}

interface McEntry {
  readonly id: string;
  readonly mc: SeqMulticam;
  readonly rate: FrameRate;
  readonly width: number;
  readonly height: number;
  /** Makes every angle start at or after 0 in the multicam timeline. */
  readonly shift: number;
}

export function serializeFcpxml(root: Sequence, report?: InterchangeReport): string {
  const w = new XmlWriter();
  const warn = (message: string): void => {
    if (report && !report.warnings.includes(message)) report.warnings.push(message);
  };

  let nextId = 1;
  const formats = new Map<string, { id: string; rate: FrameRate; width: number; height: number }>();
  const formatFor = (rate: FrameRate, width: number, height: number): string => {
    const key = `${rate.num}/${rate.den}/${width}x${height}`;
    let entry = formats.get(key);
    if (!entry) {
      entry = { id: `r${nextId++}`, rate, width, height };
      formats.set(key, entry);
    }
    return entry.id;
  };
  formatFor(root.rate, root.width, root.height);

  // ── gather: every media, nested sequence (dependencies first) and multicam source ──
  const allMedia = new Map<string, SeqMedia>();
  const nestEntries = new Map<unknown, { id: string; seq: Sequence }>();
  const nestOrder: Sequence[] = [];
  const mcPending = new Map<string, SeqMulticam>();
  const seqKey = (s: Sequence): unknown => s.id ?? s;
  const gather = (s: Sequence, stack: readonly unknown[]): void => {
    for (const m of s.media) if (!allMedia.has(m.key)) allMedia.set(m.key, m);
    for (const mc of s.multicam ?? []) {
      if (!mcPending.has(mc.id)) mcPending.set(mc.id, mc);
      for (const angle of mc.angles) if (!allMedia.has(angle.media.key)) allMedia.set(angle.media.key, angle.media);
    }
    for (const track of s.tracks) {
      for (const clip of track.clips) {
        if (!clip.nested || stack.includes(seqKey(clip.nested))) continue;
        gather(clip.nested, [...stack, seqKey(clip.nested)]);
        if (!nestEntries.has(seqKey(clip.nested))) {
          nestEntries.set(seqKey(clip.nested), { id: "", seq: clip.nested });
          nestOrder.push(clip.nested);
        }
      }
    }
  };
  gather(root, [seqKey(root)]);

  const assetIds = new Map<string, string>();
  for (const media of allMedia.values()) assetIds.set(media.key, `r${nextId++}`);
  const effectId = `r${nextId++}`;
  const assetFormat = new Map<string, string>();
  for (const media of allMedia.values()) {
    if (media.hasVideo) assetFormat.set(media.key, formatFor(media.rate, media.width, media.height));
  }
  for (const nested of nestOrder) formatFor(nested.rate, nested.width, nested.height);
  const mcEntries = new Map<string, McEntry>();
  for (const mc of mcPending.values()) {
    const first = mc.angles[0]?.media;
    const rate = first?.rate ?? root.rate;
    const width = first?.width || root.width;
    const height = first?.height || root.height;
    formatFor(rate, width, height);
    const minOffset = mc.angles.reduce((m, a) => Math.min(m, a.offsetSec), 0);
    mcEntries.set(mc.id, { id: "", mc, rate, width, height, shift: -minOffset });
  }
  for (const nested of nestOrder) {
    const entry = nestEntries.get(seqKey(nested));
    if (entry) entry.id = `r${nextId++}`;
  }
  const mcIds = new Map<string, string>();
  for (const id of mcEntries.keys()) mcIds.set(id, `r${nextId++}`);
  const mediaByKey = allMedia;

  // ── one <sequence> with its spine; used for the project and for every nest resource ──
  const writeSequence = (seq: Sequence): void => {
    const seqRate = seq.rate;
    const total = Math.max(seq.durationFrames, 1);
    const T = (frames: number): string => framesToFcpTime(frames, seqRate);
    const videoTracks = seq.tracks.filter((t) => t.kind === "video");
    const audioTracks = seq.tracks.filter((t) => t.kind === "audio");
    const primary = videoTracks[0];

    const sourceOf = (clip: SeqClip): ClipSource | undefined => {
      if (clip.nested) {
        const entry = nestEntries.get(seqKey(clip.nested));
        if (!entry || !entry.id) return undefined;
        return { ref: entry.id, element: "ref-clip", rate: clip.nested.rate, shiftSec: 0, hasVideo: true };
      }
      if (clip.multicam) {
        const entry = mcEntries.get(clip.multicam.sourceId);
        const angle = entry?.mc.angles.find((a) => a.id === clip.multicam?.angleId);
        const id = entry ? mcIds.get(entry.mc.id) : undefined;
        if (entry && angle && id) {
          return { ref: id, element: "mc-clip", rate: entry.rate, shiftSec: angle.offsetSec + entry.shift, hasVideo: true, angleId: angle.id };
        }
      }
      const media = mediaByKey.get(clip.mediaKey);
      const ref = media ? assetIds.get(media.key) : undefined;
      if (!media || !ref) return undefined;
      return { ref, element: "asset-clip", rate: media.rate, shiftSec: media.startSec ?? 0, hasVideo: media.hasVideo };
    };
    const attrOf = (source: ClipSource, seconds: number): string =>
      framesToFcpTime(secondsToFrames(seconds + source.shiftSec, source.rate), source.rate);

    // ── spine items ──
    interface SpineItem {
      start: number; // timeline frames
      end: number;
      clip?: SeqClip;
      source?: ClipSource;
      sourceStartAttr: string; // value of the `start` attribute (parent coordinate base)
      startAttrSeconds: number;
      markers: SeqMarker[];
      connected: { clip: SeqClip; lane: number; track: SeqTrack }[];
    }
    const spine: (SpineItem | { transition: SeqTransition })[] = [];
    const spineClips: SpineItem[] = [];
    const startSecOf = (clip: SeqClip): number => {
      const hasMap = clip.speed !== 1 || clip.reversed;
      return hasMap && clip.reversed ? clip.outSec : clip.inSec;
    };
    const startAttrOf = (clip: SeqClip, source: ClipSource): string => attrOf(source, startSecOf(clip));
    const startSecondsOf = (clip: SeqClip, source: ClipSource): number =>
      secondsToFrames(startSecOf(clip) + source.shiftSec, source.rate) / (source.rate.num / source.rate.den);

    let cursor = 0;
    const primaryClips = primary ? [...primary.clips].sort((a, b) => a.startFrame - b.startFrame) : [];
    const gapItem = (start: number, end: number): SpineItem => ({
      start,
      end,
      sourceStartAttr: "0s",
      startAttrSeconds: 0,
      markers: [],
      connected: [],
    });
    const transitionBefore = (clip: SeqClip): SeqTransition | undefined =>
      primary?.transitions.find(
        (t) => Math.abs(t.startFrame + Math.floor((t.endFrame - t.startFrame) / 2) - clip.startFrame) <= 1,
      );
    for (const clip of primaryClips) {
      const source = sourceOf(clip);
      if (!source) continue;
      if (clip.startFrame > cursor) {
        const gap = gapItem(cursor, clip.startFrame);
        spine.push(gap);
        spineClips.push(gap);
      }
      const tr = transitionBefore(clip);
      if (tr && spineClips.length) {
        if (tr.kind !== "dissolve" || tr.type) warn(`Transition "${tr.type ? (TRANSITION_NAMES[tr.type]?.name ?? tr.type) : tr.kind}" is exported as a cross dissolve in FCPXML.`);
        spine.push({ transition: tr });
      }
      const item: SpineItem = {
        start: clip.startFrame,
        end: clip.endFrame,
        clip,
        source,
        sourceStartAttr: startAttrOf(clip, source),
        startAttrSeconds: startSecondsOf(clip, source),
        markers: [],
        connected: [],
      };
      spine.push(item);
      spineClips.push(item);
      cursor = Math.max(cursor, clip.endFrame);
    }
    if (cursor < total) {
      const gap = gapItem(cursor, total);
      spine.push(gap);
      spineClips.push(gap);
    }

    const covering = (frame: number): SpineItem => {
      return (
        spineClips.find((s) => frame >= s.start && frame < s.end) ?? spineClips[spineClips.length - 1]
      );
    };
    videoTracks.forEach((track, i) => {
      if (i === 0) return;
      for (const clip of track.clips) covering(clip.startFrame).connected.push({ clip, lane: i, track });
    });
    audioTracks.forEach((track, i) => {
      for (const clip of track.clips) covering(clip.startFrame).connected.push({ clip, lane: -(i + 1), track });
    });
    for (const marker of seq.markers) covering(marker.frame).markers.push(marker);

    // attribute value of a child's `offset` / marker `start` relative to a parent item
    const childTime = (parent: SpineItem, frame: number): string => {
      const parentStart = parent.startAttrSeconds;
      const offsetSeconds = (frame - parent.start) / fpsOf(seqRate);
      const frames = secondsToFrames(parentStart + offsetSeconds, seqRate);
      return framesToFcpTime(frames, seqRate);
    };

    const writeClipBody = (
      clip: SeqClip,
      source: ClipSource,
      attrs: Record<string, string | number | undefined>,
      track: SeqTrack,
      inner: () => void,
      audioOnly = false,
    ): void => {
      const hasMap = clip.speed !== 1 || clip.reversed;
      const full: Record<string, string | number | undefined> = {
        ref: source.ref,
        ...attrs,
        name: clip.name,
        tcFormat: seqRate.dropFrame ? "DF" : "NDF",
        ...(track.disabled ? { enabled: 0 } : {}),
        ...(audioOnly ? { srcEnable: "audio" } : {}),
      };
      w.open(source.element, full);
      if (hasMap) {
        const dur = clip.endFrame - clip.startFrame;
        const a = attrOf(source, clip.reversed ? clip.outSec : clip.inSec);
        const b = attrOf(source, clip.reversed ? clip.inSec : clip.outSec);
        w.open("timeMap");
        w.empty("timept", { time: "0s", value: a, interp: "linear" });
        w.empty("timept", { time: T(dur), value: b, interp: "linear" });
        w.close("timeMap");
      }
      if (clip.opacity !== 1 && !audioOnly) w.empty("adjust-blend", { amount: Math.round(clip.opacity * 1e6) / 1e6 });
      if (clip.volume !== 1) w.empty("adjust-volume", { amount: dbOf(clip.volume) });
      if (clip.audioChannels && source.element !== "mc-clip" && (audioOnly || track.kind === "audio" || clip.withAudio)) {
        const mapped = clip.audioChannels.sources.map((entry, out) => ({ entry, out })).filter(({ entry }) => entry !== -1);
        // MIX has no FCPXML form: every source channel is selected instead (reported as approximated).
        const srcCh = mapped.some(({ entry }) => entry === -2)
          ? Array.from({ length: clip.audioChannels.fileChannels }, (_, i) => i + 1)
          : mapped.map(({ entry }) => entry + 1);
        const outNames = FCP_OUT_CHANNELS[clip.audioChannels.format];
        const outCh = mapped.some(({ entry }) => entry === -2) ? outNames : mapped.map(({ out }) => outNames[out]);
        if (srcCh.length) w.empty("audio-channel-source", { srcCh: srcCh.join(", "), outCh: outCh.join(", ") });
      }
      if (source.element === "mc-clip" && source.angleId) {
        w.empty("mc-source", { angleID: source.angleId, srcEnable: audioOnly ? "audio" : clip.withAudio ? "all" : "video" });
      }
      inner();
      w.close(source.element);
    };

    const writeConnected = (parent: SpineItem): void => {
      for (const { clip, lane, track } of parent.connected) {
        const source = sourceOf(clip);
        if (!source) continue;
        const audioOnly = track.kind === "audio" && source.hasVideo;
        writeClipBody(
          clip,
          source,
          {
            lane,
            offset: childTime(parent, clip.startFrame),
            start: startAttrOf(clip, source),
            duration: T(clip.endFrame - clip.startFrame),
          },
          track,
          () => undefined,
          audioOnly,
        );
      }
    };
    const writeMarkers = (parent: SpineItem): void => {
      for (const m of parent.markers) {
        w.empty("marker", {
          start: childTime(parent, m.frame),
          duration: framesToFcpTime(Math.max(1, m.durationFrames ?? 1), seqRate),
          value: m.name,
          ...(m.comment ? { note: m.comment } : {}),
        });
      }
    };

    w.open("sequence", {
      format: formatFor(seq.rate, seq.width, seq.height),
      duration: T(total),
      tcStart: "0s",
      tcFormat: seqRate.dropFrame ? "DF" : "NDF",
      audioLayout: "stereo",
      audioRate: audioRateLabel(48000),
    });
    w.open("spine");
    for (const entry of spine) {
      if ("transition" in entry) {
        const tr = entry.transition;
        w.open("transition", {
          name: "Cross Dissolve",
          offset: T(tr.startFrame),
          duration: T(tr.endFrame - tr.startFrame),
        });
        w.empty("filter-video", { ref: effectId, name: "Cross Dissolve" });
        w.close("transition");
        continue;
      }
      const duration = T(entry.end - entry.start);
      if (!entry.clip || !entry.source) {
        w.open("gap", { name: "Gap", offset: T(entry.start), start: "0s", duration });
        writeConnected(entry);
        writeMarkers(entry);
        w.close("gap");
        continue;
      }
      writeClipBody(
        entry.clip,
        entry.source,
        { offset: T(entry.start), start: entry.sourceStartAttr, duration },
        primary,
        () => {
          writeConnected(entry);
          writeMarkers(entry);
        },
      );
    }
    w.close("spine");
    w.close("sequence");
  };

  // ── resources ──
  w.open("fcpxml", { version: FCPXML_VERSION });
  w.open("resources");
  for (const f of formats.values()) {
    w.empty("format", {
      id: f.id,
      frameDuration: framesToFcpTime(1, f.rate),
      width: f.width,
      height: f.height,
      colorSpace: "1-1-1 (Rec. 709)",
    });
  }
  for (const media of allMedia.values()) {
    const id = assetIds.get(media.key)!;
    const attrs: Record<string, string | number> = {
      id,
      name: media.name,
      start: media.startSec ? framesToFcpTime(secondsToFrames(media.startSec, media.rate), media.rate) : "0s",
      duration: framesToFcpTime(secondsToFrames(media.durationSec, media.rate), media.rate),
      hasVideo: media.hasVideo ? 1 : 0,
      hasAudio: media.hasAudio ? 1 : 0,
    };
    const fmt = assetFormat.get(media.key);
    if (fmt) attrs.format = fmt;
    if (media.hasVideo) attrs.videoSources = 1;
    if (media.hasAudio) {
      attrs.audioSources = media.audioStreams ?? 1;
      attrs.audioChannels = media.channels;
      attrs.audioRate = media.sampleRate;
    }
    w.open("asset", attrs);
    w.empty("media-rep", { kind: "original-media", src: media.pathUrl ?? `file:///${encodeURIComponent(media.name)}` });
    w.close("asset");
  }
  w.empty("effect", { id: effectId, name: "Cross Dissolve", uid: CROSS_DISSOLVE_UID });

  // Multicam sources: <media><multicam> with one <mc-angle> per synchronised angle.
  for (const entry of mcEntries.values()) {
    const tcFormat = entry.rate.dropFrame ? "DF" : "NDF";
    w.open("media", { id: mcIds.get(entry.mc.id)!, name: entry.mc.name });
    w.open("multicam", { format: formatFor(entry.rate, entry.width, entry.height), tcStart: "0s", tcFormat });
    for (const angle of entry.mc.angles) {
      const ref = assetIds.get(angle.media.key);
      if (!ref) continue;
      w.open("mc-angle", { name: angle.name, angleID: angle.id });
      w.empty("asset-clip", {
        ref,
        offset: framesToFcpTime(secondsToFrames(angle.offsetSec + entry.shift, entry.rate), entry.rate),
        name: angle.name,
        start: "0s",
        duration: framesToFcpTime(secondsToFrames(angle.media.durationSec, angle.media.rate), angle.media.rate),
        tcFormat,
      });
      w.close("mc-angle");
    }
    w.close("multicam");
    w.close("media");
  }
  // Nested sequences (compound clips), dependencies first.
  for (const nested of nestOrder) {
    const entry = nestEntries.get(seqKey(nested));
    if (!entry) continue;
    w.open("media", { id: entry.id, name: nested.name });
    writeSequence(nested);
    w.close("media");
  }
  w.close("resources");

  w.open("library");
  w.open("event", { name: root.name });
  w.open("project", { name: root.name });
  writeSequence(root);
  w.close("project");
  w.close("event");
  w.close("library");
  w.close("fcpxml");
  return w.toString(['<?xml version="1.0" encoding="UTF-8"?>', "<!DOCTYPE fcpxml>"]);
}

// ── parse ──────────────────────────────────────────────────────────────────

interface AssetInfo {
  readonly id: string;
  readonly name: string;
  readonly src?: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  readonly formatId?: string;
  readonly audioRate: number;
  readonly audioChannels: number;
}

function rateFromFrameDuration(value: string | undefined): FrameRate | undefined {
  const m = value ? /^([0-9.]+)(?:\/([0-9.]+))?s$/.exec(value) : null;
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = m[2] === undefined ? 1 : Number(m[2]);
  if (!a || !b) return undefined;
  const fps = b / a;
  const ntsc = Math.abs(a - 1001) < 1e-9 || Math.abs(fps * 1.001 - Math.round(fps * 1.001)) < 5e-3 && Math.abs(fps - Math.round(fps)) > 1e-4;
  return makeFrameRate(ntsc ? Math.round(fps * 1.001) : Math.round(fps), ntsc);
}

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|tiff?|webp|heic|svg)$/i;
const MAX_NEST_DEPTH = 16;

export function parseFcpxml(source: string): { sequence: Sequence; report: InterchangeReport } {
  const warnings: string[] = [];
  const root = parseXml(source);
  if (root.name !== "fcpxml") throw new Error("Not an FCPXML document.");
  const resources = child(root, "resources");

  const formats = new Map<string, { rate?: FrameRate; width: number; height: number }>();
  for (const f of childrenNamed(resources, "format")) {
    if (!f.attrs.id) continue;
    formats.set(f.attrs.id, {
      rate: rateFromFrameDuration(f.attrs.frameDuration),
      width: Number(f.attrs.width) || 0,
      height: Number(f.attrs.height) || 0,
    });
  }
  const assets = new Map<string, AssetInfo>();
  for (const a of childrenNamed(resources, "asset")) {
    if (!a.attrs.id) continue;
    const rep = child(a, "media-rep");
    assets.set(a.attrs.id, {
      id: a.attrs.id,
      name: a.attrs.name ?? a.attrs.id,
      src: rep?.attrs.src ?? a.attrs.src,
      startSec: parseFcpTime(a.attrs.start),
      durationSec: parseFcpTime(a.attrs.duration),
      hasVideo: a.attrs.hasVideo === "1" || (a.attrs.hasVideo === undefined && !!a.attrs.format),
      hasAudio: a.attrs.hasAudio === "1",
      formatId: a.attrs.format,
      audioRate: Number(a.attrs.audioRate) || 48000,
      audioChannels: Number(a.attrs.audioChannels) || 2,
    });
  }
  /** <media> resources: compound clips (a <sequence>) and multicam sources (a <multicam>). */
  const mediaResources = new Map<string, XmlElement>();
  for (const m of childrenNamed(resources, "media")) if (m.attrs.id) mediaResources.set(m.attrs.id, m);

  // The project's own sequence: compound clips keep theirs under <resources>, which must be skipped.
  const topSeqEl = findFirst({ ...root, children: root.children.filter((c) => c.name !== "resources") }, "sequence");
  if (!topSeqEl) throw new Error("The FCPXML does not contain a sequence.");
  const topFormat = formats.get(topSeqEl.attrs.format ?? "");
  const topRate = ((): FrameRate => {
    const base = topFormat?.rate ?? makeFrameRate(30, false);
    return topSeqEl.attrs.tcFormat === "DF" ? makeFrameRate(base.timebase, base.ntsc, true) : base;
  })();

  // One media list shared by every sequence (nested ones included): relinking sees all of them.
  const mediaMap = new Map<string, SeqMedia>();
  const mediaList: SeqMedia[] = [];
  const mediaFor = (asset: AssetInfo): SeqMedia => {
    const cached = mediaMap.get(asset.id);
    if (cached) return cached;
    const fmt = asset.formatId ? formats.get(asset.formatId) : undefined;
    const mediaRate = fmt?.rate ?? topRate;
    const media: SeqMedia = {
      key: asset.id,
      name: asset.name,
      pathUrl: asset.src,
      kind: !asset.hasVideo && asset.hasAudio ? "audio" : IMAGE_EXT.test(asset.name) ? "image" : "video",
      durationSec: asset.durationSec,
      rate: mediaRate,
      width: fmt?.width || topFormat?.width || 1920,
      height: fmt?.height || topFormat?.height || 1080,
      hasVideo: asset.hasVideo,
      hasAudio: asset.hasAudio,
      sampleRate: asset.audioRate,
      channels: asset.audioChannels,
    };
    mediaMap.set(asset.id, media);
    mediaList.push(media);
    return media;
  };

  let counter = 0;
  const nestCache = new Map<string, Sequence>();

  /** Build one neutral sequence from a `<sequence>` element (the project's, or a compound clip's). */
  const buildSequence = (seqEl: XmlElement, name: string, id: string | undefined, stack: readonly string[]): Sequence => {
    const seqFormat = formats.get(seqEl.attrs.format ?? "");
    const baseRate = seqFormat?.rate ?? topRate;
    const rate = seqEl.attrs.tcFormat === "DF" ? makeFrameRate(baseRate.timebase, baseRate.ntsc, true) : baseRate;
    const tcStart = parseFcpTime(seqEl.attrs.tcStart);
    const frameOf = (seconds: number): number => Math.max(0, secondsToFrames(seconds - tcStart, rate));

    interface Placed {
      clip: SeqClip;
      key: string;
      isVideo: boolean;
      lane: number;
    }
    const placed: Placed[] = [];
    const transitions: SeqTransition[] = [];
    const markers: SeqMarker[] = [];

    // All times below are absolute FCPXML times (they include tcStart).
    const handleItem = (c: XmlElement, parentAbs: number, parentLocalStart: number, inheritedLane: number): void => {
      if (c.name === "marker" || c.name === "chapter-marker") {
        const at = parentAbs + (parseFcpTime(c.attrs.start) - parentLocalStart);
        const frame = frameOf(at);
        const durationFrames = c.attrs.duration !== undefined ? frameOf(at + parseFcpTime(c.attrs.duration)) - frame : 0;
        markers.push({
          frame,
          name: c.attrs.value ?? "",
          ...(durationFrames > 1 ? { durationFrames } : {}),
          ...(c.attrs.note ? { comment: c.attrs.note } : {}),
          ...(c.name === "chapter-marker" ? { kind: "chapter" as const } : {}),
        });
        return;
      }
      if (c.name === "asset-clip" || c.name === "clip" || c.name === "video" || c.name === "audio") {
        const lane = c.attrs.lane !== undefined ? Number(c.attrs.lane) : inheritedLane;
        const offsetAbs = parentAbs + (parseFcpTime(c.attrs.offset) - parentLocalStart);
        const refEl = c.name === "clip" ? (child(c, "video") ?? child(c, "audio") ?? child(c, "asset-clip")) : c;
        const asset = assets.get(refEl?.attrs.ref ?? "");
        if (!asset) {
          warnings.push(`Clip "${c.attrs.name ?? c.name}" references an unsupported or missing resource and was skipped.`);
          return;
        }
        placeAsset(c, asset, offsetAbs, lane);
        return;
      }
      if (c.name === "ref-clip") {
        const lane = c.attrs.lane !== undefined ? Number(c.attrs.lane) : inheritedLane;
        placeRefClip(c, parentAbs + (parseFcpTime(c.attrs.offset) - parentLocalStart), lane);
        return;
      }
      if (c.name === "mc-clip") {
        const lane = c.attrs.lane !== undefined ? Number(c.attrs.lane) : inheritedLane;
        placeMcClip(c, parentAbs + (parseFcpTime(c.attrs.offset) - parentLocalStart), lane);
        return;
      }
      if (["sync-clip", "title", "audition"].includes(c.name)) {
        warnings.push(`<${c.name}> "${c.attrs.name ?? ""}" is not supported and was skipped.`);
      }
    };
    const walkChildren = (el: XmlElement, abs: number, localStart: number, lane: number): void => {
      for (const c of el.children) handleItem(c, abs, localStart, lane);
    };

    interface Timing {
      readonly inSec: number;
      readonly outSec: number;
      readonly speed: number;
      readonly reversed: boolean;
    }
    /** Source window + retime of a clip element. `baseSec` is the source's own start; `map` converts parent time to source time. */
    const timingOf = (el: XmlElement, label: string, baseSec: number, map: (t: number) => number): Timing => {
      const duration = parseFcpTime(el.attrs.duration);
      const start = map(parseFcpTime(el.attrs.start));
      const pts = childrenNamed(child(el, "timeMap"), "timept");
      let inSec = start - baseSec;
      let outSec = inSec + duration;
      let speed = 1;
      let reversed = false;
      if (pts.length >= 2) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        const t0 = parseFcpTime(first.attrs.time);
        const t1 = parseFcpTime(last.attrs.time);
        const v0 = map(parseFcpTime(first.attrs.value)) - baseSec;
        const v1 = map(parseFcpTime(last.attrs.value)) - baseSec;
        reversed = v1 < v0;
        inSec = Math.min(v0, v1);
        outSec = Math.max(v0, v1);
        speed = t1 > t0 ? Math.abs(v1 - v0) / (t1 - t0) : 1;
        if (pts.length > 2) warnings.push(`Clip "${label}" has a variable speed ramp; imported as its average speed.`);
        if (Math.abs(speed - 1) < 1e-9) speed = 1;
      }
      return { inSec, outSec, speed, reversed };
    };
    const frames = (el: XmlElement, offsetAbs: number): { startFrame: number; endFrame: number } => {
      const startFrame = frameOf(offsetAbs);
      return { startFrame, endFrame: Math.max(startFrame + 1, frameOf(offsetAbs + parseFcpTime(el.attrs.duration))) };
    };

    /** <audio-channel-source srcCh="3" outCh="C">: which file channels the clip plays (1-based in the file). */
    const audioChannelsOf = (el: XmlElement, asset: AssetInfo): SeqClip["audioChannels"] | undefined => {
      const source = child(el, "audio-channel-source");
      if (!source || !asset.hasAudio) return undefined;
      const list = (value: string | undefined): string[] => (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
      const src = list(source.attrs.srcCh).map((part) => Number(part) - 1);
      const out = list(source.attrs.outCh);
      if (!src.length || src.some((n) => !Number.isInteger(n) || n < 0)) return undefined;
      const fileChannels = Math.max(asset.audioChannels, ...src.map((n) => n + 1));
      const format = FCP_OUT_TO_FORMAT(out.length ? out : src.map(() => "X"));
      const slots = FCP_OUT_CHANNELS[format];
      const sources = slots.map((slot, index) => {
        const at = out.indexOf(slot);
        return at >= 0 ? src[at] : out.length ? -1 : (src[index] ?? -1);
      });
      const untouched = format === "stereo" && sources[0] === 0 && sources[1] === 1 && fileChannels === 2;
      return untouched ? undefined : { format, sources, fileChannels };
    };

    const placeAsset = (
      el: XmlElement,
      asset: AssetInfo,
      offsetAbs: number,
      lane: number,
      mapTime: (t: number) => number = (t) => t,
      forceVideoOnly = false,
    ): void => {
      const media = mediaFor(asset);
      const label = el.attrs.name ?? asset.name;
      const timing = timingOf(el, label, asset.startSec, mapTime);
      const blend = child(el, "adjust-blend")?.attrs.amount;
      const vol = linearOf(child(el, "adjust-volume")?.attrs.amount);
      const srcEnable = forceVideoOnly ? "video" : (el.attrs.srcEnable ?? "all");
      const isVideo = asset.hasVideo && srcEnable !== "audio";
      if (el.attrs.enabled === "0") warnings.push(`Clip "${label}" is disabled in the source; it was imported enabled.`);
      const clip: SeqClip = {
        id: `fcpx-${counter++}`,
        name: label,
        mediaKey: media.key,
        ...frames(el, offsetAbs),
        inSec: Math.max(0, timing.inSec),
        outSec: Math.max(0, timing.outSec),
        speed: timing.speed,
        reversed: timing.reversed,
        opacity: blend !== undefined && Number.isFinite(Number(blend)) ? Number(blend) : 1,
        volume: vol ?? 1,
        withAudio: isVideo && asset.hasAudio && srcEnable !== "video",
        ...(audioChannelsOf(el, asset) ? { audioChannels: audioChannelsOf(el, asset) } : {}),
      };
      placed.push({ clip, key: String(lane), isVideo, lane });
      walkChildren(el, offsetAbs, parseFcpTime(el.attrs.start), lane);
    };

    /** A compound clip: its `<media><sequence>` becomes a nested sequence (shared between instances). */
    const placeRefClip = (el: XmlElement, offsetAbs: number, lane: number): void => {
      const label = el.attrs.name ?? "Compound clip";
      const resourceId = el.attrs.ref ?? "";
      const resource = mediaResources.get(resourceId);
      const innerEl = resource ? child(resource, "sequence") : undefined;
      if (!resource || !innerEl) {
        warnings.push(`<ref-clip> "${label}" references a resource that is not a compound clip and was skipped.`);
        return;
      }
      if (stack.includes(resourceId) || stack.length >= MAX_NEST_DEPTH) {
        warnings.push(`Compound clip "${label}" contains itself (or nests too deeply) and was skipped.`);
        return;
      }
      let nested = nestCache.get(resourceId);
      if (!nested) {
        nested = buildSequence(innerEl, resource.attrs.name ?? label, `fcpxml:${resourceId}`, [...stack, resourceId]);
        nestCache.set(resourceId, nested);
      }
      const nestedTc = parseFcpTime(innerEl.attrs.tcStart);
      const timing = timingOf(el, label, nestedTc, (t) => t);
      const blend = child(el, "adjust-blend")?.attrs.amount;
      const vol = linearOf(child(el, "adjust-volume")?.attrs.amount);
      const srcEnable = el.attrs.srcEnable ?? "all";
      const hasVideo = nested.tracks.some((t) => t.kind === "video" && t.clips.length > 0);
      const hasAudio = nested.tracks.some((t) => t.kind === "audio" && t.clips.length > 0);
      const isVideo = srcEnable !== "audio" || !hasAudio;
      if (el.attrs.enabled === "0") warnings.push(`Clip "${label}" is disabled in the source; it was imported enabled.`);
      const clip: SeqClip = {
        id: `fcpx-${counter++}`,
        name: nested.name,
        mediaKey: "",
        ...frames(el, offsetAbs),
        inSec: Math.max(0, timing.inSec),
        outSec: Math.max(0, timing.outSec),
        speed: timing.speed,
        reversed: timing.reversed,
        opacity: blend !== undefined && Number.isFinite(Number(blend)) ? Number(blend) : 1,
        volume: vol ?? 1,
        withAudio: isVideo && hasAudio && srcEnable !== "video" && hasVideo,
        nested,
      };
      placed.push({ clip, key: String(lane), isVideo, lane });
      walkChildren(el, offsetAbs, parseFcpTime(el.attrs.start), lane);
    };

    /** A multicam clip: OpenReel keeps multicam as cuts of one angle's media, so import the selected angle. */
    const placeMcClip = (el: XmlElement, offsetAbs: number, lane: number): void => {
      const label = el.attrs.name ?? "Multicam clip";
      const resource = mediaResources.get(el.attrs.ref ?? "");
      const multicam = resource ? child(resource, "multicam") : undefined;
      if (!multicam) {
        warnings.push(`<mc-clip> "${label}" references a resource that is not a multicam clip and was skipped.`);
        return;
      }
      const sources = childrenNamed(el, "mc-source");
      const picked = sources.find((s) => (s.attrs.srcEnable ?? "all") !== "audio" && s.attrs.srcEnable !== "none") ?? sources[0];
      const angles = childrenNamed(multicam, "mc-angle");
      const angle = angles.find((a) => a.attrs.angleID === picked?.attrs.angleID) ?? angles[0];
      const angleClip = angle ? (childrenNamed(angle, "asset-clip")[0] ?? childrenNamed(angle, "clip")[0]) : undefined;
      const refEl = angleClip && angleClip.name === "clip" ? (child(angleClip, "video") ?? child(angleClip, "audio") ?? child(angleClip, "asset-clip")) : angleClip;
      const asset = assets.get(refEl?.attrs.ref ?? "");
      if (!angle || !angleClip || !asset) {
        warnings.push(`Multicam clip "${label}" has no usable angle media and was skipped.`);
        return;
      }
      // Shared (multicam) time -> the angle media's own time.
      const placement = parseFcpTime(angleClip.attrs.offset);
      const angleStart = parseFcpTime(angleClip.attrs.start);
      const toAssetTime = (t: number): number => t - placement + angleStart;
      warnings.push(`Multicam clip "${label}" was imported as its active angle "${angle.attrs.name ?? angle.attrs.angleID}"; the other angles are not kept.`);
      const videoOnly = (picked?.attrs.srcEnable ?? "all") === "video";
      placeAsset(el, asset, offsetAbs, lane, toAssetTime, videoOnly);
    };

    const spine = child(seqEl, "spine");
    if (!spine) throw new Error("The FCPXML sequence has no spine.");
    for (const item of spine.children) {
      if (item.name === "transition") {
        const kind: SeqTransitionKind | null = transitionKindFromName(item.attrs.name ?? "");
        if (!kind) warnings.push(`Transition "${item.attrs.name ?? ""}" is not supported; imported as a cross dissolve.`);
        const offsetAbs = parseFcpTime(item.attrs.offset);
        const startF = frameOf(offsetAbs);
        const endF = frameOf(offsetAbs + parseFcpTime(item.attrs.duration));
        if (endF > startF) transitions.push({ kind: kind ?? "dissolve", startFrame: startF, endFrame: endF, alignment: "center" });
      } else if (item.name === "gap") {
        walkChildren(item, parseFcpTime(item.attrs.offset), parseFcpTime(item.attrs.start), 0);
      } else {
        handleItem(item, 0, 0, 0);
      }
    }

    // Video tracks: lane 0 (primary) first, then ascending lanes. Audio: 0, -1, -2...
    const buildKind = (isVideo: boolean): SeqTrack[] => {
      const lanes = [...new Set(placed.filter((p) => p.isVideo === isVideo).map((p) => p.lane))];
      lanes.sort((a, b) => (isVideo ? a - b : b - a));
      return lanes.map((lane, i) => ({
        kind: isVideo ? "video" : "audio",
        name: `${isVideo ? "V" : "A"}${i + 1}`,
        clips: placed
          .filter((p) => p.isVideo === isVideo && p.lane === lane)
          .map((p) => p.clip)
          .sort((a, b) => a.startFrame - b.startFrame),
        transitions: isVideo && lane === 0 ? transitions : [],
        disabled: false,
        locked: false,
      }));
    };
    const videoTracks = buildKind(true);
    const audioTracks = buildKind(false);
    if (transitions.length && !videoTracks.some((t) => t.transitions.length)) {
      // transitions with no primary storyline clips: attach to the first video track
      if (videoTracks[0]) videoTracks[0] = { ...videoTracks[0], transitions };
    }

    const uniqueMarkers: SeqMarker[] = [];
    for (const m of markers) {
      if (!uniqueMarkers.some((u) => u.frame === m.frame && u.name === m.name)) uniqueMarkers.push(m);
    }
    uniqueMarkers.sort((a, b) => a.frame - b.frame);

    const tracks = [...videoTracks, ...audioTracks];
    const maxEnd = tracks.reduce((m, t) => t.clips.reduce((x, c) => Math.max(x, c.endFrame), m), 0);
    return {
      ...(id ? { id } : {}),
      name,
      rate,
      width: seqFormat?.width || 1920,
      height: seqFormat?.height || 1080,
      durationFrames: Math.max(maxEnd, frameOf(parseFcpTime(seqEl.attrs.duration) + tcStart)),
      tracks,
      markers: uniqueMarkers,
      media: mediaList,
    };
  };

  const projectName = (() => {
    const proj = findFirst(root, "project");
    return proj?.attrs.name ?? topSeqEl.attrs.name ?? "Imported Sequence";
  })();
  const sequence = buildSequence(topSeqEl, projectName, undefined, []);
  return { sequence, report: { warnings } };
}

function findFirst(root: XmlElement, name: string): XmlElement | undefined {
  if (root.name === name) return root;
  for (const c of root.children) {
    const hit = findFirst(c, name);
    if (hit) return hit;
  }
  return undefined;
}
