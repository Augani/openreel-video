import { describe, it, expect } from "vitest";
import { ActionExecutor } from "./action-executor";
import {
  registerActionHandler,
  getActionHandler,
  listRegisteredActionTypes,
} from "./registry";
import type { Project } from "../types/project";

function makeProject(): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: { duration: 0, tracks: [], subtitles: [], markers: [] },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

describe("action registry", () => {
  it("registers and resolves a handler", () => {
    registerActionHandler({
      type: "test/noop",
      apply: () => {},
      validate: () => ({ valid: true, errors: [] }),
      invert: () => null,
    });
    expect(getActionHandler("test/noop")?.type).toBe("test/noop");
    expect(listRegisteredActionTypes()).toContain("test/noop");
  });

  it("routes a registered action through the executor", async () => {
    let applied = false;
    registerActionHandler({
      type: "test/flag",
      apply: (_action, project) => {
        (project as unknown as Record<string, unknown>).__flag = true;
        applied = true;
      },
      validate: () => ({ valid: true, errors: [] }),
      invert: (action) => ({
        type: "test/flag",
        id: `inv-${action.id}`,
        timestamp: Date.now(),
        params: {},
      }),
    });
    const executor = new ActionExecutor();
    const project = makeProject();

    const result = await executor.execute(
      { type: "test/flag", id: "t1", timestamp: Date.now(), params: {} },
      project,
    );

    expect(result.success).toBe(true);
    expect(applied).toBe(true);
    expect((project as unknown as Record<string, unknown>).__flag).toBe(true);
  });

  it("rejects a registered action whose validate fails", async () => {
    registerActionHandler({
      type: "test/invalid",
      apply: () => {},
      validate: () => ({
        valid: false,
        errors: [{ code: "INVALID_PARAMS", message: "nope" }],
      }),
      invert: () => null,
    });
    const executor = new ActionExecutor();
    const project = makeProject();

    const result = await executor.execute(
      { type: "test/invalid", id: "t1", timestamp: Date.now(), params: {} },
      project,
    );

    expect(result.success).toBe(false);
  });

  it("leaves unregistered actions on the legacy path", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    const result = await executor.execute(
      {
        type: "track/add",
        id: "t2",
        timestamp: Date.now(),
        params: { trackType: "video" },
      },
      project,
    );

    expect(result.success).toBe(true);
    expect(project.timeline.tracks).toHaveLength(1);
  });
});
