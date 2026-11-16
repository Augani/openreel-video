import type { MediaItem } from "../types/project";
import type { InterchangeReport, Sequence, SeqClip, SeqMarker, SeqMedia, SeqTrack, SeqTransition } from "./model";
import { fpsOf, framesToSeconds, resolveFrameRate, timecodeToFrames } from "./timecode";

/**
 * CMX3600 EDL import. Events become clips on video tracks; the reel name and the source timecodes are
 * kept on every clip (`metadata.edl`), and reels are relinked to the media bin by reel name, using the
 * file's embedded start timecode so the source in-point lands on the right frame.
 */

export interface EdlParseOptions {
  /** Sequence frame rate. Default: 29.97 for a drop-frame EDL, otherwise 24. */
  frameRate?: number;
  width?: number;
  height?: number;
  /** Media bin used to relink reels (by reel name, then source timecode). */
  mediaItems?: readonly MediaItem[];
}

export interface EdlClipInfo {
  readonly reel: string;
  /** Source timecodes exactly as written in the EDL. */
  readonly sourceIn: string;
  readonly sourceOut: string;
  readonly event: number;
}

const TC = /^\d{1,2}:\d{2}:\d{2}[:;.]\d{2,3}$/;

export function looksLikeEdl(text: string): boolean {
  const head = text.slice(0, 8192);
  if (/^\s*[{<]/.test(head)) return false;
  const lines = head.split(/\r?\n/);
  const titled = lines.some((l) => /^\s*TITLE:/i.test(l) || /^\s*FCM:/i.test(l));
  return titled && lines.some((l) => parseEventLine(l) !== null);
}

interface RawEvent {
  event: number;
  reel: string;
  track: string;
  type: string;
  dur: number | null;
  srcIn: string;
  srcOut: string;
  recIn: string;
  recOut: string;
  clipName?: string;
  sourceFile?: string;
  speedFps?: number;
}

function parseEventLine(line: string): Omit<RawEvent, "clipName" | "sourceFile" | "speedFps"> | null {
  const t = line.trim().split(/\s+/);
  if (t.length < 8 || !/^\d{1,6}$/.test(t[0])) return null;
  const tcs = t.slice(-4);
  if (!tcs.every((x) => TC.test(x))) return null;
  const middle = t.slice(3, -4);
  const dur = middle.length ? Number(middle[middle.length - 1]) : NaN;
  return {
    event: Number(t[0]),
    reel: t[1],
    track: t[2].toUpperCase(),
    type: t[3].toUpperCase(),
    dur: Number.isFinite(dur) ? dur : null,
    srcIn: tcs[0],
    srcOut: tcs[1],
    recIn: tcs[2],
    recOut: tcs[3],
  };
}

const norm = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const stemOf = (name: string): string => name.replace(/^.*[\\/]/, "").replace(/\.[^./]+$/, "");

/** Candidate bin items for a reel: reel name equals (or is the 8-char prefix of) the file stem. */
export function matchReelItems(reel: string, items: readonly MediaItem[]): MediaItem[] {
  const key = norm(reel);
  if (!key) return [];
  return items.filter((item) => {
    if (item.type === "audio") return false;
    return [item.name, item.sourceFile?.name].some((n) => {
      if (!n) return false;
      const s = norm(stemOf(n));
      return s === key || s.slice(0, 8) === key;
    });
  });
}

export function parseEdl(text: string, options: EdlParseOptions = {}): { sequence: Sequence; report: InterchangeReport } {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  let title = "EDL";
  let drop = false;
  const events: RawEvent[] = [];
  const locs: { tc: string; name: string; comment?: string }[] = [];
  let last: RawEvent | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const titleMatch = /^TITLE:\s*(.*)$/i.exec(line);
    if (titleMatch) {
      title = titleMatch[1].trim() || title;
      continue;
    }
    const fcm = /^FCM:\s*(.*)$/i.exec(line);
    if (fcm) {
      drop = /^DROP/i.test(fcm[1].trim());
      continue;
    }
    const ev = parseEventLine(line);
    if (ev) {
      last = { ...ev };
      events.push(last);
      continue;
    }
    const m2 = /^M2\s+\S+\s+(-?\d+(?:\.\d+)?)\s+\S+/i.exec(line);
    if (m2 && last) {
      last.speedFps = Number(m2[1]);
      continue;
    }
    const comment = /^\*\s*([A-Z ]+?):\s*(.*)$/i.exec(line);
    if (comment) {
      const key = comment[1].trim().toUpperCase();
      const value = comment[2].trim();
      if (key === "LOC") {
        const loc = /^(\S+)\s+\S+\s*(.*)$/.exec(value);
        if (loc && TC.test(loc[1])) locs.push({ tc: loc[1], name: loc[2].trim() });
      } else if (last && (key === "FROM CLIP NAME" || key === "TO CLIP NAME" || key === "CLIP NAME")) {
        last.clipName = value;
      } else if (last && key === "SOURCE FILE") {
        last.sourceFile = value;
      }
    }
  }
  if (events.length === 0) throw new Error("This EDL contains no events.");

  const fps = options.frameRate ?? (drop ? 29.97 : 24);
  const rate = resolveFrameRate(fps, { dropFrame: drop });
  const seqFps = fpsOf(rate);
  const frames = (tc: string): number => timecodeToFrames(tc.replace(".", ":"), rate);

  interface Prepared {
    ev: RawEvent;
    recIn: number;
    recOut: number;
    srcIn: number;
    srcOut: number;
    video: boolean;
    withAudio: boolean;
  }
  const prepared: Prepared[] = [];
  let skippedAudio = 0;
  let skippedOther = 0;
  for (const ev of events) {
    let p: Prepared;
    try {
      p = { ev, recIn: frames(ev.recIn), recOut: frames(ev.recOut), srcIn: frames(ev.srcIn), srcOut: frames(ev.srcOut), video: true, withAudio: false };
    } catch (error) {
      warnings.push(`Event ${ev.event}: ${error instanceof Error ? error.message : "bad timecode"}; skipped.`);
      continue;
    }
    const track = ev.track;
    if (track === "NONE") {
      skippedOther++;
      continue;
    }
    if (track.startsWith("A") && track !== "AA/V") {
      skippedAudio++;
      continue;
    }
    p.withAudio = track === "B" || track === "AA/V";
    if (ev.reel.toUpperCase() === "BL" || ev.reel.toUpperCase() === "BLACK") {
      skippedOther++;
      continue;
    }
    if (p.recOut <= p.recIn) continue; // zero-length (the outgoing half of a dissolve)
    prepared.push(p);
  }
  if (skippedAudio) warnings.push(`${skippedAudio} audio-only event(s) were not imported (the video events carry their audio).`);
  if (skippedOther) warnings.push(`${skippedOther} black or untracked event(s) were skipped.`);
  if (prepared.length === 0) throw new Error("This EDL has no video events to import.");

  const base = Math.min(...prepared.map((p) => p.recIn));
  const startTimecode = prepared.find((p) => p.recIn === base)!.ev.recIn;

  // Reels -> media. Source timecodes are absolute; a relinked file with an embedded start timecode is subtracted.
  const reels = new Map<string, Prepared[]>();
  for (const p of prepared) {
    const list = reels.get(p.ev.reel) ?? [];
    list.push(p);
    reels.set(p.ev.reel, list);
  }
  const media: SeqMedia[] = [];
  const baseFrames = new Map<string, number>();
  const bin = options.mediaItems ?? [];
  for (const [reel, list] of reels) {
    const minIn = Math.min(...list.map((p) => p.srcIn));
    const maxOut = Math.max(...list.map((p) => p.srcOut));
    let candidates = matchReelItems(reel, bin);
    if (candidates.length > 1) {
      // Several files share the reel name: the source timecode decides which one the events fall inside.
      const covering = candidates.filter((c) => {
        const start = Math.round((c.metadata.startTimecode ?? 0) * seqFps);
        const end = start + Math.round(c.metadata.duration * seqFps);
        return minIn >= start && maxOut <= end + 1;
      });
      if (covering.length > 0) candidates = covering;
    }
    const hit = candidates[0];
    const sourceFile = list.find((p) => p.ev.sourceFile)?.ev.sourceFile;
    if (hit) {
      const start = Math.round((hit.metadata.startTimecode ?? 0) * seqFps);
      baseFrames.set(reel, start);
      media.push({
        key: reel,
        name: hit.sourceFile?.name ?? hit.name,
        mediaItemId: hit.id,
        kind: "video",
        durationSec: hit.metadata.duration,
        rate,
        width: hit.metadata.width,
        height: hit.metadata.height,
        hasVideo: true,
        hasAudio: list.some((p) => p.withAudio),
        sampleRate: 48000,
        channels: 2,
        ...(start ? { startSec: framesToSeconds(start, rate) } : {}),
      });
    } else {
      baseFrames.set(reel, minIn);
      media.push({
        key: reel,
        name: sourceFile ? sourceFile.replace(/^.*[\\/]/, "") : reel,
        ...(sourceFile ? { pathUrl: sourceFile } : {}),
        kind: "video",
        durationSec: framesToSeconds(maxOut - minIn, rate),
        rate,
        width: options.width ?? 1920,
        height: options.height ?? 1080,
        hasVideo: true,
        hasAudio: list.some((p) => p.withAudio),
        sampleRate: 48000,
        channels: 2,
        startSec: framesToSeconds(minIn, rate),
      });
    }
  }

  const clips: SeqClip[] = [];
  const clipOf = new Map<Prepared, SeqClip>();
  for (const p of prepared) {
    const baseF = baseFrames.get(p.ev.reel) ?? 0;
    const recDur = p.recOut - p.recIn;
    const speedRaw = p.ev.speedFps !== undefined ? Math.abs(p.ev.speedFps) / seqFps : 1;
    const speed = speedRaw > 0 ? speedRaw : 1;
    const reversed = (p.ev.speedFps ?? 0) < 0;
    const span = recDur * speed;
    const srcStart = (p.srcIn - baseF) / seqFps;
    const inSec = reversed ? Math.max(0, srcStart - span / seqFps) : Math.max(0, srcStart);
    const outSec = reversed ? Math.max(inSec, srcStart) : inSec + span / seqFps;
    const info: EdlClipInfo = { reel: p.ev.reel, sourceIn: p.ev.srcIn, sourceOut: p.ev.srcOut, event: p.ev.event };
    const clip: SeqClip = {
      id: `edl-${p.ev.event}-${p.recIn}`,
      name: p.ev.clipName ?? p.ev.reel,
      mediaKey: p.ev.reel,
      startFrame: p.recIn - base,
      endFrame: p.recOut - base,
      inSec,
      outSec,
      speed,
      reversed,
      opacity: 1,
      volume: 1,
      withAudio: p.withAudio,
      edl: info,
    };
    clips.push(clip);
    clipOf.set(p, clip);
  }

  // Lanes: events that overlap in record time (keyed layers) get their own video track.
  const lanes: { track: SeqTrack; end: number }[] = [];
  const laneOf = new Map<SeqClip, number>();
  for (const clip of [...clips].sort((a, b) => a.startFrame - b.startFrame)) {
    let index = lanes.findIndex((l) => l.end <= clip.startFrame);
    if (index < 0) {
      lanes.push({ track: { kind: "video", name: `V${lanes.length + 1}`, clips: [], transitions: [], disabled: false, locked: false }, end: 0 });
      index = lanes.length - 1;
    }
    lanes[index].track.clips.push(clip);
    lanes[index].end = clip.endFrame;
    laneOf.set(clip, index);
  }
  for (const p of prepared) {
    if (p.ev.type !== "D" || !p.ev.dur || p.ev.dur <= 0) {
      if (p.ev.type !== "C" && !p.ev.type.startsWith("D")) warnings.push(`Event ${p.ev.event}: ${p.ev.type} transition imported as a cut.`);
      continue;
    }
    const clip = clipOf.get(p)!;
    const lane = lanes[laneOf.get(clip)!];
    const hasPrev = lane.track.clips.some((c) => c !== clip && Math.abs(c.endFrame - clip.startFrame) <= 1);
    if (!hasPrev) {
      warnings.push(`Event ${p.ev.event}: dissolve has no outgoing clip and was imported as a cut.`);
      continue;
    }
    const transition: SeqTransition = { kind: "dissolve", startFrame: clip.startFrame, endFrame: clip.startFrame + p.ev.dur, alignment: "start" };
    (lane.track.transitions as SeqTransition[]).push(transition);
  }

  const markers: SeqMarker[] = [];
  for (const loc of locs) {
    try {
      markers.push({ frame: Math.max(0, frames(loc.tc) - base), name: loc.name || "Marker" });
    } catch {
      warnings.push(`Locator at ${loc.tc} was skipped.`);
    }
  }

  const durationFrames = Math.max(...clips.map((c) => c.endFrame));
  const sequence: Sequence = {
    name: title,
    rate,
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    durationFrames,
    startTimecode,
    tracks: lanes.map((l) => l.track),
    markers,
    media,
  };
  return { sequence, report: { warnings } };
}
