import { CfbError, parseCfb } from "./cfb";
import { CLASS, DATADEF, OPERATION, PARAMETER, PID } from "./ids";
import { AafObject } from "./objects";
import { basenameOfUrl, type InterchangeReport, type SeqClip, type SeqMarker, type SeqMedia, type SeqTrack, type SeqTransition, type Sequence } from "../model";
import { resolveFrameRate, type FrameRate } from "../timecode";

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** True when the bytes start like a compound file (every AAF file does). */
export const looksLikeCompoundFile = (bytes: Uint8Array): boolean =>
  bytes.length >= 8 && CFB_SIGNATURE.every((b, i) => bytes[i] === b);

type Kind = "picture" | "sound" | "timecode" | "descriptive" | "other";

const KIND_OF: Record<string, Kind> = {
  [DATADEF.picture]: "picture",
  [DATADEF.legacyPicture]: "picture",
  "05cba731-1daa-11d3-80ad-006008143e6f": "picture",
  "05cba732-1daa-11d3-80ad-006008143e6f": "picture",
  [DATADEF.sound]: "sound",
  [DATADEF.legacySound]: "sound",
  [DATADEF.timecode]: "timecode",
  [DATADEF.legacyTimecode]: "timecode",
  [DATADEF.descriptive]: "descriptive",
};

const OPERATION_NAMES: Record<string, string> = {
  [OPERATION.videoDissolve]: "Video Dissolve",
  [OPERATION.monoAudioDissolve]: "Audio Dissolve",
  [OPERATION.stereoAudioDissolve]: "Audio Dissolve",
  [OPERATION.videoFadeToBlack]: "Fade To Black",
  [OPERATION.smpteVideoWipe]: "SMPTE Wipe",
  [OPERATION.videoSpeedControl]: "Speed Control",
  [OPERATION.monoAudioGain]: "Audio Gain",
  [OPERATION.stereoAudioGain]: "Audio Gain",
  [OPERATION.videoOpacity]: "Opacity",
};

const isNullMobId = (data: Uint8Array | undefined): boolean => !data || data.every((b) => b === 0);

/** An item of a flattened slot, lengths in the slot's own edit units. */
type Item =
  | {
      readonly t: "clip";
      len: number;
      srcLen: number;
      readonly start: number;
      readonly mobKey: string | null;
      readonly slotId: number;
      speed: number;
      reversed: boolean;
      gain: number;
      readonly slotRate: number;
    }
  | { readonly t: "filler"; readonly len: number }
  | { readonly t: "transition"; readonly len: number; readonly cutPoint: number; readonly op: string };

interface MediaInfo {
  readonly key: string;
  readonly name: string;
  readonly pathUrl?: string;
  readonly hasPicture: boolean;
  readonly channels: number;
  readonly width: number;
  readonly height: number;
  readonly rate: FrameRate | null;
  readonly sampleRate: number;
  durationSec: number;
}

const ratio = (r: { num: number; den: number } | undefined): number => (r && r.den !== 0 ? r.num / r.den : 0);

export function parseAaf(bytes: Uint8Array): { sequence: Sequence; report: InterchangeReport } {
  const warnings: string[] = [];
  let tree;
  try {
    tree = parseCfb(bytes);
  } catch (error) {
    throw new Error(`This file is not a readable AAF (${error instanceof CfbError ? error.message : "corrupt container"}).`);
  }
  const root = new AafObject(tree);
  const header = root.ref(PID.rootHeader);
  const content = header?.ref(PID.headerContent);
  if (!header || !content) throw new Error("This compound file is not an AAF (no Header or Content storage).");

  const mobs = new Map<string, AafObject>();
  const mobList = content.list(PID.contentMobs);
  for (const mob of mobList) {
    const key = mob.mobKey(PID.mobId);
    if (key) mobs.set(key, mob);
  }
  const compositions = mobList.filter((m) => m.classId === CLASS.compositionMob);
  if (!compositions.length) throw new Error("This AAF has no composition (edit), only media.");
  const composition =
    compositions.find((m) => m.auid(PID.mobUsageCode) === "0d010102-0101-0700-060e-2b3404010101") ?? compositions[0];
  if (compositions.length > 1) {
    warnings.push(`The file holds ${compositions.length} compositions; "${composition.str(PID.mobName) || "the top-level one"}" was imported and the others were ignored.`);
  }

  const slotRate = (slot: AafObject): number =>
    ratio(slot.rational(slot.classId === CLASS.eventMobSlot ? PID.eventEditRate : PID.timelineEditRate));

  const kindOf = (segment: AafObject | undefined): Kind => {
    const id = segment?.weakAuid(PID.dataDefinition);
    return (id && KIND_OF[id]) || "other";
  };

  // ── media resolution ──────────────────────────────────────────────────────
  const mediaCache = new Map<string, MediaInfo>();
  const firstSourceClip = (segment: AafObject | undefined, depth = 0): AafObject | undefined => {
    if (!segment || depth > 6) return undefined;
    if (segment.classId === CLASS.sourceClip) return segment;
    if (segment.classId === CLASS.sequence) {
      for (const c of segment.list(PID.components)) {
        const found = firstSourceClip(c, depth + 1);
        if (found) return found;
      }
    }
    if (segment.classId === CLASS.operationGroup) return firstSourceClip(segment.list(PID.ogInputSegments)[0], depth + 1);
    return undefined;
  };
  const slotOf = (mob: AafObject, slotId: number): AafObject | undefined =>
    mob.list(PID.mobSlots).find((s) => s.u32(PID.slotId) === slotId);

  const urlOf = (mob: AafObject): string | undefined => {
    const descriptor = mob.ref(PID.sourceMobDescriptor);
    if (!descriptor) return undefined;
    for (const locator of descriptor.list(PID.descriptorLocator)) {
      const url = locator.str(PID.locatorUrl);
      if (url) return url;
    }
    return undefined;
  };

  /** Follow master -> source -> ... to the mob that carries the file location; returns offset (seconds) added on the way. */
  const trace = (startKey: string, slotId: number): { fileMob: AafObject | undefined; offsetSec: number } => {
    let key: string | null = startKey;
    let slot = slotId;
    let offset = 0;
    for (let hop = 0; hop < 8 && key; hop++) {
      const mob = mobs.get(key);
      if (!mob) return { fileMob: undefined, offsetSec: offset };
      if (urlOf(mob)) return { fileMob: mob, offsetSec: offset };
      const s = slotOf(mob, slot);
      const clip = firstSourceClip(s?.ref(PID.slotSegment));
      if (!s || !clip) return { fileMob: mob, offsetSec: offset };
      const rate = slotRate(s);
      const start = clip.i64(PID.startTime) ?? 0;
      if (rate > 0 && Number.isFinite(start)) offset += start / rate;
      if (isNullMobId(clip.raw(PID.sourceId))) return { fileMob: mob, offsetSec: offset };
      key = clip.mobKey(PID.sourceId) ?? null;
      slot = clip.u32(PID.sourceMobSlotId) ?? 0;
    }
    return { fileMob: undefined, offsetSec: offset };
  };

  const mediaFor = (mobKey: string): MediaInfo | undefined => {
    const cached = mediaCache.get(mobKey);
    if (cached) return cached;
    const master = mobs.get(mobKey);
    if (!master) return undefined;
    if (master.classId === CLASS.compositionMob) {
      warnings.push(`A clip refers to the composition "${master.str(PID.mobName) ?? ""}"; nested compositions are not imported.`);
      return undefined;
    }
    let hasPicture = false;
    let channels = 0;
    let rate: FrameRate | null = null;
    let sampleRate = 0;
    let durationSec = 0;
    let pictureSlot = 0;
    for (const s of master.list(PID.mobSlots)) {
      const seg = s.ref(PID.slotSegment);
      const kind = kindOf(seg);
      const r = slotRate(s);
      const length = seg?.i64(PID.length) ?? 0;
      if (kind === "picture") {
        hasPicture = true;
        pictureSlot = s.u32(PID.slotId) ?? 1;
        if (r > 0) rate = resolveFrameRate(r);
        if (r > 0 && Number.isFinite(length)) durationSec = Math.max(durationSec, length / r);
      } else if (kind === "sound") {
        channels += 1;
        if (r > 0) sampleRate = r;
        if (r > 0 && Number.isFinite(length) && !hasPicture) durationSec = Math.max(durationSec, length / r);
      }
    }
    const probeSlot = pictureSlot || (master.list(PID.mobSlots)[0]?.u32(PID.slotId) ?? 1);
    const { fileMob } = trace(mobKey, probeSlot);
    const url = fileMob ? urlOf(fileMob) : undefined;
    const descriptor = fileMob?.ref(PID.sourceMobDescriptor);
    const width = descriptor?.u32(0x3203) ?? 0;
    const height = descriptor?.u32(0x3202) ?? 0;
    const name = (url ? basenameOfUrl(url) : "") || master.str(PID.mobName) || "Media";
    if (!url) warnings.push(`"${name}" has no external file location (embedded or unlinked media); it was imported as a placeholder to relink by name.`);
    const info: MediaInfo = {
      key: mobKey,
      name,
      ...(url ? { pathUrl: url } : {}),
      hasPicture,
      channels,
      width,
      height,
      rate,
      sampleRate,
      durationSec,
    };
    mediaCache.set(mobKey, info);
    return info;
  };

  // ── slot flattening ───────────────────────────────────────────────────────
  const unsupportedOps = new Set<string>();
  const noteOperation = (id: string): void => {
    if (unsupportedOps.has(id)) return;
    unsupportedOps.add(id);
    warnings.push(`Effect "${OPERATION_NAMES[id] ?? id}" is not imported; the clip is placed without it.`);
  };

  /** Constant Rational parameter value by parameter id, or undefined (also for keyframed parameters). */
  const parameterValue = (og: AafObject, parameterId: string): number | undefined => {
    for (const p of og.list(PID.ogParameters)) {
      if (p.auid(PID.paramDefinition) !== parameterId) continue;
      if (p.classId !== CLASS.constantValue) {
        warnings.push("A keyframed audio level or speed was found; only constant values are imported.");
        return undefined;
      }
      const raw = p.raw(PID.paramValue);
      if (!raw || raw.length < 25) return undefined;
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const little = raw[0] === 0x4c;
      const num = dv.getInt32(17, little);
      const den = dv.getInt32(21, little);
      return den !== 0 ? num / den : undefined;
    }
    return undefined;
  };

  const walk = (segment: AafObject | undefined, depth = 0): Item[] => {
    if (!segment || depth > 12) return [];
    const length = segment.i64(PID.length) ?? 0;
    switch (segment.classId) {
      case CLASS.sequence:
        return segment.list(PID.components).flatMap((c) => walk(c, depth + 1));
      case CLASS.sourceClip: {
        const nullRef = isNullMobId(segment.raw(PID.sourceId));
        if (nullRef) return [{ t: "filler", len: length }];
        return [
          {
            t: "clip",
            len: length,
            srcLen: length,
            start: segment.i64(PID.startTime) ?? 0,
            mobKey: segment.mobKey(PID.sourceId) ?? null,
            slotId: segment.u32(PID.sourceMobSlotId) ?? 0,
            speed: 1,
            reversed: false,
            gain: 1,
            slotRate: 0,
          },
        ];
      }
      case CLASS.filler:
        return [{ t: "filler", len: length }];
      case CLASS.transition: {
        const og = segment.ref(PID.transitionOperationGroup);
        return [{ t: "transition", len: length, cutPoint: segment.i64(PID.transitionCutPoint) ?? Math.floor(length / 2), op: og?.weakAuid(PID.ogOperation) ?? "" }];
      }
      case CLASS.operationGroup: {
        const op = segment.weakAuid(PID.ogOperation) ?? "";
        const inner = walk(segment.list(PID.ogInputSegments)[0], depth + 1);
        if (op === OPERATION.videoSpeedControl) {
          const r = parameterValue(segment, PARAMETER.speedRatio);
          const clipItem = inner.length === 1 && inner[0].t === "clip" ? inner[0] : undefined;
          if (clipItem && r !== undefined && r !== 0) {
            clipItem.srcLen = clipItem.len;
            clipItem.len = length || Math.round(clipItem.srcLen / Math.abs(r));
            clipItem.speed = Math.abs(r);
            clipItem.reversed = r < 0;
          } else if (!clipItem || r === undefined) {
            noteOperation(op);
          }
          return inner;
        }
        if (op === OPERATION.monoAudioGain || op === OPERATION.stereoAudioGain) {
          const g = parameterValue(segment, PARAMETER.amplitude) ?? 1;
          for (const item of inner) if (item.t === "clip") item.gain *= g;
          return inner;
        }
        noteOperation(op);
        return inner.length ? inner : [{ t: "filler", len: length }];
      }
      default: {
        const kind = segment.classId;
        warnings.push(`An AAF component (${kind}) is not supported and was left as a gap.`);
        return [{ t: "filler", len: length }];
      }
    }
  };

  // ── slots ─────────────────────────────────────────────────────────────────
  const slots = composition.list(PID.mobSlots);
  let seqRate: FrameRate | null = null;
  let startTc: { frames: number; rate: number; drop: boolean } | null = null;
  let dropFrame = false;

  // First pass: sequence rate and start timecode.
  for (const slot of slots) {
    const seg = slot.ref(PID.slotSegment);
    const kind = kindOf(seg);
    const r = slotRate(slot);
    if (kind === "timecode") {
      const tc = seg?.classId === CLASS.timecode ? seg : seg?.list(PID.components).find((c) => c.classId === CLASS.timecode);
      if (tc) {
        startTc = { frames: tc.i64(PID.tcStart) ?? 0, rate: r, drop: (tc.u8(PID.tcDrop) ?? 0) !== 0 };
        dropFrame = startTc.drop;
      }
    }
  }
  const firstVideo = slots.find((s) => kindOf(s.ref(PID.slotSegment)) === "picture" && slotRate(s) > 0);
  const firstTimeline = slots.find((s) => s.classId === CLASS.timelineMobSlot && slotRate(s) > 0 && kindOf(s.ref(PID.slotSegment)) !== "timecode");
  const rateSource = firstVideo ?? firstTimeline ?? slots.find((s) => slotRate(s) > 0);
  if (!rateSource) throw new Error("The composition has no tracks with an edit rate.");
  seqRate = resolveFrameRate(slotRate(rateSource), { dropFrame });
  const fps = seqRate.num / seqRate.den;
  const toFrames = (units: number, rate: number): number => Math.round((units / rate) * fps);

  const media = new Map<string, MediaInfo>();
  const videoTracks: SeqTrack[] = [];
  const audioTracks: { track: SeqTrack }[] = [];
  const markers: SeqMarker[] = [];
  let clipSerial = 0;

  const buildTrack = (slot: AafObject, kind: "video" | "audio"): { track: SeqTrack; signature: string } | null => {
    const rate = slotRate(slot);
    if (rate <= 0) return null;
    let segment = slot.ref(PID.slotSegment);
    let trackGain = 1;
    // A gain wrapped around the whole track is the track fader.
    while (segment && segment.classId === CLASS.operationGroup) {
      const op = segment.weakAuid(PID.ogOperation);
      const input = segment.list(PID.ogInputSegments)[0];
      if (!input || input.classId !== CLASS.sequence) break;
      if (op === OPERATION.monoAudioGain || op === OPERATION.stereoAudioGain) trackGain *= parameterValue(segment, PARAMETER.amplitude) ?? 1;
      else noteOperation(op ?? "");
      segment = input;
    }
    const items = walk(segment);

    // Place items on the timeline; transitions overlap the clips around them.
    interface Placed {
      item: Extract<Item, { t: "clip" }>;
      start: number;
      end: number;
      mediaKey: string;
      inSec: number;
      outSec: number;
    }
    const placed: Placed[] = [];
    const transitions: { prev: Placed; next?: Placed; len: number; cutPoint: number; op: string }[] = [];
    let pos = 0;
    let pending: { prev: Placed; len: number; cutPoint: number; op: string } | null = null;
    let lastWasClip: Placed | null = null;
    for (const item of items) {
      if (item.t === "filler") {
        pos += item.len;
        lastWasClip = null;
        pending = null;
        continue;
      }
      if (item.t === "transition") {
        if (lastWasClip && item.len > 0) {
          pending = { prev: lastWasClip, len: item.len, cutPoint: item.cutPoint, op: item.op };
          pos -= item.len;
        } else {
          warnings.push("A transition without a clip in front of it was skipped.");
        }
        lastWasClip = null;
        continue;
      }
      const info = item.mobKey ? mediaFor(item.mobKey) : undefined;
      if (!info || !item.mobKey) {
        pos += item.len;
        lastWasClip = null;
        pending = null;
        continue;
      }
      const trace1 = trace(item.mobKey, item.slotId);
      const baseSec = item.start / rate + trace1.offsetSec;
      const srcSec = item.srcLen / rate;
      let inSec = baseSec;
      let outSec = baseSec + srcSec;
      if (item.reversed) {
        outSec = (item.start + 1) / rate + trace1.offsetSec;
        inSec = outSec - srcSec;
      }
      const p: Placed = { item, start: pos, end: pos + item.len, mediaKey: item.mobKey, inSec: Math.max(0, inSec), outSec };
      media.set(info.key, info);
      placed.push(p);
      if (pending) {
        transitions.push({ ...pending, next: p });
        pending = null;
      }
      pos += item.len;
      lastWasClip = p;
    }

    // Trim the borrowed frames back off: the clips meet at the transition's cut point.
    const seqTransitions: SeqTransition[] = [];
    for (const tr of transitions) {
      if (!tr.next) continue;
      const before = Math.max(0, Math.min(tr.len, tr.cutPoint));
      const after = tr.len - before;
      const a = tr.prev;
      const b = tr.next;
      const cut = b.start + before;
      const aSpeed = a.item.speed || 1;
      const bSpeed = b.item.speed || 1;
      a.end -= after;
      a.outSec -= (after / rate) * aSpeed;
      b.start += before;
      b.inSec += (before / rate) * bSpeed;
      if (kind === "video") {
        const startFrame = toFrames(cut, rate) - Math.floor(toFrames(tr.len, rate) / 2);
        const dur = Math.max(2, toFrames(tr.len, rate));
        seqTransitions.push({
          kind: tr.op === OPERATION.videoFadeToBlack ? "dipToBlack" : tr.op === OPERATION.smpteVideoWipe ? "wipe" : "dissolve",
          startFrame,
          endFrame: startFrame + dur,
          alignment: "center",
        });
        if (tr.op && tr.op !== OPERATION.videoDissolve && tr.op !== OPERATION.videoFadeToBlack && tr.op !== OPERATION.smpteVideoWipe) {
          noteOperation(tr.op);
        }
      } else {
        warnings.push("An audio transition was imported as a cut; audio crossfades are not carried.");
      }
    }

    const clips: SeqClip[] = placed.map((p) => {
      const info = media.get(p.mediaKey);
      return {
        id: `aaf-${clipSerial++}`,
        name: info?.name ?? "Clip",
        mediaKey: p.mediaKey,
        startFrame: toFrames(p.start, rate),
        endFrame: Math.max(toFrames(p.start, rate) + 1, toFrames(p.end, rate)),
        inSec: p.inSec,
        outSec: Math.max(p.inSec, p.outSec),
        speed: p.item.speed,
        reversed: p.item.reversed,
        opacity: 1,
        volume: p.item.gain,
        withAudio: false,
      };
    });
    const track: SeqTrack = {
      kind,
      name: "",
      clips,
      transitions: seqTransitions,
      disabled: false,
      locked: false,
      ...(kind === "audio" && Math.abs(trackGain - 1) > 1e-6 ? { gain: trackGain } : {}),
    };
    return {
      track,
      signature: placed.map((p) => `${p.mediaKey}@${p.start}+${p.end - p.start}:${p.inSec.toFixed(4)}`).join("|"),
    };
  };

  const audioSignatures: string[] = [];
  for (const slot of slots) {
    const seg = slot.ref(PID.slotSegment);
    const kind = kindOf(seg);
    const rate = slotRate(slot);
    if (kind === "picture") {
      const built = buildTrack(slot, "video");
      if (built) videoTracks.push({ ...built.track, name: `V${videoTracks.length + 1}` });
    } else if (kind === "sound") {
      const built = buildTrack(slot, "audio");
      if (!built) continue;
      // Stereo files come as two mono slots playing the same clips: fold the pair into one track.
      if (built.signature && audioSignatures[audioSignatures.length - 1] === built.signature) {
        continue;
      }
      audioSignatures.push(built.signature);
      audioTracks.push({ track: built.track });
    } else if (kind === "descriptive" || slot.classId === CLASS.eventMobSlot) {
      const collect = (segment: AafObject | undefined, depth = 0): void => {
        if (!segment || depth > 4) return;
        if (segment.classId === CLASS.sequence) {
          for (const c of segment.list(PID.components)) collect(c, depth + 1);
          return;
        }
        if (segment.classId !== CLASS.descriptiveMarker && segment.classId !== CLASS.commentMarker) return;
        const position = segment.i64(PID.eventPosition) ?? 0;
        const text = segment.str(PID.eventComment) ?? "";
        const nl = text.indexOf("\n");
        const name = nl >= 0 ? text.slice(0, nl) : text;
        const comment = nl >= 0 ? text.slice(nl + 1) : "";
        const len = segment.i64(PID.length) ?? 0;
        const rateForSlot = rate > 0 ? rate : fps;
        const frame = Math.max(0, toFrames(position, rateForSlot));
        const durationFrames = len > 0 ? Math.max(0, toFrames(position + len, rateForSlot) - frame) : 0;
        markers.push({
          frame,
          name,
          ...(durationFrames > 0 ? { durationFrames } : {}),
          ...(comment ? { comment } : {}),
        });
      };
      collect(seg);
    } else if (kind === "other" && seg) {
      warnings.push(`A track of an unsupported kind was skipped (${slot.str(PID.slotName) || "unnamed"}).`);
    }
  }

  // A video clip that carries its own sound: fold the identical audio clip into it (as the other importers do).
  const mediaHasBoth = (key: string): boolean => {
    const m = media.get(key);
    return !!m && m.hasPicture && m.channels > 0;
  };
  const audioOut: SeqTrack[] = [];
  const absorbed = new Set<string>();
  for (const entry of audioTracks) {
    for (const a of entry.track.clips) {
      if (!mediaHasBoth(a.mediaKey)) continue;
      for (const vt of videoTracks) {
        const v = vt.clips.find(
          (c) =>
            c.mediaKey === a.mediaKey &&
            c.startFrame === a.startFrame &&
            c.endFrame === a.endFrame &&
            Math.abs(c.inSec - a.inSec) < 1 / (2 * fps) &&
            !c.withAudio,
        );
        if (v) {
          absorbed.add(a.id);
          (v as { withAudio: boolean }).withAudio = true;
          (v as { volume: number }).volume = a.volume;
          break;
        }
      }
    }
  }
  for (const entry of audioTracks) {
    const remaining = entry.track.clips.filter((c) => !absorbed.has(c.id));
    if (remaining.length === 0 && entry.track.clips.length > 0) continue;
    audioOut.push({ ...entry.track, clips: remaining, name: `A${audioOut.length + 1}` });
  }

  const tracks = [...videoTracks, ...audioOut];
  const used = new Map<string, MediaInfo>();
  for (const t of tracks) for (const c of t.clips) if (!used.has(c.mediaKey) && media.get(c.mediaKey)) used.set(c.mediaKey, media.get(c.mediaKey) as MediaInfo);
  const dims = [...used.values()].find((m) => m.width > 0 && m.height > 0);
  if (!dims) warnings.push("The file carries no frame size; the sequence was set to 1920 x 1080.");
  const seqMedia: SeqMedia[] = [...used.values()].map((m) => ({
    key: m.key,
    name: m.name,
    ...(m.pathUrl ? { pathUrl: m.pathUrl } : {}),
    kind: m.hasPicture ? "video" : "audio",
    durationSec: m.durationSec,
    rate: m.rate ?? seqRate,
    width: m.width || dims?.width || 1920,
    height: m.height || dims?.height || 1080,
    hasVideo: m.hasPicture,
    hasAudio: m.channels > 0,
    sampleRate: m.sampleRate || 48000,
    channels: Math.max(1, m.channels),
  }));

  const maxEnd = tracks.reduce((m, t) => t.clips.reduce((x, c) => Math.max(x, c.endFrame), m), 0);
  let startTimecodeFrames: number | undefined;
  if (startTc && startTc.rate > 0) {
    startTimecodeFrames = Math.round((startTc.frames / startTc.rate) * fps);
  } else if (startTc) {
    startTimecodeFrames = startTc.frames;
  }
  if (startTimecodeFrames) {
    warnings.push("The sequence's start timecode is not stored by OpenReel; clips keep their offsets from the start of the sequence.");
  }

  const sequence: Sequence = {
    name: composition.str(PID.mobName) || "Imported Sequence",
    rate: seqRate,
    width: dims?.width || 1920,
    height: dims?.height || 1080,
    durationFrames: maxEnd,
    tracks,
    markers: markers.sort((a, b) => a.frame - b.frame),
    media: seqMedia,
    ...(startTimecodeFrames !== undefined ? { startTimecodeFrames } : {}),
  };
  return { sequence, report: { warnings } };
}
