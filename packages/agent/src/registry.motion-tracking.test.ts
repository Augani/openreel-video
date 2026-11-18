import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import type { MotionTrackBridge, MotionTrackSummary } from "./host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeEmptyProject } from "./test-fixtures";

const summary: MotionTrackSummary = {
  clipId: "c", frameRate: 30, frames: 90, firstFrame: 0, lastFrame: 89, lostFrames: 8, lowConfidence: [{ start: 30, end: 37, kind: "lost" }],
  manualFrames: [], framesPerSecond: 41, start: { frame: 0, x: 100, y: 80 }, end: { frame: 89, x: 300, y: 90 },
};

function hostWith(bridge?: Partial<MotionTrackBridge>) {
  const host = new HeadlessHost(makeEmptyProject());
  if (bridge) (host as unknown as { motionTracking: MotionTrackBridge }).motionTracking = bridge as MotionTrackBridge;
  return host;
}

describe("agent motion tracking tools", () => {
  it("registers track_motion, attach_track, correct_track_point and get_motion_track", () => {
    for (const name of ["track_motion", "attach_track", "correct_track_point", "get_motion_track"]) expect(getTool(name), name).toBeDefined();
    expect(getTool("get_motion_track")?.readOnly).toBe(true);
    expect(getTool("track_motion")?.expensive).toBe(true);
  });

  it("fails clearly on a host with no decoder", async () => {
    for (const [name, args] of [["track_motion", { clipId: "c" }], ["attach_track", { clipId: "c", targetId: "t" }], ["correct_track_point", { clipId: "c", frame: 1, x: 1, y: 1 }], ["get_motion_track", { clipId: "c" }]] as const) {
      const r = await executeTool(name, args, hostWith());
      expect(r.ok, name).toBe(false);
      expect(r.error?.code).toBe("UNSUPPORTED_HOST");
    }
  });

  it("track_motion validates input and forwards the request", async () => {
    const seen: unknown[] = [];
    const host = hostWith({ track: async (request) => { seen.push(request); return summary; } });
    expect((await executeTool("track_motion", { clipId: "c", region: { x: 1, y: 1, width: 0, height: 4 } }, host)).ok).toBe(false);
    expect((await executeTool("track_motion", { clipId: "c", anchorFrame: 1.5 }, host)).ok).toBe(false);
    expect((await executeTool("track_motion", { clipId: "c", direction: "sideways" }, host)).ok).toBe(false);
    expect((await executeTool("track_motion", { clipId: "c", confidenceThreshold: 2 }, host)).ok).toBe(false);
    const r = await executeTool("track_motion", { clipId: "c", region: { x: 10, y: 20, width: 30, height: 40 }, anchorFrame: 12, direction: "backward", merge: true }, host);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ lostFrames: 8 });
    expect(seen[0]).toMatchObject({ clipId: "c", anchorFrame: 12, direction: "backward", merge: true, region: { x: 10, y: 20, width: 30, height: 40 } });
  });

  it("track_motion reports a tracker failure as a tool error", async () => {
    const host = hostWith({ track: async () => { throw new Error("Choose a textured region with clear visual detail"); } });
    const r = await executeTool("track_motion", { clipId: "c" }, host);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/textured/);
  });

  it("attach_track and correct_track_point forward validated arguments", async () => {
    const calls: unknown[] = [];
    const host = hostWith({
      attach: async (request) => { calls.push(request); return { keyframes: 90 }; },
      correct: async (clipId, frame, position) => { calls.push([clipId, frame, position]); return summary; },
      summary: (clipId) => (clipId === "c" ? summary : null),
    });
    expect((await executeTool("attach_track", { clipId: "c", targetId: "t", mode: "glue" }, host)).ok).toBe(false);
    expect((await executeTool("attach_track", { clipId: "c", targetId: "t", smoothing: 99 }, host)).ok).toBe(false);
    expect((await executeTool("attach_track", { clipId: "c", targetId: "t", mode: "pin", offset: { x: 0, y: -40 }, applyScale: false }, host)).ok).toBe(true);
    expect((await executeTool("correct_track_point", { clipId: "c", frame: 33, x: 120, y: 85 }, host)).ok).toBe(true);
    expect((await executeTool("correct_track_point", { clipId: "c", frame: -1, x: 1, y: 1 }, host)).ok).toBe(false);
    expect(calls).toEqual([
      expect.objectContaining({ clipId: "c", targetId: "t", mode: "pin", offset: { x: 0, y: -40 }, applyScale: false }),
      ["c", 33, { x: 120, y: 85 }],
    ]);
    expect((await executeTool("get_motion_track", { clipId: "c" }, host)).data).toMatchObject({ frames: 90 });
    expect((await executeTool("get_motion_track", { clipId: "zzz" }, host)).data).toBeNull();
  });
});
