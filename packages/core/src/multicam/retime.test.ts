import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import { editSnapshot } from "../actions/handlers/edit-snapshot";
import type { Action } from "../types/actions";
import type { Clip } from "../types/timeline";
import type { Project } from "../types";
import { prepareTimelineToolEdit } from "../editing/timeline-tool-edit";
import {
  createMulticamSource,
  getMulticamSources,
  insertMulticamClip,
  listMulticamClips,
  multicamAudioTag,
  multicamClipAtTime,
  multicamClipSourceTime,
  recordMulticamCuts,
  setMulticamAudioMode,
  switchMulticamAngle,
  type MulticamEditResult,
} from "./source";

const media = (id: string, duration: number) => ({
  id, name: `${id}.mp4`, type: "video" as const, blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1 },
});
const ok = (r: MulticamEditResult): Project => {
  if (!r.ok) throw new Error(r.message);
  return r.project;
};
let n = 0;
const act = (type: string, params: Record<string, unknown>) => ({ type, id: `r${++n}`, timestamp: n, params }) as unknown as Action;

/** cam1 offset 0, cam2 offset 1.5, cam3 offset 0.5 (fixed audio). One 10.5 s clip on cam1. */
function fixture(mode: "fixed" | "follow" = "fixed") {
  const base = {
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media("cam1", 12), media("cam2", 12), media("cam3", 12)] },
    timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
  } as unknown as Project;
  const created = createMulticamSource(base, {
    name: "Take", syncMethod: "audio",
    angles: [{ mediaId: "cam1", offset: 0 }, { mediaId: "cam2", offset: 1.5 }, { mediaId: "cam3", offset: 0.5 }],
  });
  if (!created.ok || !created.sourceId) throw new Error("create");
  const sourceId = created.sourceId;
  const angleIds = getMulticamSources(created.project)[0].angles.map((a) => a.id);
  let project = ok(insertMulticamClip(created.project, { sourceId, startTime: 0, angleId: angleIds[0] }));
  if (mode === "fixed") project = ok(setMulticamAudioMode(project, sourceId, { mode: "fixed", angleId: angleIds[2] }));
  return { project: structuredClone(project), sourceId, angleIds };
}

const videoClips = (p: Project): Clip[] => p.timeline.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips).sort((a, b) => a.startTime - b.startTime);
const audioClips = (p: Project, sourceId: string): Clip[] => p.timeline.tracks.flatMap((t) => t.clips).filter((c) => multicamAudioTag(c) === sourceId).sort((a, b) => a.startTime - b.startTime);
const angleOf = (c: Clip): string => (c.metadata?.multicam as { angleId: string }).angleId;

/** Apply a retime directly to every multicam picture clip (as if the action had run), keeping the start time. */
function retimed(project: Project, patch: (c: Clip) => Partial<Clip>): Project {
  const tracks = project.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.metadata?.multicam ? { ...c, ...patch(c) } : c)) }));
  return { ...project, timeline: { ...project.timeline, tracks } };
}

/** At sampled timeline times the audio plays the same shared time as the picture. */
function expectLocked(project: Project, sourceId: string, fixedAngleId: string) {
  const fixed = getMulticamSources(project).find((s) => s.id === sourceId)!.angles.find((a) => a.id === fixedAngleId)!;
  const audio = audioClips(project, sourceId);
  let checked = 0;
  for (const ref of listMulticamClips(project, sourceId)) {
    for (const f of [0.02, 0.25, 0.5, 0.75, 0.98]) {
      const t = ref.clip.startTime + ref.clip.duration * f;
      const shared = multicamClipSourceTime(ref.clip, t) + ref.angle.offset;
      const owner = audio.find((c) => t >= c.startTime && t < c.startTime + c.duration);
      if (!owner) continue;
      const heard = multicamClipSourceTime(owner, t) + fixed.offset;
      expect(Math.abs(heard - shared), `t=${t}`).toBeLessThan(2e-3);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
}

describe("multicam clips can be retimed", () => {
  it("2x speed: duration halves, fixed audio follows at the same rate, undo/redo are exact", async () => {
    const { project: live, sourceId, angleIds } = fixture();
    const executor = new ActionExecutor();
    const before = JSON.stringify(editSnapshot(live));
    const [clip] = videoClips(live);
    const r = await executor.execute(act("clip/setSpeed", { clipId: clip.id, speed: 2 }), live);
    expect(r.success, JSON.stringify(r)).toBe(true);
    const [sped] = videoClips(live);
    expect(sped.duration).toBeCloseTo(clip.duration / 2, 9);
    const [audio] = audioClips(live, sourceId);
    expect(audio.speed).toBe(2);
    expect(audio.duration).toBeCloseTo(sped.duration, 9);
    expectLocked(live, sourceId, angleIds[2]);
    const edited = JSON.stringify(editSnapshot(live));
    expect((await executor.undo(live)).success).toBe(true);
    // The generic speed inverse writes an explicit speed: 1 back (same as for ordinary clips).
    expect(videoClips(live)[0].speed).toBe(1);
    expect(videoClips(live)[0].duration).toBeCloseTo(clip.duration, 9);
    expect(JSON.stringify(audioClips(live, sourceId))).toBe(JSON.stringify(JSON.parse(before).timeline.tracks[1].clips));
    expect(audioClips(live, sourceId)[0].speed).toBeUndefined();
    expect((await executor.redo(live)).success).toBe(true);
    expect(JSON.stringify(editSnapshot(live))).toBe(edited);
  });

  it("reverse: audio is reversed too and stays on the same shared time", async () => {
    const { project: live, sourceId, angleIds } = fixture();
    const executor = new ActionExecutor();
    const [clip] = videoClips(live);
    expect((await executor.execute(act("clip/setReverse", { clipId: clip.id, reversed: true }), live)).success).toBe(true);
    const [audio] = audioClips(live, sourceId);
    expect(audio.reversed).toBe(true);
    expectLocked(live, sourceId, angleIds[2]);
    const [rev] = videoClips(live);
    expect(multicamClipSourceTime(rev, rev.startTime)).toBeCloseTo(rev.outPoint, 6);
  });

  it("pitch correction choice follows the picture onto the audio", async () => {
    const { project: live, sourceId } = fixture();
    const executor = new ActionExecutor();
    const [clip] = videoClips(live);
    await executor.execute(act("clip/setSpeed", { clipId: clip.id, speed: 2 }), live);
    await executor.execute(act("clip/setPitchCorrection", { clipId: clip.id, pitchCorrection: false }), live);
    expect(audioClips(live, sourceId)[0].pitchCorrection).toBe(false);
    await executor.execute(act("clip/setPitchCorrection", { clipId: clip.id, pitchCorrection: true }), live);
    expect(audioClips(live, sourceId)[0].pitchCorrection).toBe(true);
  });

  it("cuts recorded on a 2x clip land at the right OUTPUT times and keep source continuity", () => {
    const { project, sourceId, angleIds } = fixture("follow");
    const live = retimed(project, (c) => ({ speed: 2, duration: c.duration / 2 }));
    const original = videoClips(live)[0];
    const cut = ok(recordMulticamCuts(live, { sourceId, endTime: 5, cuts: [{ time: 1.5, angleId: angleIds[1] }, { time: 3, angleId: angleIds[0] }] }));
    const pieces = videoClips(cut);
    expect(pieces.map((p) => +p.startTime.toFixed(4)).slice(0, 3)).toEqual([0, 1.5, 3]);
    expect(pieces.slice(0, 3).map(angleOf)).toEqual([angleIds[0], angleIds[1], angleIds[0]]);
    expect(pieces.every((p) => p.speed === 2)).toBe(true);
    for (const t of [0.2, 1.4, 1.6, 2.9, 3.1, 4.9]) {
      const piece = pieces.find((p) => t >= p.startTime && t < p.startTime + p.duration)!;
      const ref = listMulticamClips(cut).find((r) => r.clip.id === piece.id)!;
      expect(multicamClipSourceTime(piece, t) + ref.angle.offset).toBeCloseTo(multicamClipSourceTime(original, t), 3);
    }
    expect(multicamClipAtTime(cut, 2)?.angle.id).toBe(angleIds[1]);
  });

  it("cuts on a reversed clip keep the pictures in reverse source order and the audio merges", () => {
    const { project, sourceId, angleIds } = fixture("follow");
    const live = retimed(project, () => ({ reversed: true }));
    const original = videoClips(live)[0];
    const cut = ok(recordMulticamCuts(live, { sourceId, endTime: 9, cuts: [{ time: 3, angleId: angleIds[1] }, { time: 6, angleId: angleIds[0] }] }));
    const pieces = videoClips(cut);
    expect(pieces.length).toBe(4);
    expect(pieces.every((p) => p.reversed === true)).toBe(true);
    for (const t of [0.1, 2.9, 3.1, 5.9, 6.1, 8.9]) {
      const piece = pieces.find((p) => t >= p.startTime && t < p.startTime + p.duration)!;
      const ref = listMulticamClips(cut).find((r) => r.clip.id === piece.id)!;
      expect(multicamClipSourceTime(piece, t) + ref.angle.offset).toBeCloseTo(multicamClipSourceTime(original, t), 3);
    }
    const withAudio = ok(setMulticamAudioMode(cut, sourceId, { mode: "fixed", angleId: angleIds[2] }));
    expect(audioClips(withAudio, sourceId).length).toBe(1);
    expectLocked(withAudio, sourceId, angleIds[2]);
  });

  it("angle switch on a retimed clip keeps speed/reverse and moves the same source span", () => {
    const { project, angleIds } = fixture("follow");
    const live = retimed(project, (c) => ({ speed: 2, reversed: true, duration: c.duration / 2 }));
    const [clip] = videoClips(live);
    const [moved] = videoClips(ok(switchMulticamAngle(live, [clip.id], angleIds[1])));
    expect(moved.speed).toBe(2);
    expect(moved.reversed).toBe(true);
    expect(moved.duration).toBeCloseTo(clip.duration, 9);
    expect(moved.inPoint).toBeCloseTo(clip.inPoint - 1.5, 9);
    expect(moved.outPoint - moved.inPoint).toBeCloseTo(clip.outPoint - clip.inPoint, 9);
  });

  it("speed ramps carry to the audio; cutting inside a ramp is refused", async () => {
    const { project: live, sourceId, angleIds } = fixture();
    const executor = new ActionExecutor();
    const [clip] = videoClips(live);
    const ramp = [{ id: "k1", time: 0, speed: 1, easing: "linear" }, { id: "k2", time: 6, speed: 3, easing: "linear" }];
    const r = await executor.execute(act("speed/setRampData", { clipId: clip.id, keyframes: ramp, freezeFrames: [] }), live);
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(audioClips(live, sourceId)[0].speedKeyframes).toEqual(ramp);
    expectLocked(live, sourceId, angleIds[2]);
    expect(recordMulticamCuts(live, { sourceId, endTime: 4, cuts: [{ time: 2, angleId: angleIds[1] }] }).ok).toBe(false);
    const switched = ok(switchMulticamAngle(live, [videoClips(live)[0].id], angleIds[1]));
    expect(videoClips(switched)[0].speedKeyframes).toEqual(ramp);
  });

  it("rate stretch (timeline/toolEdit) is allowed and keeps the audio locked", async () => {
    const { project: live, sourceId, angleIds } = fixture();
    const executor = new ActionExecutor();
    const [clip] = videoClips(live);
    const plan = prepareTimelineToolEdit(live, { mode: "stretch", itemId: clip.id, edge: "right" }).plan(-2);
    const result = await executor.execute(act("timeline/toolEdit", { edits: plan.edits, label: plan.label }), live);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(videoClips(live)[0].speed).toBeGreaterThan(1);
    expect(audioClips(live, sourceId)[0].speed).toBe(videoClips(live)[0].speed);
    expectLocked(live, sourceId, angleIds[2]);
  });

  it("resetting to 1x removes the retime fields from the derived audio again", async () => {
    const { project: live, sourceId } = fixture();
    const executor = new ActionExecutor();
    const [clip] = videoClips(live);
    await executor.execute(act("clip/setSpeed", { clipId: clip.id, speed: 2 }), live);
    await executor.execute(act("clip/setSpeed", { clipId: clip.id, speed: 1 }), live);
    const [audio] = audioClips(live, sourceId);
    expect(audio.speed).toBeUndefined();
    expect(audio.duration).toBeCloseTo(videoClips(live)[0].duration, 9);
  });
});
