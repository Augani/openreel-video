import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeProjectWithClip } from "./test-fixtures";
import type { Project } from "@openreel/core/types/project";

function clipEffects(project: Project): ReadonlyArray<{
  readonly id: string;
  readonly type: string;
  readonly params: Record<string, unknown>;
}> {
  const track = project.timeline.tracks.find((t) => t.type === "video");
  const clip = track?.clips.find((c) => c.id === "c1");
  return (clip?.effects ?? []) as ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly params: Record<string, unknown>;
  }>;
}

describe("add_video_effect shader validation", () => {
  it("adds a shader effect with a valid effect-category shaderId", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool(
      "add_video_effect",
      {
        clipId: "c1",
        effectType: "shader",
        params: { shaderId: "paper-halftone-dots", size: 0.6 },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const effects = clipEffects(host.getProject());
    expect(effects.length).toBe(1);
    expect(effects[0]?.type).toBe("shader");
    expect(effects[0]?.params.shaderId).toBe("paper-halftone-dots");
  });

  it("rejects a shader effect with no shaderId", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool(
      "add_video_effect",
      { clipId: "c1", effectType: "shader", params: {} },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
    expect(clipEffects(host.getProject()).length).toBe(0);
  });

  it("rejects a shader effect with an unknown shaderId", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool(
      "add_video_effect",
      {
        clipId: "c1",
        effectType: "shader",
        params: { shaderId: "paper-not-real" },
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
    expect(clipEffects(host.getProject()).length).toBe(0);
  });

  it("rejects a shader effect that targets a fill-category shader", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool(
      "add_video_effect",
      {
        clipId: "c1",
        effectType: "shader",
        params: { shaderId: "paper-mesh-gradient" },
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("still adds a standard non-shader effect without shaderId", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool(
      "add_video_effect",
      { clipId: "c1", effectType: "brightness", params: { value: 0.2 } },
      host,
    );
    expect(res.ok).toBe(true);
    const effects = clipEffects(host.getProject());
    expect(effects.length).toBe(1);
    expect(effects[0]?.type).toBe("brightness");
  });
});
