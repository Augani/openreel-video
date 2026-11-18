import { Profiler } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBenchProject } from "@openreel/core";
import { Timeline } from "../components/editor/Timeline";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { serializeProjectForAutoSave } from "../services/auto-save";

const counters = vi.hoisted(() => ({ clipRenders: 0 }));
vi.mock("../components/editor/timeline/ClipComponent", async () => {
  const actual = await vi.importActual<typeof import("../components/editor/timeline/ClipComponent")>(
    "../components/editor/timeline/ClipComponent",
  );
  const React = await import("react");
  const Inner = actual.ClipComponent as unknown as React.ComponentType<Record<string, unknown>>;
  // Counts parent-driven renders of every mounted clip (internal state renders excluded).
  const Counted = (props: Record<string, unknown>) => {
    counters.clipRenders += 1;
    return React.createElement(Inner, props);
  };
  return { ...actual, ClipComponent: Counted };
});

afterEach(() => cleanup());

function loadBenchProject() {
  const project = buildBenchProject();
  useProjectStore.setState({ project, hasOpenProject: true });
  useTimelineStore.setState({
    playheadPosition: 0, playbackState: "stopped", trackHeight: 62,
    trackHeights: {}, pixelsPerSecond: Number(process.env.BENCH_PPS ?? 20), viewportWidth: 1200,
  } as never);
  useUIStore.getState().clearSelection();
  return project;
}

describe("editor performance benchmark (8 tracks / 400 clips / 50 text)", () => {
  it("measures autosave serialization and hydrate", () => {
    const project = loadBenchProject();
    const t0 = performance.now();
    const json = serializeProjectForAutoSave(project);
    const serialize = performance.now() - t0;
    const t1 = performance.now();
    JSON.parse(json);
    const hydrate = performance.now() - t1;
    console.log(`[bench] autosave serialize ${serialize.toFixed(1)} ms, parse ${hydrate.toFixed(1)} ms, ${(json.length / 1024).toFixed(0)} KiB`);
    expect(json.length).toBeGreaterThan(0);
  });

  it("measures store edits end to end (action, history, project publish)", async () => {
    loadBenchProject();
    const store = useProjectStore.getState();
    const time = async (label: string, fn: (i: number) => Promise<unknown>, runs = 8) => {
      const samples: number[] = [];
      for (let i = 0; i < runs; i += 1) {
        const start = performance.now();
        const result = await fn(i) as { success?: boolean; error?: { message?: string } } | undefined; if (i === 0) console.log(`[bench] store ${label} first result`, JSON.stringify(result));
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      console.log(`[bench] store ${label}: median ${samples[Math.floor(runs / 2)].toFixed(1)} ms`);
    };
    await time("moveClip", (i) => store.moveClip("clip-3", 18 + i * 0.01));
    await time("splitClip", (i) => store.splitClip(`clip-${20 + i * 7}`, ((20 + i * 7) % 50) * 6 + 2.5));
    await time("removeClip", (i) => store.removeClip(`clip-${300 + i}`));
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(8);
  }, 120_000);

  it("measures timeline mount, mounted clip count and playhead-tick commits", () => {
    loadBenchProject();
    let commits = 0;
    const t0 = performance.now();
    const view = render(
      <Profiler id="timeline" onRender={() => { commits += 1; }}><Timeline /></Profiler>,
    );
    const mount = performance.now() - t0;
    const clips = view.container.querySelectorAll("[data-timeline-clip]").length;
    const canvases = view.container.querySelectorAll("canvas").length;
    commits = 0;
    counters.clipRenders = 0;
    const tickStart = performance.now();
    for (let i = 1; i <= 60; i += 1) {
      act(() => useTimelineStore.getState().setPlayheadPosition(i / 30));
    }
    const ticks = performance.now() - tickStart;
    console.log(`[bench] timeline mount ${mount.toFixed(0)} ms; mounted clips ${clips}/400; canvases ${canvases}; commits/60 ticks ${commits}; clip renders/60 ticks ${counters.clipRenders}; ${(ticks / 60).toFixed(2)} ms/tick`);
    const scrollStart = performance.now();
    commits = 0;
    counters.clipRenders = 0;
    for (let i = 1; i <= 10; i += 1) {
      act(() => useTimelineStore.getState().setScrollX?.(i * 200));
    }
    console.log(`[bench] 10 scroll steps ${(performance.now() - scrollStart).toFixed(0)} ms, commits ${commits}, clip renders ${counters.clipRenders}, mounted clips after ${view.container.querySelectorAll("[data-timeline-clip]").length}`);
    expect(clips).toBeGreaterThan(0);
  }, 120_000);
});
