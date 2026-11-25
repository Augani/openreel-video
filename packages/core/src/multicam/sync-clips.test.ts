import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import { editSnapshot } from "../actions/handlers/edit-snapshot";
import "../actions/handlers";
import { findLinkedPartners } from "../editing/split-edit";
import type { Clip, Track } from "../types/timeline";
import type { MediaItem, Project } from "../types/project";
import { findAudioOffset } from "./audio-sync";
import { audioSyncRejection, mergeClips, synchronizeClips } from "./sync-clips";

const FPS = 25;
const RATE = 16000;

function noise(length: number, seed: number): Float32Array {
  let s = seed >>> 0;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s / 0xffffffff - 0.5) * 0.2;
  }
  return out;
}
/** Room noise plus decaying click bursts at the given times (seconds on this recording's clock). */
function recording(seconds: number, clicks: number[], seed: number): Float32Array {
  const out = noise(Math.floor(seconds * RATE), seed);
  clicks.forEach((at, index) => {
    const start = Math.round(at * RATE);
    let x = (index * 2654435761 + 12345) >>> 0;
    for (let i = 0; i < 600 && start + i < out.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      out[start + i] += (x / 0xffffffff - 0.5) * 3 * Math.exp(-i / 120);
    }
  });
  return out;
}

const media = (id: string, type: "video" | "audio", duration: number, extra: Partial<MediaItem["metadata"]> = {}): MediaItem => ({
  id, name: id, type, blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration, width: 0, height: 0, frameRate: 0, codec: "x", sampleRate: 48000, channels: 1, fileSize: 1, ...extra },
});
const clip = (id: string, trackId: string, mediaId: string, startTime: number, duration: number, inPoint = 0): Clip => ({
  id, mediaId, trackId, startTime, duration, inPoint, outPoint: inPoint + duration, effects: [], audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  volume: 1, keyframes: [],
});
const track = (id: string, type: Track["type"], clips: Clip[], locked = false): Track => ({ id, type, name: id, clips, transitions: [], locked, hidden: false, muted: false, solo: false });
const project = (tracks: Track[], items: MediaItem[]): Project => ({
  id: "p", name: "p", createdAt: 0, modifiedAt: 0,
  settings: { width: 1920, height: 1080, frameRate: FPS, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items }, timeline: { tracks, subtitles: [], markers: [], duration: 12 },
});

// A sound at camera media time a is at recorder media time a - lead: the recorder started `lead` s after the camera.
const EVENTS = [1.0, 3.3, 7.9];
const camera = recording(10, EVENTS, 1);
const recorderFor = (lead: number) => recording(10, EVENTS.map((e) => e - lead), 2);

describe("synchronizeClips by audio", () => {
  for (const lead of [1.2, -0.84, 0.31]) {
    it(`recovers a ${lead}s lag within one frame and moves the second clip`, () => {
      const found = findAudioOffset(camera, RATE, recorderFor(lead), RATE);
      const p = project(
        [track("v", "video", [clip("cam", "v", "cam", 2, 10)]), track("a", "audio", [clip("rec", "a", "rec", 5, 10)])],
        [media("cam", "video", 10), media("rec", "audio", 10)],
      );
      const result = synchronizeClips(p, { clipIds: ["cam", "rec"], mode: "audio", offsets: [0, found.offsetSeconds], confidence: [1, found.confidence] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rec = result.project.timeline.tracks[1].clips[0];
      const cam = result.project.timeline.tracks[0].clips[0];
      // The recorder's media 0 plays `lead` seconds after the camera's media 0.
      expect(Math.abs(rec.startTime - (cam.startTime + lead))).toBeLessThan(1 / FPS);
      expect(cam.startTime).toBeGreaterThanOrEqual(0);
    });
  }

  it("rejects unrelated audio with a clear message and leaves the project untouched", () => {
    const found = findAudioOffset(camera, RATE, noise(RATE * 10, 77), RATE);
    expect(found.confidence).toBeLessThan(0.5);
    const p = project(
      [track("v", "video", [clip("cam", "v", "cam", 0, 10)]), track("a", "audio", [clip("rec", "a", "rec", 3, 10)])],
      [media("cam", "video", 10), media("rec", "audio", 10)],
    );
    const result = synchronizeClips(p, { clipIds: ["cam", "rec"], mode: "audio", offsets: [0, found.offsetSeconds], confidence: [1, found.confidence] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/matching sound/i);
    expect(p.timeline.tracks[1].clips[0].startTime).toBe(3);
  });

  it("is one undo step that restores the original positions", async () => {
    const p = project(
      [track("v", "video", [clip("cam", "v", "cam", 2, 10)]), track("a", "audio", [clip("rec", "a", "rec", 5, 10)])],
      [media("cam", "video", 10), media("rec", "audio", 10)],
    );
    const result = synchronizeClips(p, { clipIds: ["cam", "rec"], mode: "audio", offsets: [0, 1.5], confidence: [1, 1] });
    if (!result.ok) throw new Error(result.message);
    const executor = new ActionExecutor();
    const live = structuredClone(p);
    const outcome = await executor.execute({ id: "s", type: "project/applyEditSnapshot", timestamp: 1, params: { snapshot: editSnapshot(result.project) } }, live);
    expect(outcome.success).toBe(true);
    expect(live.timeline.tracks[1].clips[0].startTime).toBeCloseTo(3.5, 6);
    await executor.undo(live);
    expect(live.timeline.tracks[1].clips[0].startTime).toBe(5);
    await executor.redo(live);
    expect(live.timeline.tracks[1].clips[0].startTime).toBeCloseTo(3.5, 6);
  });

  it("accounts for trimmed in points and lifts the group when a clip would start before 0", () => {
    const p = project(
      [track("v", "video", [clip("cam", "v", "cam", 1, 5, 0.5)]), track("a", "audio", [clip("rec", "a", "rec", 4, 5, 2)])],
      [media("cam", "video", 10), media("rec", "audio", 10)],
    );
    // media-0 of rec plays 1s before cam's media-0 -> origin(rec) = origin(cam) - 1
    const result = synchronizeClips(p, { clipIds: ["cam", "rec"], mode: "audio", offsets: [0, -1], confidence: [1, 1] });
    if (!result.ok) throw new Error(result.message);
    const cam = result.project.timeline.tracks[0].clips[0];
    const rec = result.project.timeline.tracks[1].clips[0];
    // origin(cam)=1-0.5=0.5 -> origin(rec) = -0.5 -> rec.start = -0.5+2 = 1.5, nothing below zero.
    expect(rec.startTime - rec.inPoint).toBeCloseTo(cam.startTime - cam.inPoint - 1, 6);
    expect(Math.min(cam.startTime, rec.startTime)).toBeGreaterThanOrEqual(0);
  });

  it("syncs by in point and by timecode, and explains missing timecode", () => {
    const p = project(
      [track("v", "video", [clip("cam", "v", "cam", 2, 5)]), track("a", "audio", [clip("rec", "a", "rec", 6, 5)])],
      [media("cam", "video", 10, { startTimecode: 3600 }), media("rec", "audio", 10, { startTimecode: 3602.5 })],
    );
    const byIn = synchronizeClips(p, { clipIds: ["cam", "rec"], mode: "in-point" });
    expect(byIn.ok && byIn.project.timeline.tracks[1].clips[0].startTime).toBe(2);
    const byTc = synchronizeClips(p, { clipIds: ["cam", "rec"], mode: "timecode" });
    expect(byTc.ok && byTc.project.timeline.tracks[1].clips[0].startTime).toBeCloseTo(4.5, 6);
    const noTc = synchronizeClips(project(p.timeline.tracks, [media("cam", "video", 10), media("rec", "audio", 10)]), { clipIds: ["cam", "rec"], mode: "timecode" });
    expect(noTc.ok).toBe(false);
  });

  it("refuses locked tracks and needs two clips", () => {
    const p = project([track("v", "video", [clip("cam", "v", "cam", 0, 5)]), track("a", "audio", [clip("rec", "a", "rec", 1, 5)], true)], [media("cam", "video", 10), media("rec", "audio", 10)]);
    expect(synchronizeClips(p, { clipIds: ["cam", "rec"], mode: "in-point" }).ok).toBe(false);
    expect(synchronizeClips(p, { clipIds: ["cam"], mode: "in-point" }).ok).toBe(false);
  });
});

describe("mergeClips", () => {
  const items = [media("cam", "video", 10), media("rec", "audio", 10)];
  it("places an aligned, linked pair and mutes the camera audio", () => {
    const found = findAudioOffset(camera, RATE, recorderFor(1.2), RATE);
    const result = mergeClips(project([], items), { videoMediaId: "cam", audioMediaId: "rec", offsetSeconds: found.offsetSeconds, confidence: found.confidence, startTime: 4 });
    if (!result.ok) throw new Error(result.message);
    const all = result.project.timeline.tracks.flatMap((t) => t.clips);
    const v = all.find((c) => c.id === result.clipId)!;
    const a = all.find((c) => c.id === result.audioClipId)!;
    expect(v.volume).toBe(0);
    expect(Math.abs(a.startTime - a.inPoint - (v.startTime - v.inPoint + 1.2))).toBeLessThan(1 / FPS);
    const tracks = result.project.timeline.tracks;
    expect(findLinkedPartners(v, tracks).map((x) => x.clip.id)).toEqual([a.id]);
  });
  it("handles a negative offset by trimming the audio head, keeps camera audio on request, rejects no overlap and low confidence", () => {
    const neg = mergeClips(project([], items), { videoMediaId: "cam", audioMediaId: "rec", offsetSeconds: -2, confidence: 1, startTime: 0, muteCameraAudio: false });
    if (!neg.ok) throw new Error(neg.message);
    const audio = neg.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === neg.audioClipId)!;
    expect(audio.inPoint).toBe(2);
    expect(audio.startTime).toBe(0);
    expect(audio.duration).toBe(8);
    expect(neg.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === neg.clipId)!.volume).toBe(1);
    expect(mergeClips(project([], items), { videoMediaId: "cam", audioMediaId: "rec", offsetSeconds: 11, confidence: 1, startTime: 0 }).ok).toBe(false);
    const low = mergeClips(project([], items), { videoMediaId: "cam", audioMediaId: "rec", offsetSeconds: 1, confidence: 0.05, startTime: 0 });
    expect(low.ok).toBe(false);
    expect(audioSyncRejection(0.05)).toMatch(/matching sound/);
  });
});

describe("verifier edge cases", () => {
  const items = [media("cam", "video", 10), media("rec", "audio", 10)];
  it("lifts the group so a linked partner never lands before 0", () => {
    const v = clip("v", "tv", "cam", 3, 4);
    const x = clip("x", "tv2", "rec", 3, 4, 2);
    const y = clip("y", "ta", "rec", 1, 4);
    const p = project([track("tv", "video", [v]), track("tv2", "video", [x]), track("ta", "audio", [y])], items);
    const r = synchronizeClips(p, { clipIds: ["v", "x"], mode: "audio", offsets: [0, -4], confidence: [1, 1] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const all = r.project.timeline.tracks.flatMap((t) => t.clips);
    const at = (id: string) => all.find((c) => c.id === id)!.startTime;
    for (const c of all) expect(c.startTime).toBeGreaterThanOrEqual(0);
    expect(at("x") - at("y")).toBeCloseTo(2, 6);
    expect(at("x") - at("v")).toBeCloseTo(-2, 6);
  });
  it("rejects NaN confidence (silent input) with the clear message", () => {
    const p = project([track("tv", "video", [clip("v", "tv", "cam", 0, 4)]), track("ta", "audio", [clip("a", "ta", "rec", 5, 4)])], items);
    const r = synchronizeClips(p, { clipIds: ["v", "a"], mode: "audio", offsets: [0, Number.NaN], confidence: [1, Number.NaN] });
    expect(r.ok).toBe(false);
  });
  it("rejects a NaN offset in merge and survives a JSON round trip of a merged project", () => {
    const p = project([], items);
    expect(mergeClips(p, { videoMediaId: "cam", audioMediaId: "rec", offsetSeconds: Number.NaN, confidence: 1, startTime: 0 }).ok).toBe(false);
    const r = mergeClips(p, { videoMediaId: "cam", audioMediaId: "rec", offsetSeconds: 0.8, confidence: 1, startTime: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = JSON.parse(JSON.stringify(r.project)) as Project;
    const v = back.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === r.clipId)!;
    expect(findLinkedPartners(v, back.timeline.tracks).map((x) => x.clip.id)).toEqual([r.audioClipId]);
  });
});
