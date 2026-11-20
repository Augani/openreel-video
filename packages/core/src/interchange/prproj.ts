import type { MarkerKind } from "../types/timeline";
import { inflateRaw } from "./aaf/inflate";
import {
  sequenceToTimeline,
  type ImportReport,
  type SeqClip,
  type SeqMarker,
  type SeqMedia,
  type Sequence,
  type SeqTrack,
  type SeqTransition,
  type SeqTransitionKind,
  type SequenceToTimelineOptions,
  type TimelineImportResult,
} from "./model";
import type { ReportItem } from "./report";
import { fpsOf, resolveFrameRate, type FrameRate } from "./timecode";
import { parseXml, type XmlElement } from "./xml";

/**
 * Adobe Premiere Pro project (.prproj) import.
 *
 * A .prproj is a gzip-compressed XML document, `<PremiereData Version="3">`, holding a flat list of objects. An
 * object either has an `ObjectID` (numeric, referenced with `ObjectRef`) or an `ObjectUID` (GUID, referenced with
 * `ObjectURef`); everything else is a graph of those references:
 *
 *   RootProjectItem / BinProjectItem -> ProjectItemContainer > Items > Item (ObjectURef)
 *   ClipProjectItem -> MasterClip (ObjectURef) -> Clips > Clip (ObjectRef) -> VideoClip | AudioClip
 *     -> Clip > Source (ObjectRef) -> VideoMediaSource | AudioMediaSource -> MediaSource > Media (ObjectURef)
 *     -> Media: FilePath / ActualMediaFilePath / RelativePath, VideoStream, AudioStream
 *   Sequence -> TrackGroups > TrackGroup (First = 0 video / 1 audio, Second = ObjectRef)
 *     -> VideoTrackGroup | AudioTrackGroup -> TrackGroup > Tracks > Track (ObjectURef)
 *     -> VideoClipTrack | AudioClipTrack -> ClipTrack > ClipItems > TrackItems > TrackItem (ObjectRef) (+ TransitionItems)
 *     -> VideoClipTrackItem | AudioClipTrackItem -> ClipTrackItem > TrackItem > Start / End (ticks),
 *        SubClip (ObjectRef) -> Clip (ObjectRef, the VideoClip / AudioClip with InPoint / OutPoint) and
 *        ComponentOwner > Components (ObjectRef) -> VideoComponentChain -> VideoFilterComponent -> Params
 *
 * Premiere does not document the format. The element names above come from the structure of saved projects as
 * far as it is publicly described; reads are tolerant (a name is looked up anywhere inside its object, a few
 * alternative spellings are accepted). The tests use hand-authored fixtures that follow this layout; a file
 * Premiere itself wrote has not been available for verification. Anything the importer cannot place ends up in the
 * import report rather than disappearing.
 */

/** Premiere's time base: every time in a .prproj is an integer count of 1 / 254016000000 s. */
export const TICKS_PER_SECOND = 254_016_000_000n;
const TICKS_NUMBER = Number(TICKS_PER_SECOND);
/** Decompressed size cap: a project this large is a bomb or a corrupt file, not an edit. */
const MAX_XML_BYTES = 768 * 1024 * 1024;

// ── tick math ───────────────────────────────────────────────────────────────

/** Parse a tick count (plain integer text, possibly negative). Anything else is undefined. */
export function parseTicks(text: string | undefined): bigint | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  return /^-?\d+$/.test(trimmed) ? BigInt(trimmed) : undefined;
}

/** Ticks to seconds, exact for the whole-second part (beyond 2^53 ticks a plain Number division would lose frames). */
export function ticksToSeconds(ticks: bigint): number {
  const whole = ticks / TICKS_PER_SECOND;
  const rest = ticks % TICKS_PER_SECOND;
  return Number(whole) + Number(rest) / TICKS_NUMBER;
}

const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};

/** Ticks to whole frames of `rate`, rounded to the nearest frame (exact rational arithmetic). */
export function ticksToFrames(ticks: bigint, rate: FrameRate): number {
  const num = BigInt(rate.num);
  const den = BigInt(rate.den);
  const scaled = ticks * num;
  const unit = TICKS_PER_SECOND * den;
  return Number(floorDiv(scaled * 2n + unit, unit * 2n));
}

/** Frame rate from Premiere's "ticks per frame" (`FrameRate` of a stream or track group). */
export function frameRateFromTicksPerFrame(ticksPerFrame: bigint): FrameRate | undefined {
  if (ticksPerFrame <= 0n) return undefined;
  const fps = TICKS_NUMBER / Number(ticksPerFrame);
  return Number.isFinite(fps) && fps > 0 && fps < 1000 ? resolveFrameRate(fps) : undefined;
}

// ── gzip ────────────────────────────────────────────────────────────────────

export const looksLikeGzip = (bytes: Uint8Array): boolean => bytes.length > 18 && bytes[0] === 0x1f && bytes[1] === 0x8b;

/** True for a .prproj: a gzip stream, or the uncompressed `<PremiereData` XML some tools write. */
export function looksLikePrproj(bytes: Uint8Array): boolean {
  if (looksLikeGzip(bytes)) return true;
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, Math.min(bytes.length, 2048)));
  return /<PremiereData[\s>]/.test(head);
}

function gunzipSync(bytes: Uint8Array): Uint8Array {
  // Header: ID1 ID2 CM FLG MTIME(4) XFL OS, then optional extra / name / comment / header crc.
  const flags = bytes[3];
  let pos = 10;
  if (flags & 4) pos += 2 + (bytes[pos] | (bytes[pos + 1] << 8));
  if (flags & 8) while (pos < bytes.length && bytes[pos++] !== 0);
  if (flags & 16) while (pos < bytes.length && bytes[pos++] !== 0);
  if (flags & 2) pos += 2;
  // ISIZE (last 4 bytes) is the uncompressed length modulo 2^32: a good first guess for the output buffer.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(bytes.length - 4, true);
  return inflateRaw(bytes.subarray(pos, bytes.length - 8), size > 0 && size < MAX_XML_BYTES ? size : 0).subarray(0, size > 0 ? size : undefined);
}

/**
 * Gunzip with the platform's DecompressionStream (browsers, workers, Node 18+) and a dependency-free inflate
 * fallback. The output is capped at 768 MB.
 */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!looksLikeGzip(bytes)) return bytes;
  const Stream = (globalThis as { DecompressionStream?: new (format: string) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).DecompressionStream;
  if (!Stream) return gunzipSync(bytes);
  const stream = new Stream("gzip");
  const writer = stream.writable.getWriter();
  const writing = writer.write(bytes as unknown as Uint8Array).then(() => writer.close());
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_XML_BYTES) throw new Error("This project file decompresses to more than 768 MB and was not read.");
      chunks.push(value);
    }
    await writing;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    writing.catch(() => undefined);
    throw error instanceof Error && /768 MB/.test(error.message) ? error : new Error("The project file is not valid gzip data.");
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// ── object graph ────────────────────────────────────────────────────────────

export interface PrprojDocument {
  readonly root: XmlElement;
  readonly version: string;
  /** Top-level objects by `id:<ObjectID>` / `uid:<ObjectUID>`. */
  readonly objects: ReadonlyMap<string, XmlElement>;
}

export interface PrprojSequenceInfo {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly videoTracks: number;
  readonly audioTracks: number;
  readonly clipCount: number;
  /** Used as a nested sequence by another sequence. */
  readonly nested: boolean;
}

/** Parse the decompressed project XML into an object index. */
export function parsePrprojXml(xml: string): PrprojDocument {
  const root = parseXml(xml);
  if (root.name !== "PremiereData") throw new Error("This is not an Adobe Premiere Pro project (no PremiereData element).");
  const objects = new Map<string, XmlElement>();
  for (const el of root.children) {
    if (el.attrs.ObjectID !== undefined) objects.set(`id:${el.attrs.ObjectID}`, el);
    if (el.attrs.ObjectUID !== undefined) objects.set(`uid:${el.attrs.ObjectUID}`, el);
  }
  return { root, version: root.attrs.Version ?? "", objects };
}

/** Gunzip (when compressed) and parse a .prproj. */
export async function readPrproj(bytes: Uint8Array): Promise<PrprojDocument> {
  const raw = await gunzip(bytes);
  return parsePrprojXml(new TextDecoder("utf-8").decode(raw));
}

/** The object an `ObjectRef` / `ObjectURef` element points at. */
export function resolveRef(doc: PrprojDocument, el: XmlElement | undefined): XmlElement | undefined {
  if (!el) return undefined;
  if (el.attrs.ObjectRef !== undefined) return doc.objects.get(`id:${el.attrs.ObjectRef}`);
  if (el.attrs.ObjectURef !== undefined) return doc.objects.get(`uid:${el.attrs.ObjectURef}`);
  return undefined;
}

const hasRef = (el: XmlElement): boolean => el.attrs.ObjectRef !== undefined || el.attrs.ObjectURef !== undefined;

/** First descendant (depth first, document order) with this element name. */
function dig(el: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    if (c.name === name) return c;
    const deeper = dig(c, name);
    if (deeper) return deeper;
  }
  return undefined;
}

const digText = (el: XmlElement | undefined, ...names: string[]): string | undefined => {
  for (const name of names) {
    const found = dig(el, name);
    if (found && found.children.length === 0 && !hasRef(found)) return found.text;
  }
  return undefined;
};

const digTicks = (el: XmlElement | undefined, ...names: string[]): bigint | undefined => {
  for (const name of names) {
    const value = parseTicks(digText(el, name));
    if (value !== undefined) return value;
  }
  return undefined;
};

const digNumber = (el: XmlElement | undefined, ...names: string[]): number | undefined => {
  const text = digText(el, ...names);
  if (text === undefined || text === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
};

const digBool = (el: XmlElement | undefined, ...names: string[]): boolean | undefined => {
  const text = digText(el, ...names)?.toLowerCase();
  if (text === undefined || text === "") return undefined;
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return undefined;
};

/** The object the first descendant named `name` points at. */
function digRef(doc: PrprojDocument, el: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    if (c.name === name && hasRef(c)) return resolveRef(doc, c);
    const deeper = digRef(doc, c, name);
    if (deeper) return deeper;
  }
  return undefined;
}

/** Every referenced object below `el`, in `Index` order (list wrappers like Tracks, TrackItems, Items). */
function refsIn(doc: PrprojDocument, el: XmlElement | undefined): XmlElement[] {
  const found: { index: number; order: number; el: XmlElement }[] = [];
  const walk = (node: XmlElement) => {
    for (const c of node.children) {
      if (hasRef(c)) {
        const target = resolveRef(doc, c);
        if (target) found.push({ index: Number(c.attrs.Index ?? found.length), order: found.length, el: target });
      } else walk(c);
    }
  };
  if (el) walk(el);
  return found.sort((a, b) => a.index - b.index || a.order - b.order).map((f) => f.el);
}

const rectOf = (el: XmlElement | undefined): { width: number; height: number } | undefined => {
  const text = digText(el, "FrameRect");
  if (!text) return undefined;
  const parts = text.split(",").map(Number);
  if (parts.length < 4 || parts.some((p) => !Number.isFinite(p))) return undefined;
  const width = parts[2] - parts[0];
  const height = parts[3] - parts[1];
  return width > 0 && height > 0 ? { width, height } : undefined;
};

const objectsNamed = (doc: PrprojDocument, name: string): XmlElement[] => doc.root.children.filter((c) => c.name === name);

const nameOf = (el: XmlElement | undefined): string => digText(el, "Name") ?? "";

// ── project items (bins, master clips) ──────────────────────────────────────

interface MasterInfo {
  readonly name: string;
  readonly binPath: readonly string[];
}

/** Bin path (outermost first) of every media object reachable through a master clip. */
function collectBins(doc: PrprojDocument): { bins: string[][]; masters: MasterInfo[]; byMedia: Map<XmlElement, MasterInfo> } {
  const bins: string[][] = [];
  const masters: MasterInfo[] = [];
  const byMedia = new Map<XmlElement, MasterInfo>();
  const seen = new Set<XmlElement>();
  const visit = (item: XmlElement, path: string[]) => {
    if (seen.has(item)) return;
    seen.add(item);
    if (item.name === "RootProjectItem" || item.name === "BinProjectItem") {
      const nextPath = item.name === "RootProjectItem" ? path : [...path, nameOf(item) || "Bin"];
      if (item.name === "BinProjectItem") bins.push(nextPath);
      const container = dig(item, "ProjectItemContainer");
      for (const child of refsIn(doc, container)) visit(child, nextPath);
      return;
    }
    if (item.name === "ClipProjectItem") {
      const master = digRef(doc, item, "MasterClip");
      const info: MasterInfo = { name: nameOf(item) || nameOf(master), binPath: path };
      masters.push(info);
      for (const clip of refsIn(doc, dig(master, "Clips"))) {
        const media = mediaOfClip(doc, clip);
        if (media && !byMedia.has(media)) byMedia.set(media, info);
      }
    }
  };
  for (const root of objectsNamed(doc, "RootProjectItem")) visit(root, []);
  // Bins nobody lists under a root (damaged projects) are still read.
  for (const bin of objectsNamed(doc, "BinProjectItem")) visit(bin, []);
  for (const item of objectsNamed(doc, "ClipProjectItem")) visit(item, []);
  return { bins, masters, byMedia };
}

/** The Media object a VideoClip / AudioClip plays (Clip > Source > MediaSource > Media). */
function mediaOfClip(doc: PrprojDocument, clip: XmlElement | undefined): XmlElement | undefined {
  const source = digRef(doc, clip, "Source");
  return digRef(doc, source, "Media");
}

/** The sequence a VideoClip / AudioClip plays when its source is a nested sequence. */
function sequenceOfClip(doc: PrprojDocument, clip: XmlElement | undefined): XmlElement | undefined {
  const source = digRef(doc, clip, "Source");
  const nested = digRef(doc, source, "Sequence");
  return nested?.name === "Sequence" ? nested : undefined;
}

// ── sequences ───────────────────────────────────────────────────────────────

interface TrackGroups {
  readonly video: XmlElement[];
  readonly audio: XmlElement[];
}

function trackGroupsOf(doc: PrprojDocument, sequence: XmlElement): TrackGroups {
  const video: XmlElement[] = [];
  const audio: XmlElement[] = [];
  const groups = dig(sequence, "TrackGroups");
  for (const entry of groups?.children ?? []) {
    const group = resolveRef(doc, dig(entry, "Second") ?? entry);
    if (!group) continue;
    // `First` is the media type (0 video, 1 audio); the object name says the same.
    const first = digText(entry, "First");
    const isAudio = /^Audio/.test(group.name) || (!/^Video/.test(group.name) && first === "1");
    (isAudio ? audio : video).push(group);
  }
  return { video, audio };
}

const tracksOf = (doc: PrprojDocument, group: XmlElement): XmlElement[] => refsIn(doc, dig(group, "Tracks"));

const itemsOf = (doc: PrprojDocument, track: XmlElement, listName: string): XmlElement[] => refsIn(doc, dig(track, listName));

function countClips(doc: PrprojDocument, sequence: XmlElement): number {
  const groups = trackGroupsOf(doc, sequence);
  let total = 0;
  for (const group of [...groups.video, ...groups.audio]) {
    for (const track of tracksOf(doc, group)) total += itemsOf(doc, track, "ClipItems").length;
  }
  return total;
}

const sequenceId = (sequence: XmlElement): string => sequence.attrs.ObjectUID ?? `id:${sequence.attrs.ObjectID ?? ""}`;

function sequenceSize(sequence: XmlElement, groups: TrackGroups): { rate: FrameRate; width: number; height: number } {
  let rate: FrameRate | undefined;
  let size: { width: number; height: number } | undefined;
  for (const group of groups.video) {
    const tpf = digTicks(group, "FrameRate");
    rate = rate ?? (tpf !== undefined ? frameRateFromTicksPerFrame(tpf) : undefined);
    size = size ?? rectOf(group);
  }
  rate = rate ?? frameRateFromTicksPerFrame(digTicks(sequence, "FrameRate") ?? 0n);
  size = size ?? rectOf(sequence);
  // Audio-only sequences carry no frame rate: 24 is Premiere's default editing timebase.
  return { rate: rate ?? resolveFrameRate(24), width: size?.width ?? 1920, height: size?.height ?? 1080 };
}

/** Every sequence of the project, with what is needed to let the user pick one. */
export function listPrprojSequences(doc: PrprojDocument): PrprojSequenceInfo[] {
  const sequences = objectsNamed(doc, "Sequence");
  const nestedIds = new Set<string>();
  for (const clip of [...objectsNamed(doc, "VideoClip"), ...objectsNamed(doc, "AudioClip")]) {
    const nested = sequenceOfClip(doc, clip);
    if (nested) nestedIds.add(sequenceId(nested));
  }
  return sequences.map((sequence) => {
    const groups = trackGroupsOf(doc, sequence);
    const { rate, width, height } = sequenceSize(sequence, groups);
    return {
      id: sequenceId(sequence),
      name: nameOf(sequence) || "Sequence",
      width,
      height,
      fps: fpsOf(rate),
      videoTracks: groups.video.reduce((n, g) => n + tracksOf(doc, g).length, 0),
      audioTracks: groups.audio.reduce((n, g) => n + tracksOf(doc, g).length, 0),
      clipCount: countClips(doc, sequence),
      nested: nestedIds.has(sequenceId(sequence)),
    };
  });
}

/** The sequence to open by default: the biggest one that no other sequence nests. */
export function defaultPrprojSequence(sequences: readonly PrprojSequenceInfo[]): PrprojSequenceInfo | undefined {
  const pool = sequences.some((s) => !s.nested) ? sequences.filter((s) => !s.nested) : sequences;
  return pool.reduce<PrprojSequenceInfo | undefined>((best, s) => (!best || s.clipCount > best.clipCount ? s : best), undefined);
}

// ── clip components (Motion, Opacity, Volume) ───────────────────────────────

interface ParamValue {
  readonly values: number[];
  readonly animated: boolean;
}

function parseParam(param: XmlElement): ParamValue {
  const numbers = (text: string): number[] => text.split(/[:,;\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  let values: number[] = [];
  const current = digText(param, "CurrentValue");
  if (current) values = numbers(current);
  const start = digText(param, "StartKeyframe");
  if (values.length === 0 && start) {
    // "time,value[,...];" keyframe records; the first record's value is the start value.
    const fields = start.split(";")[0].split(",");
    values = numbers(fields.slice(1, 2).join(","));
    if (fields[1]?.includes(":")) values = numbers(fields[1]);
  }
  const keyframes = dig(param, "Keyframes");
  const animated = digBool(param, "IsTimeVarying") === true || (keyframes !== undefined && keyframes.children.length > 1);
  return { values, animated };
}

interface ComponentInfo {
  readonly match: string;
  readonly display: string;
  readonly params: Map<string, ParamValue>;
}

function componentsOf(doc: PrprojDocument, item: XmlElement): ComponentInfo[] {
  const chain = digRef(doc, dig(item, "ComponentOwner"), "Components");
  const out: ComponentInfo[] = [];
  for (const component of refsIn(doc, chain)) {
    const params = new Map<string, ParamValue>();
    for (const paramEl of refsIn(doc, dig(component, "Params"))) {
      const name = nameOf(paramEl);
      if (name) params.set(name.toLowerCase(), parseParam(paramEl));
    }
    out.push({ match: digText(component, "MatchName") ?? "", display: digText(component, "DisplayName") ?? digText(component, "InstanceName") ?? "", params });
  }
  return out;
}

const is = (c: ComponentInfo, ...needles: string[]): boolean => needles.some((n) => c.match.toLowerCase().includes(n) || c.display.toLowerCase() === n);

interface ClipLook {
  opacity: number;
  volume: number;
  motion?: SeqClip["motion"];
}

/** Position values at or below this are Premiere's normalised frame coordinates (0.5 = centre), above it pixels. */
const NORMALISED_POSITION_LIMIT = 4;

function readLook(
  components: readonly ComponentInfo[],
  seq: { width: number; height: number },
  clipLabel: string,
  trackName: string,
  items: ReportItem[],
): ClipLook {
  const where = { clipName: clipLabel, trackName };
  const look: ClipLook = { opacity: 1, volume: 1 };
  let x = 0;
  let y = 0;
  let scale = 1;
  let rotation = 0;
  let hasMotion = false;
  for (const c of components) {
    if (is(c, "adbe motion")) {
      const position = c.params.get("position");
      if (position && position.values.length >= 2) {
        const [px, py] = position.values;
        const pixels = Math.abs(px) > NORMALISED_POSITION_LIMIT || Math.abs(py) > NORMALISED_POSITION_LIMIT;
        x = pixels ? px - seq.width / 2 : (px - 0.5) * seq.width;
        y = pixels ? py - seq.height / 2 : (py - 0.5) * seq.height;
        if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) hasMotion = true;
        if (position.animated) items.push({ severity: "approximated", feature: "Animated position", detail: "Position keyframes are not imported; the start value is used.", ...where });
      }
      const scaleParam = c.params.get("scale");
      if (scaleParam && scaleParam.values.length >= 1) {
        scale = scaleParam.values[0] / 100;
        if (Math.abs(scale - 1) > 1e-6) hasMotion = true;
        if (scaleParam.animated) items.push({ severity: "approximated", feature: "Animated scale", detail: "Scale keyframes are not imported; the start value is used.", ...where });
      }
      const uniform = c.params.get("uniform scale");
      const width = c.params.get("scale width");
      if (uniform && uniform.values[0] === 0 && width && width.values[0] !== undefined && scaleParam && Math.abs(width.values[0] - scaleParam.values[0]) > 1e-6) {
        items.push({ severity: "approximated", feature: "Non-uniform scale", detail: "Scale Width and Scale Height differ; the single Scale value is used.", ...where });
      }
      const rot = c.params.get("rotation");
      if (rot && rot.values.length >= 1) {
        rotation = rot.values[0];
        if (Math.abs(rotation) > 1e-6) hasMotion = true;
        if (rot.animated) items.push({ severity: "approximated", feature: "Animated rotation", detail: "Rotation keyframes are not imported; the start value is used.", ...where });
      }
      const anchor = c.params.get("anchor point");
      if (anchor && anchor.values.length >= 2 && (Math.abs(anchor.values[0] - 0.5) > 1e-4 || Math.abs(anchor.values[1] - 0.5) > 1e-4) && Math.abs(anchor.values[0]) <= NORMALISED_POSITION_LIMIT) {
        items.push({ severity: "dropped", feature: "Anchor point", detail: "A moved anchor point is not imported (OpenReel rotates and scales around the centre).", ...where });
      }
      continue;
    }
    if (is(c, "adbe opacity")) {
      const opacity = c.params.get("opacity");
      if (opacity && opacity.values.length >= 1) {
        look.opacity = Math.max(0, Math.min(1, opacity.values[0] / 100));
        if (opacity.animated) items.push({ severity: "approximated", feature: "Animated opacity", detail: "Opacity keyframes are not imported; the start value is used.", ...where });
      }
      const blend = c.params.get("blend mode");
      if (blend && blend.values[0] !== undefined && blend.values[0] !== 0) {
        items.push({ severity: "dropped", feature: "Blend mode", detail: "The blend mode is not imported; the clip uses Normal.", ...where });
      }
      continue;
    }
    if (is(c, "adbe volume", "volume") && !is(c, "channel volume")) {
      const level = c.params.get("level");
      if (level && level.values.length >= 1) {
        // Level is the linear amplitude (1 = 0 dB).
        look.volume = Math.max(0, level.values[0]);
        if (level.animated) items.push({ severity: "approximated", feature: "Animated volume", detail: "Volume keyframes are not imported; the start value is used.", ...where });
      }
      continue;
    }
    if (is(c, "time remapping")) {
      items.push({ severity: "dropped", feature: "Time remapping", detail: "Speed ramps and time remapping keyframes are not imported; the constant clip speed is used.", ...where });
      continue;
    }
    const label = c.display || c.match || "Unnamed effect";
    items.push({ severity: "dropped", feature: `Effect: ${label}`, detail: "Effects other than Motion, Opacity and Volume are not imported.", ...where });
  }
  if (hasMotion) {
    look.motion = { x, y, scale, rotation };
    if (Math.abs(scale - 1) > 1e-6 || Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
      items.push({
        severity: "approximated",
        feature: "Motion",
        detail: "Premiere sizes media from its native pixels; OpenReel fits the frame first and then applies the scale, so the framing can differ.",
        ...where,
      });
    }
  }
  return look;
}

// ── building the neutral sequence ───────────────────────────────────────────

export interface PrprojOptions {
  /** The sequence to import (ObjectUID from `listPrprojSequences`); default: the biggest top-level one. */
  sequenceId?: string;
}

const MARKER_TYPES: Record<string, MarkerKind> = { chapter: "chapter", segmentation: "segmentation", weblink: "web", flashcuepoint: "chapter" };

const kindOfAudio = /\.(wav|mp3|aac|m4a|aif|aiff|flac|ogg|opus|wma)$/i;
const kindOfImage = /\.(jpe?g|png|gif|bmp|tiff?|webp|heic|psd|ai|svg|dng)$/i;

function pathToUrl(path: string): string {
  const unix = path.replace(/\\/g, "/");
  const windows = /^[a-zA-Z]:\//.test(unix) ? `/${unix}` : unix;
  const encoded = windows.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `file://localhost${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

const basename = (path: string): string => path.replace(/\\/g, "/").split("/").pop() ?? path;

interface BuildContext {
  readonly doc: PrprojDocument;
  readonly items: ReportItem[];
  readonly warnings: string[];
  readonly masters: Map<XmlElement, MasterInfo>;
  readonly mediaByObject: Map<XmlElement, SeqMedia>;
  readonly nests: Map<XmlElement, Sequence | null>;
  readonly building: Set<XmlElement>;
  linkedAudioMerged: number;
}

function mediaFor(ctx: BuildContext, mediaEl: XmlElement, clipEl: XmlElement, label: string, trackKind: "video" | "audio", seqRate: FrameRate, seq: { width: number; height: number }): SeqMedia | undefined {
  const known = ctx.mediaByObject.get(mediaEl);
  if (known) return known;
  const path = digText(mediaEl, "ActualMediaFilePath") || digText(mediaEl, "FilePath") || digText(mediaEl, "RelativePath") || "";
  const videoStream = digRef(ctx.doc, mediaEl, "VideoStream");
  const audioStream = digRef(ctx.doc, mediaEl, "AudioStream");
  const name = path ? basename(path) : digText(mediaEl, "Title") || label;
  const ext = name.toLowerCase();
  let kind: SeqMedia["kind"];
  if (kindOfImage.test(ext)) kind = "image";
  else if (videoStream) kind = "video";
  else if (audioStream || kindOfAudio.test(ext)) kind = "audio";
  else kind = trackKind === "audio" ? "audio" : "video";
  const streamTpf = digTicks(videoStream, "FrameRate");
  const rate = (streamTpf !== undefined ? frameRateFromTicksPerFrame(streamTpf) : undefined) ?? seqRate;
  const rect = rectOf(videoStream) ?? rectOf(clipEl);
  const source = digRef(ctx.doc, clipEl, "Source");
  const duration = digTicks(source, "OriginalDuration") ?? digTicks(mediaEl, "Duration", "OriginalDuration");
  const info = ctx.masters.get(mediaEl);
  const sampleRate = digNumber(audioStream, "SampleRate", "AudioSampleRate") ?? 48000;
  const channels = digNumber(audioStream, "NumChannels", "ChannelCount") ?? 2;
  if (!path) {
    ctx.items.push({ severity: "approximated", feature: "Media without a file path", detail: `"${name}" has no file path in the project; it is added as an offline placeholder.`, clipName: name });
  }
  const media: SeqMedia = {
    key: mediaEl.attrs.ObjectUID ?? `id:${mediaEl.attrs.ObjectID ?? name}`,
    name,
    ...(path ? { pathUrl: pathToUrl(path) } : {}),
    kind,
    durationSec: duration !== undefined && duration > 0n && duration < 1n << 60n ? ticksToSeconds(duration) : 0,
    rate,
    width: rect?.width ?? seq.width,
    height: rect?.height ?? seq.height,
    hasVideo: kind !== "audio" && (videoStream !== undefined || kind === "image" || trackKind === "video"),
    hasAudio: kind === "audio" || audioStream !== undefined,
    sampleRate,
    channels,
    ...(info?.binPath.length ? { binPath: info.binPath } : {}),
  };
  ctx.mediaByObject.set(mediaEl, media);
  return media;
}

function transitionKind(name: string): { kind: SeqTransitionKind; exact: boolean } | undefined {
  const n = name.toLowerCase();
  if (/cross dissolve|adbe cross dissolve/.test(n)) return { kind: "dissolve", exact: true };
  if (/dip to black/.test(n)) return { kind: "dipToBlack", exact: true };
  if (/dip to white/.test(n)) return { kind: "dipToWhite", exact: true };
  if (/additive dissolve|film dissolve|non-additive|dissolve/.test(n)) return { kind: "dissolve", exact: false };
  return undefined;
}

function buildSequence(ctx: BuildContext, sequenceEl: XmlElement, isNest: boolean): Sequence {
  const { doc } = ctx;
  const groups = trackGroupsOf(doc, sequenceEl);
  const { rate, width, height } = sequenceSize(sequenceEl, groups);
  const seqName = nameOf(sequenceEl) || "Imported Sequence";
  const prefix = isNest ? `${seqName} / ` : "";
  const sizeInfo = { width, height };
  const used = new Map<string, SeqMedia>();

  interface Built {
    clip: SeqClip;
    kind: "video" | "audio";
  }

  const buildTrack = (trackEl: XmlElement, kind: "video" | "audio", index: number): { track: SeqTrack; built: Built[] } => {
    const trackName = nameOf(trackEl) && !/^(video|audio) \d+$/i.test(nameOf(trackEl)) ? nameOf(trackEl) : kind === "video" ? `V${index + 1}` : `A${index + 1}`;
    const where = `${prefix}${trackName}`;
    const built: Built[] = [];
    const itemEls = itemsOf(doc, trackEl, "ClipItems");
    for (const item of itemEls) {
      const isVideoItem = /^Video/.test(item.name);
      const isAudioItem = /^Audio/.test(item.name);
      const label = nameOf(dig(item, "SubClip") ? digRef(doc, item, "SubClip") : item) || nameOf(item) || "Clip";
      if ((kind === "video" && !isVideoItem) || (kind === "audio" && !isAudioItem) || !/ClipTrackItem$/.test(item.name)) {
        ctx.items.push({ severity: "dropped", feature: "Unsupported clip type", detail: `${item.name} items (titles, captions, graphics) are not imported.`, clipName: label, trackName: where });
        continue;
      }
      const start = digTicks(item, "Start");
      const end = digTicks(item, "End");
      if (start === undefined || end === undefined || end <= start) {
        ctx.warnings.push(`Clip "${label}" on ${where} has no valid start and end and was skipped.`);
        ctx.items.push({ severity: "dropped", feature: "Invalid clip", detail: "The clip has no valid start and end time.", clipName: label, trackName: where });
        continue;
      }
      const subClip = digRef(doc, item, "SubClip");
      const clipObj = digRef(doc, subClip, "Clip") ?? digRef(doc, item, "Clip");
      const startFrame = ticksToFrames(start, rate);
      const endFrame = Math.max(startFrame + 1, ticksToFrames(end, rate));
      const durationTicks = end - start;
      const inTicksRaw = digTicks(clipObj, "InPoint");
      const outTicksRaw = digTicks(clipObj, "OutPoint");
      // Premiere writes sentinel out points (INT64_MAX) for "whole clip"; treat anything absurd as missing.
      const sane = (t: bigint | undefined): bigint | undefined => (t !== undefined && t >= 0n && t < 1n << 60n ? t : undefined);
      const inTicks = sane(inTicksRaw) ?? 0n;
      let outTicks = sane(outTicksRaw);
      const explicitSpeed = digNumber(item, "Speed", "PlaybackSpeed") ?? digNumber(subClip, "Speed", "PlaybackSpeed") ?? digNumber(clipObj, "Speed", "PlaybackSpeed");
      const reversedFlag = digBool(item, "Reversed", "Reverse", "PlayBackwards") ?? digBool(subClip, "Reversed", "Reverse", "PlayBackwards") ?? digBool(clipObj, "Reversed", "Reverse", "PlayBackwards") ?? false;
      let speed = 1;
      if (explicitSpeed !== undefined && Math.abs(explicitSpeed) > 1e-6) {
        speed = Math.abs(explicitSpeed);
        if (outTicks === undefined) outTicks = inTicks + BigInt(Math.round(Number(durationTicks) * speed));
      } else if (outTicks !== undefined && outTicks > inTicks) {
        const ratio = Number(outTicks - inTicks) / Number(durationTicks);
        speed = Math.abs(ratio - 1) > 0.001 ? ratio : 1;
      }
      if (outTicks === undefined) outTicks = inTicks + durationTicks;
      const reversed = reversedFlag || (explicitSpeed !== undefined && explicitSpeed < 0);
      if (speed < 0.01 || speed > 100) {
        ctx.items.push({ severity: "approximated", feature: "Extreme speed", detail: `Speed ${speed.toFixed(3)}x is outside OpenReel's range; imported at 1x.`, clipName: label, trackName: where });
        speed = 1;
      }

      const disabled = digBool(item, "Disabled", "IsDisabled") === true || digBool(item, "Enabled", "IsEnabled") === false;
      if (disabled) {
        ctx.items.push({ severity: "approximated", feature: "Disabled clip", detail: "OpenReel has no clip enable switch; the clip is imported fully transparent and muted so it plays as disabled.", clipName: label, trackName: where });
      }
      const look = readLook(componentsOf(doc, item), sizeInfo, label, where, ctx.items);
      const base: Omit<SeqClip, "mediaKey"> = {
        id: `prproj-${item.attrs.ObjectID ?? built.length}-${index}`,
        name: label,
        startFrame,
        endFrame,
        inSec: ticksToSeconds(inTicks),
        outSec: ticksToSeconds(outTicks),
        speed,
        reversed,
        opacity: look.opacity,
        volume: look.volume,
        withAudio: false,
        ...(look.motion ? { motion: look.motion } : {}),
        ...(disabled ? { disabled: true } : {}),
        metadata: { prproj: { sequence: seqName, track: where, objectId: item.attrs.ObjectID ?? null } },
      };

      const nestedEl = sequenceOfClip(doc, clipObj);
      if (nestedEl) {
        let nested = ctx.nests.get(nestedEl);
        if (nested === undefined) {
          if (ctx.building.has(nestedEl)) {
            ctx.warnings.push(`Nested sequence "${nameOf(nestedEl)}" contains itself; the clip "${label}" was skipped.`);
            ctx.items.push({ severity: "dropped", feature: "Nested sequence", detail: "The nested sequence contains itself.", clipName: label, trackName: where });
            continue;
          }
          ctx.building.add(nestedEl);
          nested = { ...buildSequence(ctx, nestedEl, true), id: `prproj:${sequenceId(nestedEl)}` };
          ctx.building.delete(nestedEl);
          ctx.nests.set(nestedEl, nested);
        }
        if (!nested) continue;
        built.push({ kind, clip: { ...base, mediaKey: "", nested } });
        continue;
      }
      const mediaEl = mediaOfClip(doc, clipObj);
      if (!mediaEl) {
        ctx.items.push({ severity: "dropped", feature: "Clip without media", detail: "The clip has no media file (title, colour matte, adjustment layer or generated item) and was skipped.", clipName: label, trackName: where });
        continue;
      }
      const media = mediaFor(ctx, mediaEl, clipObj as XmlElement, label, kind, rate, sizeInfo);
      if (!media) continue;
      used.set(media.key, media);
      // Clip and master-clip markers are not read: they are listed once per project below.
      built.push({ kind, clip: { ...base, mediaKey: media.key } });
    }

    // Transitions.
    const transitions: SeqTransition[] = [];
    const clips = built.map((b) => b.clip).sort((a, b) => a.startFrame - b.startFrame);
    for (const tEl of itemsOf(doc, trackEl, "TransitionItems").concat(itemsOf(doc, trackEl, "Transitions"))) {
      const name = digText(tEl, "TransitionName", "DisplayName", "MatchName") ?? digText(digRef(doc, dig(tEl, "ComponentOwner"), "Components") ?? undefined, "DisplayName", "MatchName") ?? nameOf(tEl) ?? "";
      const label = name || "Transition";
      if (kind === "audio") {
        ctx.items.push({ severity: "dropped", feature: "Audio crossfade", detail: "Audio transitions are not imported.", clipName: label, trackName: where });
        continue;
      }
      const match = transitionKind(name);
      if (!match) {
        ctx.items.push({ severity: "dropped", feature: `Transition: ${label}`, detail: "Only cross dissolve and dip to black / white transitions are imported.", clipName: label, trackName: where });
        continue;
      }
      const ts = digTicks(tEl, "Start");
      const te = digTicks(tEl, "End");
      if (ts === undefined || te === undefined || te <= ts) continue;
      const startFrame = ticksToFrames(ts, rate);
      const endFrame = Math.max(startFrame + 1, ticksToFrames(te, rate));
      const before = clips.find((c) => Math.abs(c.endFrame - startFrame) <= 1) ?? clips.find((c) => Math.abs(c.endFrame - (startFrame + endFrame) / 2) <= 1) ?? clips.find((c) => Math.abs(c.endFrame - endFrame) <= 1);
      if (!before || !clips.some((c) => c !== before && Math.abs(c.startFrame - before.endFrame) <= 1)) {
        ctx.items.push({ severity: "dropped", feature: "Transition at a clip edge", detail: "The transition is not between two adjacent clips (a fade at the start or end of a clip) and was skipped.", clipName: label, trackName: where });
        continue;
      }
      const alignment: SeqTransition["alignment"] =
        Math.abs(before.endFrame - startFrame) <= 1 ? "start" : Math.abs(before.endFrame - endFrame) <= 1 ? "end" : "center";
      transitions.push({ kind: match.kind, startFrame, endFrame, alignment });
      if (!match.exact) {
        ctx.items.push({ severity: "approximated", feature: `Transition: ${label}`, detail: "Imported as a cross dissolve.", clipName: label, trackName: where });
      }
    }

    const locked = digBool(trackEl, "IsLocked", "Locked") === true;
    const muted = digBool(trackEl, "IsMuted", "Muted", "Mute") === true || digBool(trackEl, "IsHidden", "Hidden") === true || digBool(trackEl, "IsVisible", "Visible") === false;
    const targeted = digBool(trackEl, "IsTargeted", "Targeted");
    const syncLock = digBool(trackEl, "IsSyncLocked", "SyncLocked");
    return {
      built,
      track: {
        kind,
        name: trackName,
        clips,
        transitions: transitions.sort((a, b) => a.startFrame - b.startFrame),
        disabled: muted,
        locked,
        ...(syncLock !== undefined ? { syncLock } : {}),
        ...(targeted ? { targeted: true } : {}),
      },
    };
  };

  const videoTracks = groups.video.flatMap((g) => tracksOf(doc, g)).map((t, i) => buildTrack(t, "video", i));
  const audioTracks = groups.audio.flatMap((g) => tracksOf(doc, g)).map((t, i) => buildTrack(t, "audio", i));

  // A video item and an audio item of the same file, range and speed are Premiere's linked pair: fold the audio into the video clip like the XMEML importer.
  const videoByKey = new Map<string, SeqClip>();
  for (const t of videoTracks) for (const b of t.built) if (!b.clip.nested) videoByKey.set(`${b.clip.mediaKey}|${b.clip.startFrame}|${b.clip.endFrame}|${b.clip.speed}|${b.clip.reversed}`, b.clip);
  const absorbed = new Set<SeqClip>();
  const folded = new Map<SeqClip, SeqClip>();
  for (const t of audioTracks) {
    for (const b of t.built) {
      const c = b.clip;
      if (c.nested || !used.get(c.mediaKey)?.hasVideo || !used.get(c.mediaKey)?.hasAudio) continue;
      const v = videoByKey.get(`${c.mediaKey}|${c.startFrame}|${c.endFrame}|${c.speed}|${c.reversed}`);
      if (v && !folded.has(v) && !!v.disabled === !!c.disabled) {
        folded.set(v, c);
        absorbed.add(c);
        ctx.linkedAudioMerged++;
      }
    }
  }
  const finishVideo = (clip: SeqClip): SeqClip => {
    const audio = folded.get(clip);
    return audio ? { ...clip, withAudio: true, volume: audio.volume } : clip;
  };

  const tracks: SeqTrack[] = [];
  videoTracks.forEach((t) => tracks.push({ ...t.track, clips: t.track.clips.map(finishVideo) }));
  let audioIndex = 0;
  for (const t of audioTracks) {
    const remaining = t.track.clips.filter((c) => !absorbed.has(c));
    if (remaining.length === 0 && t.track.clips.length > 0) continue;
    audioIndex += 1;
    tracks.push({ ...t.track, clips: remaining, name: t.track.name.startsWith("A") && /^A\d+$/.test(t.track.name) ? `A${audioIndex}` : t.track.name });
  }

  // Sequence markers.
  const markers: SeqMarker[] = [];
  const markerOwner = digRef(doc, sequenceEl, "Markers");
  const markerEls = [...refsIn(doc, markerOwner), ...(markerOwner ? markerOwner.children.filter((c) => c.name === "Marker" && !hasRef(c)) : [])];
  for (const m of markerEls.length ? markerEls : sequenceEl.children.filter((c) => c.name === "Marker")) {
    const at = digTicks(m, "Start");
    if (at === undefined) continue;
    const dur = digTicks(m, "Duration");
    const frame = Math.max(0, ticksToFrames(at, rate));
    const durationFrames = dur !== undefined && dur > 0n && dur < 1n << 60n ? ticksToFrames(at + dur, rate) - frame : 0;
    const comment = digText(m, "Comment");
    const kind = MARKER_TYPES[(digText(m, "Type") ?? "").toLowerCase()];
    markers.push({
      frame,
      name: digText(m, "Name") ?? "",
      ...(durationFrames > 0 ? { durationFrames } : {}),
      ...(comment ? { comment } : {}),
      ...(kind ? { kind } : {}),
    });
  }
  markers.sort((a, b) => a.frame - b.frame);

  const maxEnd = tracks.reduce((m, t) => t.clips.reduce((x, c) => Math.max(x, c.endFrame), m), 0);
  return {
    name: seqName,
    rate,
    width,
    height,
    durationFrames: maxEnd,
    tracks,
    markers,
    media: [...used.values()],
  };
}

const unusedClipMarkers = (doc: PrprojDocument): number => {
  let count = 0;
  for (const master of objectsNamed(doc, "MasterClip")) {
    const owner = digRef(doc, master, "Markers");
    if (owner) count += refsIn(doc, owner).length;
  }
  return count;
};

export interface PrprojParse {
  readonly sequence: Sequence;
  readonly report: ImportReport;
  readonly warnings: string[];
  readonly sequences: PrprojSequenceInfo[];
  readonly selectedId: string;
}

/** Turn one sequence of a parsed project into the neutral sequence plus the import report. */
export function prprojToSequence(doc: PrprojDocument, options: PrprojOptions = {}): PrprojParse {
  const sequences = listPrprojSequences(doc);
  if (sequences.length === 0) throw new Error("This Premiere project contains no sequences to import.");
  const chosen = sequences.find((s) => s.id === options.sequenceId) ?? defaultPrprojSequence(sequences)!;
  const sequenceEl = objectsNamed(doc, "Sequence").find((s) => sequenceId(s) === chosen.id)!;
  const bins = collectBins(doc);
  const ctx: BuildContext = {
    doc,
    items: [],
    warnings: [],
    masters: bins.byMedia,
    mediaByObject: new Map(),
    nests: new Map(),
    building: new Set([sequenceEl]),
    linkedAudioMerged: 0,
  };
  const sequence = buildSequence(ctx, sequenceEl, false);
  const notes: string[] = [];
  if (bins.masters.length) notes.push(`Read ${bins.masters.length} master clips in ${bins.bins.length} bins; the bins are recreated for media that is not already in the project.`);
  if (ctx.linkedAudioMerged > 0) notes.push(`${ctx.linkedAudioMerged} audio clips linked to a video clip of the same file and range were merged into that video clip (its audio level is kept).`);
  const others = sequences.filter((s) => s.id !== chosen.id && !ctx.nests.has(objectsNamed(doc, "Sequence").find((el) => sequenceId(el) === s.id)!));
  if (others.length) notes.push(`${others.length} other ${others.length === 1 ? "sequence was" : "sequences were"} not imported (${others.map((s) => s.name).join(", ")}). Import the file again and choose another sequence to bring it in.`);
  const markerCount = unusedClipMarkers(doc);
  if (markerCount > 0) notes.push(`${markerCount} master-clip markers were not imported (sequence markers are).`);
  notes.push("Not read: Lumetri colour and other effects, Essential Graphics and legacy titles, captions, adjustment layers, audio track mixer settings, Dynamic Link and Productions.");
  const items = ctx.items;
  return {
    sequence,
    warnings: ctx.warnings,
    sequences,
    selectedId: chosen.id,
    report: {
      items,
      notes,
      dropped: items.filter((i) => i.severity === "dropped").length,
      approximated: items.filter((i) => i.severity === "approximated").length,
    },
  };
}

export interface PrprojImportResult extends TimelineImportResult {
  readonly format: "prproj";
  /** Every sequence of the file (for a picker) and the one this import holds. */
  readonly prproj: { readonly sequences: PrprojSequenceInfo[]; readonly selectedId: string };
}

/** Parse a .prproj (gzip or plain XML bytes) and relink its media against the bin. */
export async function importPrproj(bytes: Uint8Array, options: SequenceToTimelineOptions & PrprojOptions): Promise<PrprojImportResult> {
  return importPrprojDocument(await readPrproj(bytes), options);
}

/** Same as `importPrproj` for an already parsed document (switching sequences without re-reading the file). */
export function importPrprojDocument(doc: PrprojDocument, options: SequenceToTimelineOptions & PrprojOptions): PrprojImportResult {
  const parsed = prprojToSequence(doc, options);
  const result = sequenceToTimeline(parsed.sequence, options, parsed.warnings);
  return {
    ...result,
    importReport: parsed.report,
    format: "prproj",
    prproj: { sequences: parsed.sequences, selectedId: parsed.selectedId },
  };
}

