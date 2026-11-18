import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { planSmartRender, type SmartRenderSourceInfo } from "../export/smart-render";
import { planInvalidation } from "../render-cache/invalidation-planner";
import {
  createMulticamSource,
  getMulticamSources,
  insertMulticamClip,
  listMulticamClips,
  recordMulticamCuts,
  switchMulticamAngle,
  type MulticamEditResult,
} from "./source";

const media = (id: string) => ({
  id, name: `${id}.mp4`, type: "video" as const, blob: new Blob([id]), fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 20, width: 1280, height: 720, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1, hasVideo: true, hasAudio: true },
});
const base = (): Project =>
  ({
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1280, height: 720, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media("cam1"), media("cam2"), media("cam3")] },
    timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
  }) as unknown as Project;
const ok = (result: MulticamEditResult): Project => {
  if (!result.ok) throw new Error(result.message);
  return result.project;
};
const info = (mediaId: string): SmartRenderSourceInfo => ({
  mediaId, codec: "avc", width: 1280, height: 720, frameRate: 30, firstPts: 0, endTime: 20,
  keyframeTimes: Array.from({ length: 10 }, (_, i) => i * 2), closedGops: true, constantFrameRate: true, nalLengthSize: 4, rotation: 0,
});
const settings = { format: "mp4", codec: "h264", width: 1280, height: 720, frameRate: 30 } as const;

function cutProject(offset: number): Project {
  const created = createMulticamSource(base(), { syncMethod: "manual", angles: [{ mediaId: "cam1", offset: 0 }, { mediaId: "cam2", offset }] });
  if (!created.ok || !created.sourceId) throw new Error("create failed");
  const ids = getMulticamSources(created.project)[0].angles.map((a) => a.id);
  const placed = ok(insertMulticamClip(created.project, { sourceId: created.sourceId, startTime: 0, angleId: ids[0] }));
  return ok(recordMulticamCuts(placed, { sourceId: created.sourceId, endTime: 12, cuts: [{ time: 6, angleId: ids[1] }] }));
}

describe("multicam cuts in smart render", () => {
  const plan = (project: Project, frames: number) =>
    planSmartRender({ project, settings, exportStart: 0, totalFrames: frames, sources: new Map(["cam1", "cam2", "cam3"].map((id) => [id, info(id)])) });

  it("copies a frame-aligned cut", () => {
    const result = plan(cutProject(1.5), 360);
    const copied = new Set(result.segments.flatMap((s) => (s.kind === "copy" ? [s.mediaId] : [])));
    expect(copied.has("cam1")).toBe(true);
    expect(copied.has("cam2")).toBe(true);
  });

  it("re-encodes a segment whose source frames fall between output frames", () => {
    const result = plan(cutProject(1.51), 360);
    const copied = new Set(result.segments.flatMap((s) => (s.kind === "copy" ? [s.mediaId] : [])));
    expect(copied.has("cam1")).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("not aligned"))).toBe(true);
  });
});

describe("render cache", () => {
  it("an angle switch invalidates exactly the switched span", () => {
    const project = cutProject(1.5);
    const sourceId = getMulticamSources(project)[0].id;
    const angleIds = getMulticamSources(project)[0].angles.map((a) => a.id);
    const cut = ok(recordMulticamCuts(project, { sourceId, endTime: 9, cuts: [{ time: 3, angleId: angleIds[0] }] }));
    const target = listMulticamClips(cut).find((r) => r.clip.startTime === 3)!;
    const switched = ok(switchMulticamAngle(cut, [target.clip.id], angleIds[1]));
    const result = planInvalidation(cut, switched);
    expect(result.all).toBe(false);
    expect(result.ranges.length).toBe(1);
    expect(result.ranges[0].start).toBeCloseTo(3, 6);
    expect(result.ranges[0].end).toBeCloseTo(6, 6);
  });
});
