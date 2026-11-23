import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import { buildRenderStatusSegments } from "./render-status";
import { clipTouchedReason } from "../export/smart-render";

function project(clip: Record<string, unknown>): Project {
  return {
    id: "p", name: "T", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [{ id: "m1", name: "a.mp4", type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 10, width: 1920, height: 1080, frameRate: 25, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 } }] },
    timeline: {
      duration: 8, subtitles: [], markers: [],
      tracks: [{ id: "t1", type: "video", name: "V1", locked: false, hidden: false, muted: false, solo: false, transitions: [],
        clips: [{ id: "c1", trackId: "t1", mediaId: "m1", startTime: 0, duration: 8, inPoint: 0, outPoint: 2, effects: [], audioEffects: [], keyframes: [], volume: 1, speed: 0.25,
          transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 }, ...clip }] }],
    },
  } as unknown as Project;
}
const segment = (p: Project) => buildRenderStatusSegments(p, { cachedRuns: [] })[0];

describe("render status for Time Interpolation", () => {
  it("marks optical flow heavy (red) and names it, frame blending light, frame sampling plain retime", () => {
    const flow = segment(project({ timeInterpolation: "opticalFlow" }));
    expect(flow.level).toBe("heavy");
    expect(flow.reasons).toContain("optical flow");
    const blend = segment(project({ timeInterpolation: "frameBlending" }));
    expect(blend.level).toBe("light");
    expect(blend.reasons).toContain("frame blending");
    expect(segment(project({})).reasons).not.toContain("optical flow");
  });
  it("treats a project saved with legacy Smooth Slow Motion as optical flow", () => {
    expect(segment(project({ smoothSlowMo: true })).reasons).toContain("optical flow");
  });
  it("a cached render turns it green", () => {
    const [seg] = buildRenderStatusSegments(project({ timeInterpolation: "opticalFlow" }), { cachedRuns: [{ start: 0, end: 239 }] });
    expect(seg.level).toBe("cached");
  });
});

describe("smart render", () => {
  it("re-encodes a clip with frame blending or optical flow even at normal speed", () => {
    const p = project({ speed: 1, timeInterpolation: "frameBlending" });
    expect(clipTouchedReason(p, p.timeline.tracks[0].clips[0])).toBe("time interpolation");
    const q = project({ speed: 1 });
    expect(clipTouchedReason(q, q.timeline.tracks[0].clips[0])).toBeNull();
  });
});
