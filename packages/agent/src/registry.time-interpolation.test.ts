import { describe, expect, it } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import type { Project } from "@openreel/core/types/project";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { toMcpTools } from "./registry";
import { makeEmptyProject } from "./test-fixtures";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, mediaId: string, trackId: string) => ({ id, mediaId, trackId, startTime: 0, duration: 8, inPoint: 0, outPoint: 2, speed: 0.25, effects: [], audioEffects: [], keyframes: [], volume: 1, transform });

function project(): Project {
  const base = makeEmptyProject();
  return {
    ...base,
    mediaLibrary: { items: [
      { id: "vid", name: "a.mp4", type: "video", blob: null, metadata: { duration: 20, width: 1920, height: 1080, frameRate: 25, sampleRate: 48000 } },
      { id: "aud", name: "a.wav", type: "audio", blob: null, metadata: { duration: 20, width: 0, height: 0, frameRate: 0, sampleRate: 48000, channels: 2 } },
    ] },
    timeline: { ...base.timeline, tracks: [
      { id: "v1", type: "video", name: "Main", clips: [clip("c1", "vid", "v1")], transitions: [], locked: false, hidden: false, muted: false, solo: false },
      { id: "a1", type: "audio", name: "A1", clips: [clip("c2", "aud", "a1")], transitions: [], locked: false, hidden: false, muted: false, solo: false },
    ] },
  } as unknown as Project;
}

describe("time interpolation tools", () => {
  it("is listed in the model-visible tools", () => {
    const names = toMcpTools().map((tool) => tool.name);
    expect(names).toContain("set_clip_time_interpolation");
    expect(names).toContain("get_clip_time_interpolation");
  });

  it("sets mode and quality and reads them back", async () => {
    const history = new ActionHistory();
    const host = new HeadlessHost(project(), { history });
    const set = await executeTool("set_clip_time_interpolation", { clipId: "c1", mode: "opticalFlow", quality: "high" }, host);
    expect(set.ok).toBe(true);
    const got = await executeTool("get_clip_time_interpolation", { clipId: "c1" }, host);
    expect(got.data).toMatchObject({ mode: "opticalFlow", quality: "high", speed: 0.25 });
    const clipNow = host.getProject().timeline.tracks[0].clips[0];
    expect(clipNow.timeInterpolation).toBe("opticalFlow");
    expect(clipNow.interpolationQuality).toBe("high");
  });

  it("rejects an unknown mode, a missing clip and audio clips", async () => {
    const host = new HeadlessHost(project(), { history: new ActionHistory() });
    expect((await executeTool("set_clip_time_interpolation", { clipId: "c1", mode: "magic" }, host)).ok).toBe(false);
    expect((await executeTool("set_clip_time_interpolation", { clipId: "nope", mode: "opticalFlow" }, host)).ok).toBe(false);
    expect((await executeTool("set_clip_time_interpolation", { clipId: "c2", mode: "opticalFlow" }, host)).ok).toBe(false);
    expect((await executeTool("set_clip_time_interpolation", { mode: "opticalFlow" }, host)).ok).toBe(false);
  });
});
