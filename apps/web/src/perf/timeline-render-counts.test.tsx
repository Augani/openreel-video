/**
 * Pins how many components the Timeline re-renders for common edits on a 320-clip,
 * 8-track project (render counts come from fibers, see test/render-hook). They are
 * load-independent, so unlike wall-clock budgets they can gate a change: an edit to
 * one clip must cost O(1) clip / header / transition components, not O(project).
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "../components/editor/Timeline";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { startRenderCounting, stopRenderCounting, type RenderSnapshot } from "../test/render-hook";
import { loadFixture } from "./timeline-fixture";

const store = () => useProjectStore.getState();
const count = (snap: RenderSnapshot, name: string) => snap.byComponent[name] ?? 0;

async function measure(work: () => Promise<void>): Promise<RenderSnapshot> {
  startRenderCounting();
  await work();
  return stopRenderCounting();
}

describe("timeline render counts", () => {
  beforeAll(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
  beforeEach(async () => {
    loadFixture();
    render(<Timeline />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });
  afterEach(cleanup);

  it("selecting a clip re-renders O(1) clips and no track headers or transition handles", async () => {
    const snap = await measure(() => act(async () => useUIStore.getState().select({ id: "clip-1-5", type: "clip" })));
    expect(count(snap, "ClipComponentImpl")).toBeLessThanOrEqual(2);
    // The selected clip's track header becomes the active one, nothing else.
    expect(count(snap, "TrackHeader2")).toBeLessThanOrEqual(2);
    expect(count(snap, "TransitionHandle2")).toBe(0);
  });

  it("moving the playhead only renders the playhead", async () => {
    const snap = await measure(async () => {
      for (let i = 0; i < 30; i++) await act(async () => useTimelineStore.getState().setPlayheadPosition(i));
    });
    expect(count(snap, "Playhead")).toBeLessThanOrEqual(30);
    for (const name of ["ClipComponentImpl", "TrackLane2", "TrackHeader2", "TransitionHandle2", "Timeline"]) {
      expect(count(snap, name)).toBe(0);
    }
    // The status bar's own timer may add a render or two; nothing scales with the project.
    expect(snap.total).toBeLessThanOrEqual(34);
  });

  it("one effect slider step re-renders only the edited clip, its header and no transition handles", async () => {
    const effect = await store().addVideoEffect("clip-0-4", "blur", { radius: 1 });
    const steps = 10;
    const snap = await measure(async () => {
      for (let i = 1; i <= steps; i++) {
        await act(async () => { await store().updateVideoEffect("clip-0-4", effect!.id, { radius: i }); });
      }
    });
    // Before: every cut's Radix dropdown (about 54 x 15 components) and all 8 headers per step.
    expect(count(snap, "ClipComponentImpl")).toBeLessThanOrEqual(steps * 2);
    expect(count(snap, "TrackHeader2")).toBeLessThanOrEqual(steps);
    expect(count(snap, "TransitionHandle2")).toBeLessThanOrEqual(steps * 2);
    // About 140 components per commit (toolbar, 8 lanes, the edited clip); it was ~1800 per step.
    expect(snap.total).toBeLessThan(steps * 350);
  });

  it("trimming one clip does not rebuild the other cuts or tracks", async () => {
    const snap = await measure(async () => {
      for (let i = 1; i <= 5; i++) await act(async () => { await store().trimClip("clip-2-6", 0, 3 - i * 0.1); });
    });
    expect(count(snap, "ClipComponentImpl")).toBeLessThanOrEqual(5 * 2);
    expect(count(snap, "TrackHeader2")).toBeLessThanOrEqual(5);
    expect(count(snap, "TransitionHandle2")).toBeLessThanOrEqual(5 * 2);
  });

  it("undo and redo re-render only what they change", async () => {
    await act(async () => { await store().trimClip("clip-3-2", 0, 2.5); });
    const snap = await measure(async () => {
      await act(async () => { await store().undo(); });
      await act(async () => { await store().redo(); });
    });
    expect(count(snap, "ClipComponentImpl")).toBeLessThanOrEqual(4);
    expect(count(snap, "TrackHeader2")).toBeLessThanOrEqual(2);
    expect(count(snap, "TransitionHandle2")).toBeLessThanOrEqual(4);
  });

  it("importing media does not re-render clips, headers or transition handles", async () => {
    const snap = await measure(() => act(async () => {
      useProjectStore.setState((s) => ({ project: { ...s.project, mediaLibrary: { items: [
        ...s.project.mediaLibrary.items,
        ...Array.from({ length: 20 }, (_, i) => ({ ...s.project.mediaLibrary.items[0], id: `imp-${i}`, name: `Import ${i}` })),
      ] } } }));
    }));
    expect(count(snap, "ClipComponentImpl")).toBe(0);
    expect(count(snap, "TrackHeader2")).toBe(0);
    expect(count(snap, "TransitionHandle2")).toBe(0);
  });

  it("keeps track and clip identity for what an edit did not touch", async () => {
    const before = store().project.timeline.tracks;
    await act(async () => { await store().updateVideoEffect("clip-0-3", (await store().addVideoEffect("clip-0-3", "blur", { radius: 1 }))!.id, { radius: 2 }); });
    const after = store().project.timeline.tracks;
    expect(after.slice(1).every((track, i) => track === before[i + 1])).toBe(true);
    expect(after[0].clips.filter((clip, i) => clip === before[0].clips[i]).length).toBe(before[0].clips.length - 1);
  });
});
