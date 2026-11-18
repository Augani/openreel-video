import { describe, it, expect } from "vitest";
import { ActionExecutor } from "../action-executor";
import type { Project } from "../../types/project";
import type { Action } from "../../types/actions";
import { makeOverlayHandlers } from "./overlay";

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

  it("removes newly introduced optional fields on Undo and restores them on Redo", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(act("text/create", { clip: textClip("x1", "hi") }), project);
    const prior = structuredClone(textClips(project)[0]);
    const text3d = { enabled: true, depth: 12 };
    await executor.execute(act("text/update", { clipId: "x1", updates: { text3d } }), project);
    expect(textClips(project)[0]).toHaveProperty("text3d", text3d);
    await executor.undo(project);
    expect(textClips(project)[0]).toEqual(prior);
    expect(textClips(project)[0]).not.toHaveProperty("text3d");
    await executor.redo(project);
    expect(textClips(project)[0]).toHaveProperty("text3d", text3d);
  });

  it("text/update rejects an unknown clip", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const res = await executor.execute(act("text/update", { clipId: "nope", updates: {} }), project);
    expect(res.success).toBe(false);
  });

  it.each([
    ["text", "textClips"], ["shape", "shapeClips"], ["svg", "svgClips"], ["sticker", "stickerClips"],
  ] as const)("%s inverse preserves field removal through JSON serialization", (prefix, field) => {
    const [create, update] = makeOverlayHandlers(prefix, field);
    const project = makeProject();
    const prior = textClip("overlay", "Original");
    const context = { lastAddedIds: new Map<string, string>() };
    create.apply(act(`${prefix}/create`, { clip: prior }), project, context);
    const action = act(`${prefix}/update`, { clipId: prior.id, updates: { metadata: { source: "new" } } });
    const inverse = JSON.parse(JSON.stringify(update.invert(action, project)));
    update.apply(action, project, context);
    expect(update.validate(inverse, project).valid).toBe(true);
    update.apply(inverse, project, context);
    expect((project as unknown as Record<string, unknown>)[field]).toEqual([prior]);
  });

  it("rejects removal of the stable clip id", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(act("text/create", { clip: textClip("x1", "hi") }), project);
    const result = await executor.execute(act("text/update", { clipId: "x1", updates: {}, unset: ["id"] }), project);
    expect(result.success).toBe(false);
    expect(textClips(project)[0].id).toBe("x1");
  });
});
