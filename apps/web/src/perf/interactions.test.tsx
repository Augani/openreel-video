/**
 * Load-robust interaction profile of the real Timeline + InspectorPanel on a
 * 320-clip / 8-track project. Reports per interaction the median of RUNS runs of
 * process CPU ms, React commits and component renders (counted from fibers, see
 * test/render-hook). Set PERF_PROFILE=1 to print the table (and PERF_PROFILE_OUT=path
 * to write JSON). Without it the file runs one cheap pass as a smoke test.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Timeline } from "../components/editor/Timeline";
import { InspectorPanel } from "../components/editor/InspectorPanel";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { loadFixture } from "./timeline-fixture";
import { median, sample, topComponents, type InteractionSample } from "./interaction-profile";

const PROFILE = process.env.PERF_PROFILE === "1";
const RUNS = PROFILE ? Number(process.env.PERF_RUNS ?? 5) : 1;
const results: Record<string, InteractionSample[]> = {};

const store = () => useProjectStore.getState();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

interface Scenario {
  name: string;
  setup?: () => Promise<void> | void;
  run: (ctx: { run: number }) => Promise<void> | void;
}

const scenarios: Scenario[] = [
  { name: "clipSelect", run: async ({ run }) => {
    await act(async () => useUIStore.getState().select({ id: `clip-1-${4 + (run % 3)}`, type: "clip" }));
  } },
  { name: "clipSelectBurst", run: async () => {
    for (let i = 0; i < 10; i++) await act(async () => useUIStore.getState().select({ id: `clip-${i % 3}-${i}`, type: "clip" }));
  } },
  { name: "dragClip", setup: () => { useUIStore.getState().select({ id: "clip-0-4", type: "clip" }); },
    run: async () => {
      store().beginHistoryGroup("Move clips");
      for (let i = 1; i <= 15; i++) {
        await act(async () => { await store().moveClips([{ clipId: "clip-0-4", startTime: 12 + i * 0.1 }], { coalesceKey: "drag" }); });
      }
      store().endHistoryGroup();
    } },
  { name: "trim", run: async () => {
    for (let i = 1; i <= 10; i++) await act(async () => { await store().trimClip("clip-2-6", 0, 3 - i * 0.05); });
  } },
  { name: "rippleDelete", setup: async () => {
    // Sync Lock would refuse the edit across tracks; this scenario measures the ripple itself.
    for (const track of store().project.timeline.tracks) await store().setTrackSyncLock(track.id, false);
  }, run: async () => {
    let result: { success: boolean } = { success: false };
    await act(async () => { result = await store().rippleDeleteClip("clip-1-3"); });
    expect(result.success).toBe(true);
  } },
  { name: "scrub", run: async () => {
    for (let i = 0; i < 60; i++) await act(async () => useTimelineStore.getState().setPlayheadPosition(i * 0.7));
  } },
  { name: "play10s", run: async () => {
    // 10 s at 30 UI updates per second.
    for (let i = 0; i < 300; i++) await act(async () => useTimelineStore.getState().setPlayheadPosition(5 + i / 30));
  } },
  { name: "zoom", run: async () => {
    for (const z of [50, 60, 80, 60, 40, 30]) await act(async () => useTimelineStore.getState().setZoom(z));
  } },
  { name: "inspectorTabs", setup: () => { useUIStore.getState().select({ id: "clip-0-3", type: "clip" }); },
    run: async () => {
      for (const name of ["Effects", "Audio", "Video", "Effects", "Video", "Audio"]) {
        const tab = screen.queryByRole("tab", { name });
        if (tab) { fireEvent.mouseDown(tab, { button: 0, ctrlKey: false }); await flush(); }
      }
    } },
  { name: "effectSlider", setup: async () => { useUIStore.getState().select({ id: "clip-0-4", type: "clip" }); },
    run: async () => {
      let fx: { id: string } | null = null;
      await act(async () => { fx = await store().addVideoEffect("clip-0-4", "blur", { radius: 1 }); });
      for (let i = 1; i <= 20; i++) {
        await act(async () => { await store().updateVideoEffect("clip-0-4", fx!.id, { radius: i }); });
      }
    } },
  { name: "undoRedoBurst", run: async () => {
    for (let i = 0; i < 6; i++) await act(async () => { await store().undo(); });
    for (let i = 0; i < 6; i++) await act(async () => { await store().redo(); });
  } },
  { name: "import20", run: async () => {
    await act(async () => {
      useProjectStore.setState((s) => ({ project: { ...s.project, mediaLibrary: { items: [
        ...s.project.mediaLibrary.items,
        ...Array.from({ length: 20 }, (_, i) => ({ ...s.project.mediaLibrary.items[0], id: `imp-${Date.now()}-${i}`, name: `Import ${i}` })),
      ] } } }));
    });
  } },
];

describe("timeline interaction profile", () => {
  beforeAll(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterAll(() => {
    if (PROFILE) {
      const rows = Object.entries(results).map(([name, samples]) => ({
        name,
        cpuMs: +median(samples.map((s) => s.cpuMs)).toFixed(1),
        commits: median(samples.map((s) => s.commits)),
        renders: median(samples.map((s) => s.renders)),
        top: topComponents(samples),
      }));
      console.log(`\nPERF_TABLE load=${(loadavg()[0]).toFixed(1)} runs=${RUNS}\n${rows.map((r) =>
        `${r.name.padEnd(16)} cpu=${String(r.cpuMs).padStart(8)}ms commits=${String(r.commits).padStart(4)} renders=${String(r.renders).padStart(6)}  ${r.top.map(([k, v]) => `${k}:${v}`).join(" ")}`).join("\n")}`);
      if (process.env.PERF_PROFILE_OUT) writeFileSync(process.env.PERF_PROFILE_OUT, JSON.stringify({ load: loadavg(), runs: RUNS, rows }, null, 2));
    }
  });

  for (const scenario of scenarios) {
    it(`profiles ${scenario.name}`, async () => {
      results[scenario.name] = [];
      for (let run = 0; run < RUNS; run++) {
        loadFixture();
        render(<><Timeline /><InspectorPanel /></>);
        await flush();
        await scenario.setup?.();
        await flush();
        results[scenario.name].push(await sample(() => scenario.run({ run })));
        cleanup();
      }
      expect(results[scenario.name].length).toBe(RUNS);
    });
  }
});
