import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import { editSnapshot } from "../actions/handlers/edit-snapshot";
import type { Project } from "../types";
import { ensureSequences, nestClips } from "../timeline/sequences";
import { exportTimeline } from "../interchange";
import {
  computeAngleOffsets,
  createMulticamSource,
  flattenMulticam,
  getMulticamSources,
  insertMulticamClip,
  listMulticamClips,
  multicamClipAtTime,
  multicamCommonRange,
  recordMulticamCuts,
  setMulticamAudioMode,
  switchMulticamAngle,
  type MulticamEditResult,
} from "./source";

const media = (id: string, duration: number) => ({
  id, name: `${id}.mp4`, type: "video" as const, blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1 },
});

function base(): Project {
  return {
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media("cam1", 20), media("cam2", 20), media("cam3", 20)] as unknown as Project["mediaLibrary"]["items"] },
    timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
  } as Project;
}

function ok(result: MulticamEditResult): Project {
  if (!result.ok) throw new Error(result.message);
  return result.project;
}

/** cam2 started 1.5 s after cam1, cam3 0.5 s after: offsets are shared-time starts of each media. */
function withSource(): { project: Project; sourceId: string; angleIds: string[] } {
  const created = createMulticamSource(base(), {
    name: "Take 1",
    syncMethod: "audio",
    angles: [
      { mediaId: "cam1", offset: 0 },
      { mediaId: "cam2", offset: 1.5 },
      { mediaId: "cam3", offset: 0.5 },
    ],
  });
  if (!created.ok || !created.sourceId) throw new Error("create failed");
  const source = getMulticamSources(created.project)[0];
  return { project: created.project, sourceId: created.sourceId, angleIds: source.angles.map((a) => a.id) };
}

describe("computeAngleOffsets", () => {
  it("normalises audio offsets so the earliest angle is 0", () => {
    const result = computeAngleOffsets("audio", [
      { mediaId: "a" },
      { mediaId: "b", audioOffset: -2 },
      { mediaId: "c", audioOffset: 1 },
    ]);
    expect(result).toEqual({ ok: true, offsets: [2, 0, 3] });
  });
  it("syncs by timecode, in points and markers", () => {
    expect(computeAngleOffsets("timecode", [{ mediaId: "a", timecode: 3600 }, { mediaId: "b", timecode: 3602.5 }])).toEqual({ ok: true, offsets: [0, 2.5] });
    // b's marked In is 4 s into its media, a's 1 s: b started 3 s before a.
    expect(computeAngleOffsets("in-points", [{ mediaId: "a", inPoint: 1 }, { mediaId: "b", inPoint: 4 }])).toEqual({ ok: true, offsets: [3, 0] });
    expect(computeAngleOffsets("markers", [{ mediaId: "a", marker: 5 }, { mediaId: "b", marker: 2 }])).toEqual({ ok: true, offsets: [0, 3] });
  });
  it("explains what is missing", () => {
    const result = computeAngleOffsets("timecode", [{ mediaId: "a", timecode: 1 }, { mediaId: "b" }]);
    expect(result.ok).toBe(false);
    expect(computeAngleOffsets("markers", [{ mediaId: "a" }, { mediaId: "b", marker: 1 }]).ok).toBe(false);
  });
});

describe("multicam source", () => {
  it("validates the angle set", () => {
    expect(createMulticamSource(base(), { syncMethod: "manual", angles: [{ mediaId: "cam1", offset: 0 }] }).ok).toBe(false);
    expect(createMulticamSource(base(), { syncMethod: "manual", angles: [{ mediaId: "cam1", offset: 0 }, { mediaId: "cam1", offset: 0 }] }).ok).toBe(false);
    expect(createMulticamSource(base(), { syncMethod: "manual", angles: [{ mediaId: "cam1", offset: 0 }, { mediaId: "nope", offset: 0 }] }).ok).toBe(false);
    // No overlap: second angle starts after the first ends.
    expect(createMulticamSource(base(), { syncMethod: "manual", angles: [{ mediaId: "cam1", offset: 0 }, { mediaId: "cam2", offset: 25 }] }).ok).toBe(false);
  });
  it("computes the common range", () => {
    const { project, sourceId } = withSource();
    const source = getMulticamSources(project).find((s) => s.id === sourceId)!;
    expect(multicamCommonRange(source)).toEqual({ start: 1.5, end: 20 });
  });
});

describe("insert, record, switch, flatten", () => {
  it("inserts one multicam clip whose frames line up on every angle", () => {
    const { project, sourceId, angleIds } = withSource();
    const result = insertMulticamClip(project, { sourceId, startTime: 0, angleId: angleIds[1] });
    const placed = ok(result);
    const refs = listMulticamClips(placed);
    expect(refs).toHaveLength(1);
    const { clip } = refs[0];
    // Angle 2 starts at shared 1.5, so the common range begins at its media time 0.
    expect(clip.mediaId).toBe("cam2");
    expect(clip.inPoint).toBeCloseTo(0, 6);
    expect(clip.duration).toBeCloseTo(18.5, 1);
    expect(placed.timeline.duration).toBeGreaterThan(18);
  });

  it("switching moves the clip to the same shared moment on another angle", () => {
    const { project, sourceId, angleIds } = withSource();
    const placed = ok(insertMulticamClip(project, { sourceId, startTime: 2, angleId: angleIds[0] }));
    const [first] = listMulticamClips(placed);
    expect(first.clip.inPoint).toBeCloseTo(1.5, 6);
    const switched = ok(switchMulticamAngle(placed, [first.clip.id], angleIds[2]));
    const [after] = listMulticamClips(switched);
    expect(after.clip.mediaId).toBe("cam3");
    // shared 1.5 -> cam3 media time 1.5 - 0.5 = 1.0
    expect(after.clip.inPoint).toBeCloseTo(1.0, 6);
    expect(after.clip.startTime).toBe(first.clip.startTime);
    expect(after.clip.duration).toBe(first.clip.duration);
  });

  it("records a pass of cuts: splits where needed and keeps total length", () => {
    const { project, sourceId, angleIds } = withSource();
    const placed = ok(insertMulticamClip(project, { sourceId, startTime: 0, angleId: angleIds[0] }));
    const total = listMulticamClips(placed)[0].clip.duration;
    const cut = ok(
      recordMulticamCuts(placed, {
        sourceId,
        endTime: 10,
        cuts: [
          { time: 2, angleId: angleIds[1] },
          { time: 4, angleId: angleIds[2] },
          { time: 6.5, angleId: angleIds[0] },
          { time: 8, angleId: angleIds[1] },
        ],
      }),
    );
    const refs = listMulticamClips(cut);
    expect(refs.map((r) => [r.clip.startTime, r.angle.id === angleIds[0] ? 1 : r.angle.id === angleIds[1] ? 2 : 3])).toEqual([
      [0, 1], [2, 2], [4, 3], [6.5, 1], [8, 2], [10, 1],
    ]);
    expect(refs.reduce((sum, r) => sum + r.clip.duration, 0)).toBeCloseTo(total, 6);
    // Every piece shows the same shared moment its position implies, whatever its angle.
    for (const r of refs) {
      const shared = r.clip.inPoint + r.angle.offset;
      expect(shared).toBeCloseTo(1.5 + r.clip.startTime, 5);
    }
    expect(multicamClipAtTime(cut, 5)?.angle.id).toBe(angleIds[2]);
  });

  it("refuses to record without a multicam clip and to switch outside an angle's footage", () => {
    const { project, sourceId, angleIds } = withSource();
    expect(recordMulticamCuts(project, { endTime: 5, cuts: [{ time: 1, angleId: angleIds[0] }] }).ok).toBe(false);
    const placed = ok(insertMulticamClip(project, { sourceId, startTime: 0, angleId: angleIds[0] }));
    const tail = ok(recordMulticamCuts(placed, { sourceId, endTime: 18, cuts: [{ time: 17, angleId: angleIds[1] }] }));
    expect(listMulticamClips(tail).find((r) => r.clip.startTime === 17)?.angle.id).toBe(angleIds[1]);
  });

  it("creates a source whose fixed audio angle is the chosen media, not always angle 1", () => {
    const base0 = base();
    const created = createMulticamSource(base0, {
      syncMethod: "manual",
      angles: [{ mediaId: "cam1", offset: 0 }, { mediaId: "cam2", offset: 0 }, { mediaId: "cam3", offset: 0 }],
      audio: { mode: "fixed", mediaId: "cam3" },
    });
    const next = ok(created);
    const source = getMulticamSources(next)[0];
    expect(source.audio).toEqual({ mode: "fixed", angleId: source.angles[2].id });
    const placed = ok(insertMulticamClip(next, { sourceId: source.id, startTime: 0 }));
    const audioClips = placed.timeline.tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips);
    expect(audioClips.map((c) => c.mediaId)).toEqual(["cam3"]);
  });

  it("rejects non-finite times instead of writing NaN/Infinity clips", () => {
    const { project, sourceId, angleIds } = withSource();
    expect(insertMulticamClip(project, { sourceId, startTime: Number.NaN }).ok).toBe(false);
    expect(insertMulticamClip(project, { sourceId, startTime: Infinity }).ok).toBe(false);
    const placed = ok(insertMulticamClip(project, { sourceId, startTime: 0, angleId: angleIds[0] }));
    expect(recordMulticamCuts(placed, { sourceId, endTime: Infinity, cuts: [{ time: 1, angleId: angleIds[1] }] }).ok).toBe(false);
    expect(recordMulticamCuts(placed, { sourceId, endTime: 5, cuts: [{ time: Number.NaN, angleId: angleIds[1] }] }).ok).toBe(false);
    for (const ref of listMulticamClips(placed)) expect(Number.isFinite(ref.clip.startTime + ref.clip.duration)).toBe(true);
  });

  it("flattens to plain clips of the active angle, keeping every frame", () => {
    const { project, sourceId, angleIds } = withSource();
    const placed = ok(insertMulticamClip(project, { sourceId, startTime: 0, angleId: angleIds[0] }));
    const cut = ok(recordMulticamCuts(placed, { sourceId, endTime: 6, cuts: [{ time: 2, angleId: angleIds[1] }, { time: 4, angleId: angleIds[2] }] }));
    const before = cut.timeline.tracks[0].clips.map((c) => ({ ...c, metadata: undefined }));
    const flat = ok(flattenMulticam(cut));
    expect(listMulticamClips(flat)).toHaveLength(0);
    expect(flat.timeline.tracks[0].clips.map((c) => ({ ...c, metadata: undefined })).map((c) => [c.mediaId, c.startTime, c.inPoint])).toEqual(
      before.map((c) => [c.mediaId, c.startTime, c.inPoint]),
    );
    expect(flat.timeline.tracks[0].clips.every((c) => c.metadata === undefined || !("multicam" in c.metadata))).toBe(true);
    expect(flattenMulticam(flat).ok).toBe(false);
  });

  it("fixed audio silences the video and adds one audio clip from the audio angle; follow restores", () => {
    const { project, sourceId, angleIds } = withSource();
    const placed = ok(insertMulticamClip(project, { sourceId, startTime: 0, angleId: angleIds[0] }));
    const cut = ok(recordMulticamCuts(placed, { sourceId, endTime: 6, cuts: [{ time: 2, angleId: angleIds[1] }] }));
    const fixed = ok(setMulticamAudioMode(cut, sourceId, { mode: "fixed", angleId: angleIds[2] }));
    const video = fixed.timeline.tracks.find((t) => t.type === "video")!;
    expect(video.clips.every((c) => c.volume === 0)).toBe(true);
    const audio = fixed.timeline.tracks.find((t) => t.name === "Multicam Audio")!;
    expect(audio.type).toBe("audio");
    expect(audio.clips).toHaveLength(1);
    expect(audio.clips[0].mediaId).toBe("cam3");
    // Shared 1.5 at timeline 0; cam3 starts at shared 0.5 so media time 1.0.
    expect(audio.clips[0].inPoint).toBeCloseTo(1.0, 6);
    // Re-recording keeps a single, correct audio clip.
    const again = ok(recordMulticamCuts(fixed, { sourceId, endTime: 8, cuts: [{ time: 6, angleId: angleIds[0] }] }));
    expect(again.timeline.tracks.find((t) => t.name === "Multicam Audio")!.clips).toHaveLength(1);
    const follow = ok(setMulticamAudioMode(again, sourceId, { mode: "follow" }));
    expect(follow.timeline.tracks.find((t) => t.name === "Multicam Audio")!.clips).toHaveLength(0);
    expect(follow.timeline.tracks.find((t) => t.type === "video")!.clips.every((c) => c.volume === 1)).toBe(true);
  });
});

describe("integration with the action system, sequences and interchange", () => {
  it("a whole recording pass is exactly one undo step and undo/redo is exact", async () => {
    const { project, sourceId, angleIds } = withSource();
    const placed = ok(insertMulticamClip(project, { sourceId, startTime: 0, angleId: angleIds[0] }));
    const executor = new ActionExecutor();
    const live: Project = structuredClone(placed);
    const before = JSON.stringify(editSnapshot(live));
    const next = ok(recordMulticamCuts(live, { sourceId, endTime: 9, cuts: [{ time: 1, angleId: angleIds[1] }, { time: 3, angleId: angleIds[2] }, { time: 5, angleId: angleIds[0] }] }));
    const result = await executor.execute({ type: "project/applyEditSnapshot", id: "a1", timestamp: 1, params: { snapshot: editSnapshot(next) } }, live);
    expect(result.success).toBe(true);
    expect(live.timeline.tracks[0].clips.length).toBe(5);
    expect(executor.getHistory().getUndoStackSize()).toBe(1);
    const after = JSON.stringify(editSnapshot(live));
    await executor.undo(live);
    expect(JSON.stringify(editSnapshot(live))).toBe(before);
    await executor.redo(live);
    expect(JSON.stringify(editSnapshot(live))).toBe(after);
  });

  it("works inside an opened nest (the active sequence is the nest)", () => {
    const { project, sourceId, angleIds } = withSource();
    const placed = ok(insertMulticamClip(project, { sourceId, startTime: 0, angleId: angleIds[0] }));
    const cut = ok(recordMulticamCuts(placed, { sourceId, endTime: 6, cuts: [{ time: 2, angleId: angleIds[1] }] }));
    const seq = ensureSequences(cut);
    const ids = seq.timeline.tracks[0].clips.map((c) => c.id);
    const nested = nestClips(seq, ids, "Nest");
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    // The multicam tags travel into the nest.
    const inner = nested.project.sequences!.find((s) => s.id !== nested.project.activeSequenceId)!;
    expect(inner.timeline.tracks.flatMap((t) => t.clips).filter((c) => c.metadata?.multicam).length).toBe(ids.length);
  });

  it("carries multicam clips as a multiclip in an XMEML export, and reports them flattened in OTIO", () => {
    const { project, sourceId, angleIds } = withSource();
    const placed = ok(insertMulticamClip(project, { sourceId, startTime: 0, angleId: angleIds[0] }));
    const cut = ok(recordMulticamCuts(placed, { sourceId, endTime: 6, cuts: [{ time: 2, angleId: angleIds[1] }] }));
    const exported = exportTimeline(cut, "xmeml");
    expect(exported.report.items.find((i) => i.feature === "Multicam clip")).toBeUndefined();
    expect(exported.files[0].content).toContain("<xmeml");
    expect(exported.files[0].content).toContain("<multiclip ");
    const flat = exportTimeline(cut, "otio");
    const item = flat.report.items.find((i) => i.feature === "Multicam clip");
    expect(item).toBeTruthy();
    expect(item?.severity).toBe("approximated");
  });
});
