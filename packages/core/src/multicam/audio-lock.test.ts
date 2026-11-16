import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Clip } from "../types/timeline";
import type { Project } from "../types";
import {
  createMulticamSource,
  getMulticamSources,
  insertMulticamClip,
  listMulticamClips,
  multicamAudioTag,
  recordMulticamCuts,
  reconcileMulticamAudio,
  setMulticamAudioMode,
  sharedTimeAt,
  type MulticamEditResult,
} from "./source";
import { ensureSequences } from "../timeline/sequences";
import { editSnapshot } from "../actions/handlers/edit-snapshot";
import { prepareTimelineToolEdit } from "../editing/timeline-tool-edit";

const media = (id: string, duration: number) => ({
  id, name: `${id}.mp4`, type: "video" as const, blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1 },
});
const ok = (r: MulticamEditResult): Project => {
  if (!r.ok) throw new Error(r.message);
  return r.project;
};
let n = 0;
const act = (type: string, params: Record<string, unknown>) => ({ type, id: `a${++n}`, timestamp: n, params }) as unknown as Action;

/** cam2 starts 1.5 s later than cam1, cam3 0.5 s later. Fixed audio = cam3. */
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
  project = ok(recordMulticamCuts(project, { sourceId, endTime: 9, cuts: [{ time: 3, angleId: angleIds[1] }, { time: 6, angleId: angleIds[0] }] }));
  if (mode === "fixed") project = ok(setMulticamAudioMode(project, sourceId, { mode: "fixed", angleId: angleIds[2] }));
  return { project: structuredClone(project), sourceId, angleIds };
}

/**
 * Sample lock: at every timeline time a multicam video clip covers, the audio
 * clip plays the media time of the fixed angle that corresponds to the SAME
 * shared time as the picture.
 */
function expectLocked(project: Project, sourceId: string, fixedAngleId: string) {
  const source = getMulticamSources(project).find((s) => s.id === sourceId)!;
  const fixed = source.angles.find((a) => a.id === fixedAngleId)!;
  const audio = project.timeline.tracks.flatMap((t) => t.clips).filter((c) => multicamAudioTag(c) === sourceId);
  const refs = listMulticamClips(project, sourceId);
  let checked = 0;
  for (const ref of refs) {
    for (const f of [0.05, 0.5, 0.95]) {
      const t = ref.clip.startTime + ref.clip.duration * f;
      const shared = sharedTimeAt(ref.clip, ref.angle, t);
      const owner = audio.find((c) => t >= c.startTime && t < c.startTime + c.duration);
      if (!owner) continue; // outside the audio angle's footage
      const heard = owner.inPoint + (t - owner.startTime) + fixed.offset;
      expect(Math.abs(heard - shared)).toBeLessThan(1e-9);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
  expect(refs.every((r) => r.clip.volume === 0)).toBe(true);
}

const videoClips = (p: Project): Clip[] => p.timeline.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips).sort((a, b) => a.startTime - b.startTime);

describe("fixed multicam audio stays locked to the multicam video", () => {
  it("move, trim head, trim tail, slip, razor, ripple delete, undo and redo", async () => {
    const { project: live, sourceId, angleIds } = fixture();
    const fixedId = angleIds[2];
    const original = JSON.stringify(editSnapshot(live));
    expectLocked(live, sourceId, fixedId);
    const executor = new ActionExecutor();
    const run = async (a: Action) => {
      const r = await executor.execute(a, live);
      expect(r.success, JSON.stringify(r)).toBe(true);
      expectLocked(live, sourceId, fixedId);
    };
    // Common range is 1.5..12 shared; clips: [0,3) [3,6) [6,9) [9,10.5).
    const [a, , , last] = videoClips(live);
    await run(act("clip/move", { clipId: last.id, startTime: 14 }));
    await run(act("clip/trim", { clipId: a.id, inPoint: a.inPoint + 0.4 }));
    await run(act("clip/trim", { clipId: a.id, outPoint: a.inPoint + 0.4 + 1.9 }));
    await run(act("clip/slip", { clipId: videoClips(live)[0].id, delta: 0.25 }));
    const target = videoClips(live)[0];
    await run(act("clip/split", { clipId: target.id, time: target.startTime + target.duration / 2 }));
    await run(act("clip/rippleDelete", { clipId: videoClips(live)[1].id }));

    const history = executor.getHistory();
    const edited = JSON.stringify(editSnapshot(live));
    let i = 0;
    for (; history.canUndo(); i++) {
      { const u = await executor.undo(live); expect(u.success, `undo ${i} ` + JSON.stringify(u)).toBe(true); }
      expectLocked(live, sourceId, fixedId);
    }
    // The derived audio clips come back exactly (same ids), not merely equivalent ones.
    expect(JSON.stringify(editSnapshot(live))).toBe(original);
    const steps = i;
    expect(steps).toBeGreaterThanOrEqual(5);
    for (i = 0; i < steps; i++) {
      { const u = await executor.redo(live); expect(u.success, `redo ${i} ` + JSON.stringify(u)).toBe(true); }
      expectLocked(live, sourceId, fixedId);
    }
    expect(JSON.stringify(editSnapshot(live))).toBe(edited);
  });

  it("a moved clip does not leave the audio behind (the reported drift)", async () => {
    const { project: live, sourceId, angleIds } = fixture();
    const executor = new ActionExecutor();
    const last = videoClips(live).at(-1)!;
    await executor.execute(act("clip/move", { clipId: last.id, startTime: 20 }), live);
    const audio = live.timeline.tracks.flatMap((t) => t.clips).filter((c) => multicamAudioTag(c) === sourceId);
    expect(audio.some((c) => Math.abs(c.startTime - 20) < 1e-9)).toBe(true);
    expectLocked(live, sourceId, angleIds[2]);
  });

  it("preserves ids and user volume of the audio clips across edits", async () => {
    const { project: live, sourceId } = fixture();
    const audioBefore = live.timeline.tracks.flatMap((t) => t.clips).find((c) => multicamAudioTag(c) === sourceId)!;
    (audioBefore as { volume: number }).volume = 0.5;
    const executor = new ActionExecutor();
    await executor.execute(act("clip/trim", { clipId: videoClips(live)[0].id, inPoint: 0.3 }), live);
    const audioAfter = live.timeline.tracks.flatMap((t) => t.clips).find((c) => multicamAudioTag(c) === sourceId)!;
    expect(audioAfter.id).toBe(audioBefore.id);
    expect(audioAfter.volume).toBe(0.5);
  });

  it("works on the active sequence (the timeline of a multi-sequence project)", async () => {
    const { project, sourceId, angleIds } = fixture();
    const live = structuredClone(ensureSequences(project));
    const executor = new ActionExecutor();
    const last = videoClips(live).at(-1)!;
    await executor.execute(act("clip/move", { clipId: last.id, startTime: last.startTime + 4 }), live);
    expectLocked(live, sourceId, angleIds[2]);
  });

  it("is a no-op (same object) for follow mode and for already-locked projects", () => {
    const f = fixture("follow");
    expect(reconcileMulticamAudio(f.project)).toBe(f.project);
    const g = fixture();
    expect(reconcileMulticamAudio(g.project)).toBe(g.project);
  });

  it("audio-follows-video: no detached audio clips appear and the picture clips keep their own sound", async () => {
    const { project: live, sourceId } = fixture("follow");
    const executor = new ActionExecutor();
    const [a] = videoClips(live);
    await executor.execute(act("clip/move", { clipId: a.id, startTime: 5 }), live);
    await executor.execute(act("clip/trim", { clipId: a.id, inPoint: a.inPoint + 0.5 }), live);
    expect(live.timeline.tracks.flatMap((t) => t.clips).some((c) => multicamAudioTag(c) === sourceId)).toBe(false);
    expect(videoClips(live).every((c) => c.volume === 1)).toBe(true);
  });

  it("ripple, roll, slip and slide tool edits (timeline/toolEdit) keep the audio locked", async () => {
    for (const [mode, edge, delta] of [
      ["ripple", "right", -0.5],
      ["ripple", "left", 0.4],
      ["roll", "right", 0.3],
      ["slip", "right", 0.2],
      ["slide", "right", 0.25],
    ] as const) {
      const { project: live, sourceId, angleIds } = fixture();
      const executor = new ActionExecutor();
      const clip = videoClips(live)[1];
      const plan = prepareTimelineToolEdit(live, { mode, itemId: clip.id, edge } as Parameters<typeof prepareTimelineToolEdit>[1]).plan(delta);
      const r = await executor.execute(act("timeline/toolEdit", { edits: plan.edits, label: plan.label }), live);
      expect(r.success, `${mode} ${edge} ${JSON.stringify(r)}`).toBe(true);
      expectLocked(live, sourceId, angleIds[2]);
      await executor.undo(live);
      expectLocked(live, sourceId, angleIds[2]);
    }
  });
});
