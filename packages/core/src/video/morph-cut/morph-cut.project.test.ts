import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import { ProjectSerializer } from "../../storage/project-serializer";
import type { Project } from "../../types/project";
import type { Clip } from "../../types/timeline";
import { getMorphCutRegistry } from "./registry";

/** Morph Cut as project data: it is applied, undone, redone, saved and reloaded like any other transition. */
const blob = new Blob(["v"]);
const clip = (id: string, startTime: number, inPoint: number): Clip =>
  ({
    id,
    mediaId: "m1",
    trackId: "v1",
    startTime,
    duration: 2,
    inPoint,
    outPoint: inPoint + 2,
    effects: [],
    audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    volume: 1,
    keyframes: [],
  }) as unknown as Clip;

function project(): Project {
  return {
    id: "mc-project",
    name: "Morph",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1280, height: 720, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [{ id: "m1", name: "talk.mp4", type: "video", blob, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 10, width: 1280, height: 720, frameRate: 30, codec: "avc", sampleRate: 48000, channels: 2, fileSize: 1 } }] },
    timeline: { duration: 4, subtitles: [], markers: [], tracks: [{ id: "v1", type: "video", name: "V1", clips: [clip("a", 0, 0), clip("b", 2, 5)], transitions: [], locked: false, hidden: false, muted: false, solo: false }] },
  } as unknown as Project;
}

const add = (params: Record<string, unknown> = {}) => ({ id: "act-1", type: "transition/add" as const, timestamp: 1, params: { clipAId: "a", clipBId: "b", transitionType: "morphCut", duration: 0.5, params } });

describe("Morph Cut project data", () => {
  it("adds, updates, undoes and redoes with its settings", async () => {
    const p = project();
    const executor = new ActionExecutor();
    expect((await executor.execute(add({ quality: "high" }) as never, p)).success).toBe(true);
    const tr = () => p.timeline.tracks[0]!.transitions;
    expect(tr()).toHaveLength(1);
    expect(tr()[0]).toMatchObject({ type: "morphCut", duration: 0.5, clipAId: "a", clipBId: "b" });
    expect(tr()[0]!.params).toMatchObject({ quality: "high" });
    const id = tr()[0]!.id;
    expect((await executor.execute({ id: "act-2", type: "transition/update", timestamp: 2, params: { transitionId: id, params: { quality: "low", alignment: "end" }, duration: 0.8 } } as never, p)).success).toBe(true);
    expect(tr()[0]).toMatchObject({ duration: 0.8, params: { quality: "low", alignment: "end" } });
    await executor.undo(p);
    expect(tr()[0]).toMatchObject({ duration: 0.5, params: { quality: "high" } });
    await executor.undo(p);
    expect(tr()).toHaveLength(0);
    await executor.redo(p);
    await executor.redo(p);
    expect(tr()[0]).toMatchObject({ type: "morphCut", duration: 0.8, params: { quality: "low", alignment: "end" } });
  });

  it("rejects an unknown analysis detail and needs a second clip", async () => {
    const p = project();
    const executor = new ActionExecutor();
    expect((await executor.execute(add({ quality: "ultra" }) as never, p)).success).toBe(false);
    const edge = { ...add(), params: { clipAId: "a", transitionType: "morphCut", duration: 0.5, params: {} } };
    expect((await executor.execute(edge as never, p)).success).toBe(false);
    expect(p.timeline.tracks[0]!.transitions).toHaveLength(0);
  });

  it("survives save and reload; the analysis is not stored, so a reloaded project starts idle and renders as a dissolve until it is analysed again", async () => {
    const p = project();
    const executor = new ActionExecutor();
    await executor.execute(add({ quality: "medium" }) as never, p);
    const id = p.timeline.tracks[0]!.transitions[0]!.id;
    const registry = getMorphCutRegistry();
    registry.setState(id, { status: "ready", progress: 1, message: "" });
    const serializer = new ProjectSerializer({} as never);
    const json = serializer.exportToJson(p);
    expect(json).not.toContain("analysing");
    expect(json).not.toContain('"field"');
    const restored = serializer.importFromJson(json);
    expect(restored.timeline.tracks[0]!.transitions[0]).toMatchObject({ id, type: "morphCut", duration: 0.5, clipAId: "a", clipBId: "b", params: { quality: "medium" } });
    registry.clear();
    expect(registry.getState(id).status).toBe("idle");
    expect(registry.resolve(id)).toBeNull();
  });
});
