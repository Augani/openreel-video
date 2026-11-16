import { findChild, parseCfb, storage, writeCfb, type CfbNode } from "./cfb";
import { inflateRaw } from "./inflate";
import {
  CLASS,
  DATADEF,
  OPERATION,
  OPERATION_CATEGORY_EFFECT,
  PARAMETER,
  PID,
  TYPEDEF_RATIONAL,
  USAGE_TOPLEVEL,
  WEAKREF_INDEX,
  WEAKREF_PATHS,
  auid,
  mangleName,
} from "./ids";
import {
  applyProps,
  bool,
  concat,
  dataProp,
  decodeProps,
  encodeProps,
  i32,
  i64,
  obj,
  rational,
  refProp,
  str,
  timestamp,
  u16,
  u32,
  vecProp,
  weakProp,
  type Obj,
  type Prop,
} from "./objects";
import { AAF_TEMPLATE_BASE64, AAF_TEMPLATE_SIZE } from "./template";
import type { SeqClip, SeqTrack, Sequence } from "../model";
import { secondsToFrames, type FrameRate } from "../timecode";

export interface AafWriteOptions {
  /** Timestamp for the header, identification and mobs. Defaults to now. */
  readonly now?: Date;
  /** Start timecode of the sequence, in frames at the sequence rate (default 1 hour, the Avid/Premiere convention). */
  readonly startTimecodeFrames?: number;
  /** Deterministic random bytes for mob ids (tests). */
  readonly randomBytes?: (count: number) => Uint8Array;
}

export interface AafWriteResult {
  readonly bytes: Uint8Array;
  /** Things the writer had to change to fit the format (clamped transitions, audio speed, ...). */
  readonly notes: string[];
}

const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** The embedded empty AAF file (meta dictionary, header, dictionary, identification), parsed fresh. */
export function loadAafTemplate(): CfbNode {
  return parseCfb(inflateRaw(base64ToBytes(AAF_TEMPLATE_BASE64), AAF_TEMPLATE_SIZE));
}

const defaultRandom = (count: number): Uint8Array => {
  const out = new Uint8Array(count);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(out);
  else for (let i = 0; i < count; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
};

const MOB_LABEL = Uint8Array.of(0x06, 0x0a, 0x2b, 0x34, 0x01, 0x01, 0x01, 0x05, 0x01, 0x01, 0x0f, 0x20);
const NULL_MOB_ID = new Uint8Array(32);

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

/** Linear gain -> Rational (denominator 10000, reduced). */
function gainRational(v: number): Uint8Array {
  const den = 10000;
  const num = Math.round(Math.max(0, v) * den);
  const g = gcd(num, den) || 1;
  return rational(num / g, den / g);
}

/** Speed -> Rational (denominator 10000, reduced; negative for reverse). */
function speedRational(speed: number, reversed: boolean): Uint8Array {
  const den = 10000;
  const num = Math.max(1, Math.round(speed * den)) * (reversed ? -1 : 1);
  const g = gcd(num, den) || 1;
  return rational(num / g, den / g);
}

const rateRational = (rate: FrameRate): Uint8Array => rational(rate.num, rate.den);

interface MediaMobs {
  readonly masterId: Uint8Array;
  readonly sourceId: Uint8Array;
  /** Master mob slot ids by essence: picture 1, sound channel c -> 2 + c. */
  readonly channels: number;
  readonly hasPicture: boolean;
  readonly hasSound: boolean;
}

export function serializeAaf(seq: Sequence, options: AafWriteOptions = {}): AafWriteResult {
  const now = options.now ?? new Date();
  const random = options.randomBytes ?? defaultRandom;
  const notes: string[] = [];
  const newMobId = (): Uint8Array => concat(MOB_LABEL, Uint8Array.of(0x13, 0, 0, 0), random(16));

  const usedOperations = new Set<string>();
  const usedParameters = new Set<string>();

  const dataDef = (canonical: string): Prop => weakProp(PID.dataDefinition, WEAKREF_INDEX.dataDef, PID.defIdentification, canonical);
  const operation = (canonical: string): Prop => {
    usedOperations.add(canonical);
    return weakProp(PID.ogOperation, WEAKREF_INDEX.operationDef, PID.defIdentification, canonical);
  };
  const component = (cls: string, kind: string, length: number, extra: Prop[] = []): Obj =>
    obj(cls, [dataDef(kind), dataProp(PID.length, i64(length)), ...extra]);

  const sourceClip = (kind: string, length: number, startTime: number, mobId: Uint8Array, slotId: number): Obj =>
    component(CLASS.sourceClip, kind, length, [
      dataProp(PID.startTime, i64(startTime)),
      dataProp(PID.sourceId, mobId),
      dataProp(PID.sourceMobSlotId, u32(slotId)),
    ]);
  const sequenceOf = (kind: string, length: number, items: Obj[]): Obj =>
    component(CLASS.sequence, kind, length, [vecProp(PID.components, "Components-1001", items)]);

  const constantValue = (parameter: string, value: Uint8Array): Obj => {
    usedParameters.add(parameter);
    return obj(CLASS.constantValue, [
      dataProp(PID.paramDefinition, auid(parameter)),
      // Indirect value: byte order 'L', the Rational type id, then the value.
      dataProp(PID.paramValue, concat(Uint8Array.of(0x4c), auid(TYPEDEF_RATIONAL), value)),
    ]);
  };
  const operationGroup = (opId: string, kind: string, length: number, inputs: Obj[], params: Obj[]): Obj => {
    const props: Prop[] = [operation(opId)];
    if (inputs.length) props.push(vecProp(PID.ogInputSegments, "InputSegments-b02", inputs));
    if (params.length) {
      props.push({
        k: "set",
        pid: PID.ogParameters,
        name: "Parameters-b03",
        keyPid: PID.paramDefinition,
        keySize: 16,
        items: params.map((p) => ({ key: auid(paramIdOf(p)), obj: p })),
      });
    }
    return component(CLASS.operationGroup, kind, length, props);
  };
  const paramIdOf = (p: Obj): string => {
    const prop = p.props.find((x) => x.k === "data" && x.pid === PID.paramDefinition);
    return prop && prop.k === "data" ? bytesToAuid(prop.v) : "";
  };

  // ── media mobs ────────────────────────────────────────────────────────────
  const mobs: { readonly id: Uint8Array; readonly obj: Obj }[] = [];
  const mediaMobs = new Map<string, MediaMobs>();
  const created = timestamp(now);
  const mobBase = (name: string, id: Uint8Array, slots: Obj[], extra: Prop[] = []): Prop[] => [
    dataProp(PID.mobName, str(name)),
    dataProp(PID.mobId, id),
    dataProp(PID.mobCreationTime, created),
    dataProp(PID.mobLastModified, created),
    vecProp(PID.mobSlots, "Slots-4403", slots),
    ...extra,
  ];
  const timelineSlot = (slotId: number, name: string, editRate: Uint8Array, segment: Obj, physicalTrack?: number): Obj =>
    obj(CLASS.timelineMobSlot, [
      dataProp(PID.slotId, u32(slotId)),
      dataProp(PID.slotName, str(name)),
      dataProp(PID.timelineOrigin, i64(0)),
      dataProp(PID.timelineEditRate, editRate),
      refProp(PID.slotSegment, "Segment-4803", segment),
      ...(physicalTrack !== undefined ? [dataProp(PID.slotPhysicalTrack, u32(physicalTrack))] : []),
    ]);

  for (const media of seq.media) {
    const hasPicture = media.kind !== "audio" && media.hasVideo;
    const hasSound = media.hasAudio;
    if (!hasPicture && !hasSound) continue;
    const channels = hasSound ? Math.max(1, Math.min(2, media.channels)) : 0;
    const sourceId = newMobId();
    const masterId = newMobId();
    const mediaRate = media.rate;
    const frames = Math.max(1, secondsToFrames(media.durationSec, mediaRate));
    const samples = Math.max(1, Math.round(media.durationSec * media.sampleRate));

    const sourceSlots: Obj[] = [];
    const masterSlots: Obj[] = [];
    const pushSlot = (slotId: number, kind: string, name: string, editRate: Uint8Array, length: number, physical: number): void => {
      sourceSlots.push(timelineSlot(slotId, name, editRate, sourceClip(kind, length, 0, NULL_MOB_ID, 0)));
      masterSlots.push(
        timelineSlot(
          slotId,
          name,
          editRate,
          sequenceOf(kind, length, [sourceClip(kind, length, 0, sourceId, slotId)]),
          physical,
        ),
      );
    };
    if (hasPicture) pushSlot(1, DATADEF.picture, "V1", rateRational(mediaRate), frames, 1);
    for (let c = 0; c < channels; c++) {
      pushSlot(2 + c, DATADEF.sound, `A${c + 1}`, rational(Math.round(media.sampleRate), 1), samples, c + 1);
    }

    const descriptor = obj(CLASS.importDescriptor, [
      vecProp(PID.descriptorLocator, "Locator-2f01", [
        obj(CLASS.networkLocator, [dataProp(PID.locatorUrl, str(media.pathUrl ?? `file://localhost/${encodeURIComponent(media.name)}`))]),
      ]),
    ]);
    mobs.push({
      id: sourceId,
      obj: obj(CLASS.sourceMob, [
        ...mobBase(media.name, sourceId, sourceSlots),
        refProp(PID.sourceMobDescriptor, "EssenceDescription-4701", descriptor),
      ]),
    });
    mobs.push({ id: masterId, obj: obj(CLASS.masterMob, mobBase(media.name, masterId, masterSlots)) });
    mediaMobs.set(media.key, { masterId, sourceId, channels, hasPicture, hasSound });
  }

  // ── composition ───────────────────────────────────────────────────────────
  const rate = seq.rate;
  const fps = rate.num / rate.den;
  const mediaByKey = new Map(seq.media.map((m) => [m.key, m]));
  const compSlots: Obj[] = [];
  let nextSlotId = 1;

  const startTc = Math.max(0, Math.round(options.startTimecodeFrames ?? rate.timebase * 3600));
  compSlots.push(
    timelineSlot(
      nextSlotId++,
      "TC",
      rateRational(rate),
      component(CLASS.timecode, DATADEF.timecode, Math.max(1, seq.durationFrames), [
        dataProp(PID.tcStart, i64(startTc)),
        dataProp(PID.tcFps, u16(rate.timebase)),
        dataProp(PID.tcDrop, bool(rate.dropFrame)),
      ]),
    ),
  );

  /** One timeline item of a track, with the frames a neighbouring dissolve borrows from its source. */
  interface Placed {
    readonly clip: SeqClip;
    head: number;
    tail: number;
  }

  /** Builds the components of one track (clips, fillers, transitions) in sequence order. */
  const trackComponents = (
    track: SeqTrack,
    kind: typeof DATADEF.picture | typeof DATADEF.sound,
    channel: number,
  ): { items: Obj[]; length: number } => {
    const placed: Placed[] = [...track.clips]
      .filter((c) => !c.nested && mediaMobs.has(c.mediaKey))
      .sort((a, b) => a.startFrame - b.startFrame)
      .map((clip) => ({ clip, head: 0, tail: 0 }));

    // Dissolves borrow frames from both neighbours (AAF Transition semantics); clamp to the media that exists.
    const links: { a: Placed; b: Placed; cutPoint: number; length: number }[] = [];
    if (kind === DATADEF.picture) {
      for (const tr of track.transitions) {
        const d = tr.endFrame - tr.startFrame;
        const cut =
          tr.alignment === "start" ? tr.startFrame : tr.alignment === "end" ? tr.endFrame : tr.startFrame + Math.floor(d / 2);
        const a = placed.find((p) => Math.abs(p.clip.endFrame - cut) <= 1);
        const b = placed.find((p) => p !== a && Math.abs(p.clip.startFrame - cut) <= 1);
        if (!a || !b || d < 2) {
          notes.push(`A ${tr.kind} at frame ${tr.startFrame} is not between two adjacent clips and was written as a cut.`);
          continue;
        }
        let before = tr.alignment === "start" ? 0 : tr.alignment === "end" ? d : cut - tr.startFrame;
        let after = d - before;
        const speedA = a.clip.speed || 1;
        const speedB = b.clip.speed || 1;
        const media = mediaByKey.get(a.clip.mediaKey);
        const mediaB = mediaByKey.get(b.clip.mediaKey);
        const availBefore = Math.floor((b.clip.inSec * fps) / speedB) - b.head;
        const availAfter =
          mediaB && media && media.durationSec > 0
            ? Math.floor(((media.durationSec - a.clip.outSec) * fps) / speedA) - a.tail
            : after;
        const wantBefore = before;
        const wantAfter = after;
        before = Math.max(0, Math.min(before, availBefore));
        after = Math.max(0, Math.min(after, availAfter));
        if (before + after < 2) {
          notes.push(`A ${tr.kind} at frame ${tr.startFrame} had no spare source frames (handles) and was written as a cut.`);
          continue;
        }
        if (before !== wantBefore || after !== wantAfter) {
          notes.push(`A ${tr.kind} at frame ${tr.startFrame} was shortened to ${before + after} frames to fit the available source handles.`);
        }
        a.tail += after;
        b.head += before;
        links.push({ a, b, cutPoint: before, length: before + after });
      }
    }

    const items: Obj[] = [];
    let pos = 0;
    let total = 0;
    placed.forEach((p) => {
      const clip = p.clip;
      const mm = mediaMobs.get(clip.mediaKey);
      if (!mm) return;
      const start = clip.startFrame - p.head;
      const linkedBefore = links.find((l) => l.b === p);
      if (!linkedBefore && start > pos) {
        items.push(component(CLASS.filler, kind, start - pos));
        total += start - pos;
        pos = start;
      }
      const speed = clip.speed || 1;
      const timelineLength = clip.endFrame - clip.startFrame + p.head + p.tail;
      const srcStartSec = clip.inSec - (p.head * speed) / fps;
      const srcLengthSec = clip.outSec - clip.inSec + ((p.head + p.tail) * speed) / fps;
      const retimed = kind === DATADEF.picture && (Math.abs(speed - 1) > 1e-6 || clip.reversed);
      const slotId = kind === DATADEF.picture ? 1 : 2 + Math.min(channel, Math.max(0, mm.channels - 1));
      if (kind === DATADEF.sound && !mm.hasSound) return;
      if (kind === DATADEF.picture && !mm.hasPicture) return;
      if (kind === DATADEF.sound && Math.abs(speed - 1) > 1e-6) {
        notes.push(`Audio clip "${clip.name}" plays at ${speed}x; AAF audio speed is not written, so it keeps its source range at the timeline length.`);
      }
      const srcFrames = retimed
        ? Math.max(1, Math.round(srcLengthSec * fps))
        : timelineLength;
      const startFrames = Math.max(0, Math.round(srcStartSec * fps));
      const reversedStart = retimed && clip.reversed ? Math.max(0, startFrames + srcFrames - 1) : startFrames;
      let node: Obj = sourceClip(kind, srcFrames, reversedStart, mm.masterId, slotId);
      if (retimed) {
        node = operationGroup(
          OPERATION.videoSpeedControl,
          kind,
          timelineLength,
          [node],
          [constantValue(PARAMETER.speedRatio, speedRational(speed, clip.reversed))],
        );
      }
      if (kind === DATADEF.sound && Math.abs(clip.volume - 1) > 1e-6) {
        node = operationGroup(
          OPERATION.monoAudioGain,
          kind,
          timelineLength,
          [node],
          [constantValue(PARAMETER.amplitude, gainRational(clip.volume))],
        );
      }
      if (linkedBefore) {
        const d = linkedBefore.length;
        items.push(
          component(CLASS.transition, kind, d, [
            dataProp(PID.transitionCutPoint, i64(linkedBefore.cutPoint)),
            refProp(
              PID.transitionOperationGroup,
              "OperationGroup-1801",
              operationGroup(OPERATION.videoDissolve, kind, d, [], []),
            ),
          ]),
        );
        pos -= d;
        total -= d;
      }
      items.push(node);
      pos += timelineLength;
      total += timelineLength;
    });
    return { items, length: Math.max(0, total) };
  };

  const buildSlot = (track: SeqTrack, kind: typeof DATADEF.picture | typeof DATADEF.sound, name: string, physical: number, channel: number): Obj => {
    const { items, length } = trackComponents(track, kind, channel);
    let segment = sequenceOf(kind, length, items);
    if (kind === DATADEF.sound && track.gain !== undefined && Math.abs(track.gain - 1) > 1e-6) {
      segment = operationGroup(
        OPERATION.monoAudioGain,
        kind,
        length,
        [segment],
        [constantValue(PARAMETER.amplitude, gainRational(track.gain))],
      );
    }
    return timelineSlot(nextSlotId++, name, rateRational(rate), segment, physical);
  };

  const videoTracks = seq.tracks.filter((t) => t.kind === "video");
  const audioTracks: { track: SeqTrack; label: string }[] = [];
  // A video clip that plays its own sound gets a paired audio track, exactly as the other interchange writers do.
  videoTracks.forEach((vt) => {
    const carrying = vt.clips.filter((c) => c.withAudio && !c.nested);
    if (carrying.length) {
      audioTracks.push({ track: { ...vt, kind: "audio", clips: carrying, transitions: [], gain: undefined, targeted: false }, label: `${vt.name} audio` });
    }
  });
  for (const t of seq.tracks.filter((x) => x.kind === "audio")) audioTracks.push({ track: t, label: t.name });

  videoTracks.forEach((track, i) => compSlots.push(buildSlot(track, DATADEF.picture, track.name, i + 1, 0)));
  let physical = 0;
  for (const entry of audioTracks) {
    let channels = 1;
    for (const c of entry.track.clips) {
      const mm = mediaMobs.get(c.mediaKey);
      if (mm && mm.channels >= 2) channels = 2;
    }
    for (let ch = 0; ch < channels; ch++) {
      physical += 1;
      compSlots.push(buildSlot(entry.track, DATADEF.sound, channels > 1 ? `${entry.label} ${ch === 0 ? "L" : "R"}` : entry.label, physical, ch));
    }
  }

  if (seq.markers.length) {
    const events = seq.markers.map((m) =>
      obj(CLASS.descriptiveMarker, [
        dataDef(DATADEF.descriptive),
        dataProp(PID.length, i64(m.durationFrames ?? 0)),
        dataProp(PID.eventPosition, i64(m.frame)),
        dataProp(PID.eventComment, str(m.comment ? `${m.name}\n${m.comment}` : m.name)),
      ]),
    );
    const last = seq.markers.reduce((mx, m) => Math.max(mx, m.frame + (m.durationFrames ?? 0)), 0);
    compSlots.push(
      obj(CLASS.eventMobSlot, [
        dataProp(PID.slotId, u32(nextSlotId++)),
        dataProp(PID.slotName, str("Markers")),
        dataProp(PID.eventEditRate, rateRational(rate)),
        refProp(PID.slotSegment, "Segment-4803", sequenceOf(DATADEF.descriptive, last, events)),
      ]),
    );
  }

  const compId = newMobId();
  mobs.push({
    id: compId,
    obj: obj(CLASS.compositionMob, [
      ...mobBase(seq.name, compId, compSlots),
      dataProp(PID.mobUsageCode, auid(USAGE_TOPLEVEL)),
    ]),
  });

  // ── assemble the file ─────────────────────────────────────────────────────
  const root = loadAafTemplate();
  const header = findChild(root, "Header-2");
  if (!header) throw new Error("AAF template has no Header.");

  const patch = (node: CfbNode, pid: number, data: Uint8Array): void => {
    const props = findChild(node, "properties");
    if (!props) return;
    props.data = encodeProps(decodeProps(props.data).map((e) => (e.pid === pid ? { ...e, data } : e)));
  };
  patch(header, PID.headerLastModified, created);
  const ident = header.children.find((c) => c.name.startsWith("Identifi") && c.kind === "storage" && !c.name.endsWith("index"));
  if (ident) {
    patch(ident, PID.identDate, created);
    patch(ident, PID.identGenerationAUID, random(16));
  }

  // Weak-reference table.
  const refs = findChild(root, "referenced properties");
  if (refs) {
    const pidCount = WEAKREF_PATHS.reduce((n, p) => n + p.length + 1, 0);
    const head = new Uint8Array(7);
    const dv = new DataView(head.buffer);
    head[0] = 0x4c;
    dv.setUint16(1, WEAKREF_PATHS.length, true);
    dv.setUint32(3, pidCount, true);
    refs.data = concat(head, ...WEAKREF_PATHS.map((p) => concat(...p.map((x) => u16(x)), u16(0))));
  }

  // Dictionary: the operation and parameter definitions the edit uses.
  const dictionary = findChild(header, "Dictionary-3b04");
  if (!dictionary) throw new Error("AAF template has no Dictionary.");
  const defObject = (cls: string, id: string, name: string, extra: Prop[]): Obj =>
    obj(cls, [dataProp(PID.defName, str(name)), dataProp(PID.defDescription, str("")), dataProp(PID.defIdentification, auid(id)), ...extra]);
  const dictProps: Prop[] = [];
  const OP_DEFS: Record<string, { name: string; kind: string; inputs: number }> = {
    [OPERATION.videoDissolve]: { name: "VideoDissolve", kind: DATADEF.picture, inputs: 2 },
    [OPERATION.videoSpeedControl]: { name: "VideoSpeedControl", kind: DATADEF.picture, inputs: 1 },
    [OPERATION.monoAudioGain]: { name: "MonoAudioGain", kind: DATADEF.sound, inputs: 1 },
  };
  const ops = [...usedOperations].filter((id) => OP_DEFS[id]);
  if (ops.length) {
    dictProps.push({
      k: "set",
      pid: PID.dictOperationDefinitions,
      name: mangleName("OperationDefinitions", PID.dictOperationDefinitions, 22),
      keyPid: PID.defIdentification,
      keySize: 16,
      items: ops.map((id) => ({
        key: auid(id),
        obj: defObject(CLASS.operationDef, id, OP_DEFS[id].name, [
          weakProp(PID.opDataDefinition, WEAKREF_INDEX.dataDef, PID.defIdentification, OP_DEFS[id].kind),
          dataProp(PID.opIsTimeWarp, bool(id === OPERATION.videoSpeedControl)),
          dataProp(PID.opNumberInputs, i32(OP_DEFS[id].inputs)),
          dataProp(PID.opBypass, u32(OP_DEFS[id].inputs > 0 ? 1 : 0)),
          dataProp(PID.opCategory, auid(OPERATION_CATEGORY_EFFECT)),
        ]),
      })),
    });
  }
  const PARAM_DEFS: Record<string, string> = {
    [PARAMETER.speedRatio]: "SpeedRatio",
    [PARAMETER.amplitude]: "Amplitude",
  };
  const params = [...usedParameters].filter((id) => PARAM_DEFS[id]);
  if (params.length) {
    dictProps.push({
      k: "set",
      pid: PID.dictParameterDefinitions,
      name: mangleName("ParameterDefinitions", PID.dictParameterDefinitions, 22),
      keyPid: PID.defIdentification,
      keySize: 16,
      items: params.map((id) => ({
        key: auid(id),
        obj: defObject(CLASS.parameterDef, id, PARAM_DEFS[id], [
          weakProp(PID.paramDefType, WEAKREF_INDEX.typeDef, 0x0005, TYPEDEF_RATIONAL),
        ]),
      })),
    });
  }
  if (dictProps.length) applyProps(dictionary, dictProps);

  // Content: replace the (empty) ContentStorage with the mobs.
  const contentIndex = header.children.findIndex((c) => c.name === "Content-3b03");
  const content = storage("Content-3b03", auid(CLASS.contentStorage));
  applyProps(content, [
    {
      k: "set",
      pid: PID.contentMobs,
      name: "Mobs-1901",
      keyPid: PID.mobId,
      keySize: 32,
      items: mobs.map((m) => ({ key: m.id, obj: m.obj })),
    },
  ]);
  if (contentIndex >= 0) header.children[contentIndex] = content;
  else header.children.push(content);

  return { bytes: writeCfb(root, 4096), notes };
}

function bytesToAuid(b: Uint8Array): string {
  const h = (i: number): string => b[i].toString(16).padStart(2, "0");
  return `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}
