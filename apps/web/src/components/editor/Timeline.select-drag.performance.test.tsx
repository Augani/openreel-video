import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Track } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { Timeline } from "./Timeline";

/**
 * Load-robust render-count smoke for the 400-clip project (CI `perf-smoke` job; the real-input
 * timing budgets live in apps/desktop/scripts/perf-budgets.json). Timings in jsdom on a shared
 * runner are meaningless, but how many ClipComponents re-render for one interaction is
 * deterministic: selecting one clip, moving the playhead or moving one clip must touch a handful
 * of clips, never the whole timeline (a one-clip move re-renders 1 of 288).
 */

const labelCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  // Called exactly once per ClipComponent render (see ClipComponent.tsx).
  return { ...actual, getMediaLabel: (...args: Parameters<typeof actual.getMediaLabel>) => { labelCalls.count++; return actual.getMediaLabel(...args); } };
});

const TRACKS = 8;
const CLIPS_PER_TRACK = 50;
const TOTAL = TRACKS * CLIPS_PER_TRACK;
const transform = { position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };

function buildTracks(): Track[] {
  return Array.from({ length: TRACKS }, (_, t) => {
    const id = `track-${t}`;
    const clips: Clip[] = Array.from({ length: CLIPS_PER_TRACK }, (_, c) => ({
      id: `clip-${t}-${c}`, mediaId: "m", trackId: id, startTime: c * 2, duration: 1.8, inPoint: 0, outPoint: 1.8,
      effects: [], audioEffects: [], keyframes: [], volume: 1, transform,
    }));
    return { id, name: `V${t}`, type: "video", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false } as Track;
  });
}

describe(`timeline render counts on a ${TOTAL}-clip project`, () => {
  beforeEach(() => {
    const project = createEmptyProject("Perf smoke");
    useProjectStore.setState({
      hasOpenProject: true,
      project: { ...project, timeline: { ...project.timeline, tracks: buildTracks() } },
      clipboard: [], copiedEffects: [], error: null,
    });
    useTimelineStore.setState({ playheadPosition: 0, playbackState: "stopped", viewportWidth: 1400 });
    useUIStore.getState().clearSelection();
  });
  afterEach(() => { cleanup(); });

  it("mounts every clip once, then a selection / playhead move / single-clip move re-renders only a few", async () => {
    const view = render(<Timeline />);
    const mounted = labelCalls.count;
    // Only clips inside the (overscanned) viewport mount; the rest are virtualized. Either way the
    // baseline below is what an interaction is compared to.
    expect(mounted).toBeGreaterThan(0);
    expect(mounted, "viewport virtualization keeps working").toBeLessThanOrEqual(TOTAL * 0.8);

    const delta = async (action: () => void | Promise<void>) => {
      const before = labelCalls.count;
      await act(async () => { await action(); });
      return labelCalls.count - before;
    };

    // Select one clip: at most the newly selected clip re-renders .
    const selected = await delta(() => useUIStore.getState().select({ type: "clip", id: "clip-0-1", trackId: "track-0" }));
    expect(selected, "selecting one clip").toBeLessThanOrEqual(2);

    // Select another: the old one deselects and the new one selects.
    const reselected = await delta(() => useUIStore.getState().select({ type: "clip", id: "clip-3-2", trackId: "track-3" }));
    expect(reselected, "moving the selection").toBeLessThanOrEqual(4);

    // Moving the playhead (playback tick) must not re-render clips at all.
    const playhead = await delta(() => useTimelineStore.getState().setPlayheadPosition(7.5));
    expect(playhead, "playhead move").toBe(0);

    // Moving one clip (what a drag commits): only that clip's lane's neighbours at most.
    const moved = await delta(() => useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks: state.project.timeline.tracks.map((track) => track.id !== "track-5" ? track : {
            ...track, clips: track.clips.map((clip) => clip.id === "clip-5-4" ? { ...clip, startTime: clip.startTime + 0.5 } : clip),
          }),
        },
      },
    })));
    console.info(`[render-counts] mounted=${mounted} select=${selected} reselect=${reselected} playhead=${playhead} moveOne=${moved}`);
    // A commit replaces the tracks array, but clips take cross-clip state as lane-computed
    // primitives (clip-lane-info.ts), so only the moved clip (plus any clip whose derived
    // state changed: none here) re-renders. O(changed), never O(mounted).
    expect(moved, "moving one clip").toBeLessThanOrEqual(2);
    view.unmount();
  });
});
