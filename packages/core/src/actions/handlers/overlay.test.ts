import { describe, it, expect } from "vitest";
import { ActionExecutor } from "../action-executor";
import type { Project } from "../../types/project";
import type { Action } from "../../types/actions";

function makeProject(): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: 0,
      markers: [],
      subtitles: [],
      tracks: [
        { id: "tt", type: "text", name: "Text", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false },
      ],
    },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

const act = (type: string, params: Record<string, unknown>): Action => ({
  type,
  id: `a-${type}`,
  timestamp: Date.now(),
  params,
});

const textClips = (p: Project) =>
  (p as unknown as { textClips?: Array<{ id: string; text: string }> }).textClips ?? [];

function textClip(id: string, text: string) {
  return {
    id,
    trackId: "tt",
    startTime: 0,
    duration: 3,
    text,
    style: {},
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    keyframes: [],
  };
}

describe("overlay handlers (project-authoritative)", () => {
  it("text/create appends to project.textClips and undoes", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(act("text/create", { clip: textClip("x1", "hi") }), project);
    expect(textClips(project)).toHaveLength(1);
    expect(textClips(project)[0].text).toBe("hi");
    await executor.undo(project);
    expect(textClips(project)).toHaveLength(0);
  });

  it("text/update merges fields and undoes to the prior value", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(act("text/create", { clip: textClip("x1", "hi") }), project);
    await executor.execute(act("text/update", { clipId: "x1", updates: { text: "bye" } }), project);
    expect(textClips(project)[0].text).toBe("bye");
    await executor.undo(project);
    expect(textClips(project)[0].text).toBe("hi");
  });

  it("text/remove deletes and undo restores the clip", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(act("text/create", { clip: textClip("x1", "hi") }), project);
    await executor.execute(act("text/remove", { clipId: "x1" }), project);
    expect(textClips(project)).toHaveLength(0);
    await executor.undo(project);
    expect(textClips(project)).toHaveLength(1);
    expect(textClips(project)[0].id).toBe("x1");
  });

  it("text/update rejects an unknown clip", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const res = await executor.execute(act("text/update", { clipId: "nope", updates: {} }), project);
    expect(res.success).toBe(false);
  });

  it("shape/create works through the same factory", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(
      act("shape/create", { clip: { id: "s1", type: "shape", trackId: "tt", startTime: 0, duration: 2, transform: {}, keyframes: [], shapeType: "rectangle", style: {} } }),
      project,
    );
    const shapes = (project as unknown as { shapeClips?: unknown[] }).shapeClips ?? [];
    expect(shapes).toHaveLength(1);
  });
});
