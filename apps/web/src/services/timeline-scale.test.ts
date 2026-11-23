import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { planClipSpeedEdit, planRippleDelete, type Clip, type Track } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { commit } from "./premiere-edit-commands";
import { getLinkedTimelineSelection } from "../utils/linked-timeline-selection";

const state = () => useProjectStore.getState();
const clip = (id: string, trackId: string, start: number): Clip => ({
  id, trackId, mediaId: "source", startTime: start, duration: 2, inPoint: 0, outPoint: 2, speed: 1, volume: 1,
  ...(trackId === "a1" ? { metadata: { separatedFromClipId: `v1-${id.split("-")[1]}` } } : {}),
  effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } },
});
function load(count: number) {
  state().createNewProject("Scale");
  const project = state().project;
  const tracks: Track[] = ["v1", "a1"].map((id) => ({
    id, name: id, type: id === "v1" ? "video" : "audio",
    clips: Array.from({ length: count }, (_, i) => clip(`${id}-${i}`, id, i * 2)),
    transitions: [], locked: false, hidden: false, muted: false, solo: false,
  }));
  useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks, duration: count * 2 },
    mediaLibrary: { items: [{ id: "source", type: "video", name: "Source.mp4", blob: null, fileHandle: null,
      waveformData: null, thumbnailUrl: null, metadata: { duration: count * 2 + 10, width: 640, height: 360, frameRate: 30,
        codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 } }] } } });
  state().actionHistory.clear();
}
const ms = (fn: () => void) => { const t = performance.now(); fn(); return performance.now() - t; };
/**
 * Loose sanity bound only: ~100 ms standalone for the 2000-clip ripple speed, but a full parallel suite on a busy
 * machine measured up to 2 s. The tight quadratic-regression guard is the 4000-clip core benchmark.
 */
const BOUND_MS = 4000;

describe("linked selection at scale", () => {
  it("expands 1000 selected pictures to their 1000 linked audio clips quickly", () => {
    load(1000);
    const project = state().getFullProject();
    const pictures = project.timeline.tracks[0].clips.map((c) => c.id);
    let ids: string[] = [];
    const took = ms(() => { ids = getLinkedTimelineSelection(project, pictures, true); });
    console.log(`BENCH linked selection 1000 -> ${ids.length}: ${took.toFixed(0)} ms`);
    expect(ids).toHaveLength(2000);
    expect(took).toBeLessThan(BOUND_MS);
  });
});

describe("store-level timeline action time, 1000-clip sequence", () => {
  beforeEach(() => load(1000));
  it("ripple speed of all 2000 clips is one undo step and finishes quickly", async () => {
    const ids = state().project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id));
    let outcome!: ReturnType<typeof commit>;
    const took = ms(() => { outcome = commit((p) => planClipSpeedEdit(p, ids, { speed: 2 }, { ripple: true }, "op"), "none"); });
    console.log(`BENCH store ripple-speed 2000 clips: ${took.toFixed(0)} ms`);
    expect(outcome.success, outcome.message).toBe(true);
    expect(state().project.timeline.tracks[0].clips[999].startTime).toBeCloseTo(999, 6);
    expect(took).toBeLessThan(BOUND_MS);
    await state().undo();
    expect(state().project.timeline.tracks[0].clips[999].startTime).toBe(1998);
    expect(state().canUndo()).toBe(false);
  });
  it("ripple delete of every other clip is one undo step and finishes quickly", async () => {
    const ids = state().project.timeline.tracks.flatMap((t) => t.clips.filter((_, i) => i % 2 === 0).map((c) => c.id));
    let outcome!: ReturnType<typeof commit>;
    const took = ms(() => { outcome = commit((p) => planRippleDelete(p, ids, "op"), "none"); });
    console.log(`BENCH store ripple-delete 1000 of 2000 clips: ${took.toFixed(0)} ms`);
    expect(outcome.success, outcome.message).toBe(true);
    expect(state().project.timeline.tracks[0].clips).toHaveLength(500);
    expect(took).toBeLessThan(BOUND_MS);
    await state().undo();
    expect(state().project.timeline.tracks[0].clips).toHaveLength(1000);
  });
});
