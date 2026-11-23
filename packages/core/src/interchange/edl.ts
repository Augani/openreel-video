import { framesToTimecode, secondsToFrames, timecodeToFrames, fpsOf } from "./timecode";
import { edlLocLines } from "./marker-export";
import type { Sequence, SeqClip, SeqTrack, SeqTransition } from "./model";
import { TRANSITION_NAMES } from "./transition-names";

/**
 * CMX3600 EDL for ONE video track. Column layout (1-based):
 *   1-3 event | 6-13 reel | 15 track | 21 edit type | 25-27 transition frames |
 *   30-40 source in | 42-52 source out | 54-64 record in | 66-76 record out.
 * Cuts are "C"; transitions are "D" dissolves with the CMX two-line form
 * (outgoing clip held at the transition start, then the incoming clip).
 */

export interface EdlOptions {
  /** Record timecode of sequence frame 0. Defaults to 01:00:00:00. */
  startTimecode?: string;
}

export interface EdlFile {
  readonly filename: string;
  readonly trackName: string;
  readonly content: string;
}

const reelOf = (name: string): string => {
  const stem = name.replace(/\.[^./]+$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return stem.slice(0, 8) || "AX";
};

const sanitizeTitle = (title: string): string => title.replace(/[\r\n]+/g, " ").trim() || "SEQUENCE";

export function serializeEdl(seq: Sequence, trackIndex = 0, options: EdlOptions = {}): string {
  const videoTracks = seq.tracks.filter((t) => t.kind === "video");
  const track: SeqTrack | undefined = videoTracks[trackIndex];
  if (!track) throw new Error("There is no video track to export as an EDL.");
  const rate = seq.rate;
  // The sequence's own start timecode (Sequence start timecode setting) wins over the 01:00:00:00 convention.
  const startTimecode = options.startTimecode ?? seq.startTimecode;
  const base = timecodeToFrames(startTimecode ?? (rate.dropFrame ? "01:00:00;00" : "01:00:00:00"), rate);
  const tc = (frames: number): string => framesToTimecode(Math.max(0, frames), rate);
  const rec = (frame: number): string => tc(base + frame);
  const mediaByKey = new Map(seq.media.map((m) => [m.key, m]));
  const clips = [...track.clips].sort((a, b) => a.startFrame - b.startFrame);

  /** Frames of the file's embedded start timecode (source columns are source timecode, not time from the file's first frame). */
  const srcBase = (c: SeqClip): number => {
    const start = mediaByKey.get(c.mediaKey)?.startSec;
    return start ? secondsToFrames(start, rate) : 0;
  };
  const srcIn = (c: SeqClip): number => srcBase(c) + secondsToFrames(c.reversed ? c.outSec : c.inSec, rate);
  /** Source frame shown at record frame `frame` (clamped to >= 0). */
  const srcAt = (c: SeqClip, frame: number): number => {
    const offset = Math.round((frame - c.startFrame) * c.speed) * (c.reversed ? -1 : 1);
    return Math.max(srcBase(c), srcIn(c) + offset);
  };

  const lines: string[] = [];
  lines.push(`TITLE: ${sanitizeTitle(seq.name)}`);
  lines.push(`FCM: ${rate.dropFrame ? "DROP FRAME" : "NON-DROP FRAME"}`);
  lines.push("");

  let event = 0;
  const times = (a: number, b: number, c: number, d: number): string => `${tc(a)} ${tc(b)} ${rec(c)} ${rec(d)}`;
  const line = (n: number, reel: string, type: "C" | "D", dur: number | null, t: string): string =>
    `${String(n).padStart(3, "0")}  ${reel.padEnd(8)} V     ${type}   ${dur === null ? "   " : String(dur).padStart(3, "0")}  ${t}`;

  const incoming = new Map<SeqClip, SeqTransition>();
  const outgoing = new Map<SeqClip, SeqTransition>();
  for (const tr of track.transitions) {
    const cut = tr.startFrame + Math.floor((tr.endFrame - tr.startFrame) / 2);
    const a = clips.find((c) => Math.abs(c.endFrame - cut) <= 1);
    const b = clips.find((c) => Math.abs(c.startFrame - cut) <= 1 && c !== a);
    if (a && b) {
      outgoing.set(a, tr);
      incoming.set(b, tr);
    }
  }

  const speedLine = (c: SeqClip, reel: string): string | null => {
    if (c.speed === 1 && !c.reversed) return null;
    const fps = fpsOf(rate) * c.speed * (c.reversed ? -1 : 1);
    const label = (fps < 0 ? "-" : "") + Math.abs(fps).toFixed(1).padStart(5, "0");
    return `M2   ${reel.padEnd(8)} ${label.padStart(6)}                ${tc(srcIn(c))}`;
  };

  for (const clip of clips) {
    const media = mediaByKey.get(clip.mediaKey);
    if (!media) continue;
    const reel = reelOf(media.name);
    const tin = incoming.get(clip);
    const tout = outgoing.get(clip);
    event++;
    const recIn = tin ? tin.startFrame : clip.startFrame;
    const recOut = tout ? tout.startFrame : clip.endFrame;
    if (recOut <= recIn) {
      event--;
      continue;
    }
    if (tin) {
      const prev = clips.find((c) => outgoing.get(c) === tin);
      if (prev) {
        const prevMedia = mediaByKey.get(prev.mediaKey);
        const prevReel = prevMedia ? reelOf(prevMedia.name) : "AX";
        const at = srcAt(prev, tin.startFrame);
        lines.push(line(event, prevReel, "C", null, times(at, at, tin.startFrame, tin.startFrame)));
        lines.push(`* FROM CLIP NAME: ${prev.name}`);
      }
      lines.push(
        line(event, reel, "D", tin.endFrame - tin.startFrame, times(srcAt(clip, tin.startFrame), srcAt(clip, recOut), recIn, recOut)),
      );
    } else {
      lines.push(line(event, reel, "C", null, times(srcAt(clip, recIn), srcAt(clip, recOut), recIn, recOut)));
    }
    const m2 = speedLine(clip, reel);
    if (m2) lines.push(m2);
    lines.push(`* TO CLIP NAME: ${clip.name}`);
    if (tin && (tin.kind !== "dissolve" || tin.type)) {
      const named = tin.type ? TRANSITION_NAMES[tin.type]?.name : undefined;
      lines.push(`* OPENREEL: ${named ?? tin.kind} transition exported as a dissolve`);
      if (named) lines.push(`* EFFECT NAME: ${named.toUpperCase()}`);
    }
    lines.push("");
  }
  const locs = edlLocLines(seq.markers, rate, startTimecode);
  if (locs.length > 0) {
    lines.push(...locs, "");
  }
  return lines.join("\n");
}

/** One EDL per video track (CMX3600 is a single-track format). */
export function serializeEdls(seq: Sequence, options: EdlOptions = {}): EdlFile[] {
  const videoTracks = seq.tracks.filter((t) => t.kind === "video");
  return videoTracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.clips.length > 0)
    .map(({ track, index }) => ({
      trackName: track.name,
      filename: `${seq.name.replace(/[^\w.-]+/g, "_") || "sequence"}_${track.name}.edl`,
      content: serializeEdl(seq, index, options),
    }));
}
