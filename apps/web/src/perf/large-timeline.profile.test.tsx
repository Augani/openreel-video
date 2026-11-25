/**
 * Profile of the real Timeline + InspectorPanel on a 1500-clip / 12-track project with keyframes. Reports, per
 * interaction, the median over RUNS runs of process CPU ms, wall ms, React commits and component renders.
 * PERF_PROFILE=1 prints the table (PERF_PROFILE_OUT=path writes JSON); without it each scenario runs once as a smoke test.
 */
import { act, cleanup, render } from "@testing-library/react";
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
const TRACKS = 12;
const PER_TRACK = 125;
const results: Record<string, InteractionSample[]> = {};

const store = () => useProjectStore.getState();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const clipId = (track: number, index: number) => `clip-${track}-${index}`;

interface Scenario {
  name: string;
  setup?: () => Promise<void> | void;
  run: () => Promise<void> | void;
}

const scenarios: Scenario[] = [
  { name: "mount", run: () => undefined },
  { name: "scrollSweep", run: async () => {
    for (let i = 1; i <= 40; i++) await act(async () => useTimelineStore.getState().setScrollX(i * 150));
  } },
  { name: "zoomSweep", run: async () => {
    for (const z of [50, 60, 80, 60, 40, 30, 50, 40]) await act(async () => useTimelineStore.getState().setZoom(z));
  } },
  { name: "playhead60", run: async () => {
    for (let i = 0; i < 60; i++) await act(async () => useTimelineStore.getState().setPlayheadPosition(i / 30));
  } },
  { name: "selectBurst", run: async () => {
    for (let i = 0; i < 10; i++) await act(async () => useUIStore.getState().select({ id: clipId(i % 8, 2 + i), type: "clip" }));
  } },
  { name: "selectAll", run: async () => {
    const items = store().project.timeline.tracks.flatMap((t) => t.clips.map((c) => ({ id: c.id, type: "clip" as const })));
    await act(async () => useUIStore.getState().selectMultiple(items));
  } },
  { name: "dragClip", setup: () => { useUIStore.getState().select({ id: clipId(0, 4), type: "clip" }); },
    run: async () => {
      store().beginHistoryGroup("Move clips");
      for (let i = 1; i <= 15; i++) {
        await act(async () => { await store().moveClips([{ clipId: clipId(0, 4), startTime: 12 + i * 0.1 }], { coalesceKey: "drag" }); });
      }
      store().endHistoryGroup();
    } },
  { name: "trim", run: async () => {
    for (let i = 1; i <= 10; i++) await act(async () => { await store().trimClip(clipId(2, 6), 0, 3 - i * 0.05); });
  } },
  { name: "rippleDelete200", setup: async () => {
    for (const track of store().project.timeline.tracks) await store().setTrackSyncLock(track.id, false);
  }, run: async () => {
    const ids = store().project.timeline.tracks.slice(0, 4).flatMap((t) => t.clips.slice(10, 60).map((c) => c.id));
    let result: { success: boolean } = { success: false };
    await act(async () => { result = await store().rippleDeleteClips(ids); });
    expect(result.success).toBe(true);
  } },
  { name: "rippleDelete200+undo", setup: async () => {
    for (const track of store().project.timeline.tracks) await store().setTrackSyncLock(track.id, false);
    const ids = store().project.timeline.tracks.slice(0, 4).flatMap((t) => t.clips.slice(10, 60).map((c) => c.id));
    await act(async () => { await store().rippleDeleteClips(ids); });
  }, run: async () => {
    await act(async () => { await store().undo(); });
    const count = store().project.timeline.tracks.reduce((n, t) => n + t.clips.length, 0);
    expect(count).toBe(TRACKS * PER_TRACK);
  } },
];

describe("large timeline profile (12 tracks / 1500 clips / keyframes)", () => {
  beforeAll(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterAll(() => {
    if (PROFILE) {
      const rows = Object.entries(results).map(([name, samples]) => ({
        name,
        cpuMs: +median(samples.map((s) => s.cpuMs)).toFixed(1),
        wallMs: +median(samples.map((s) => s.wallMs)).toFixed(1),
        commits: median(samples.map((s) => s.commits)),
        renders: median(samples.map((s) => s.renders)),
        top: topComponents(samples),
      }));
      console.log(`\nPERF_TABLE load=${loadavg()[0].toFixed(1)} runs=${RUNS}\n${rows.map((r) =>
        `${r.name.padEnd(22)} cpu=${String(r.cpuMs).padStart(8)}ms wall=${String(r.wallMs).padStart(8)}ms commits=${String(r.commits).padStart(4)} renders=${String(r.renders).padStart(6)}  ${r.top.map(([k, v]) => `${k}:${v}`).join(" ")}`).join("\n")}`);
      if (process.env.PERF_PROFILE_OUT) writeFileSync(process.env.PERF_PROFILE_OUT, JSON.stringify({ load: loadavg(), runs: RUNS, rows }, null, 2));
    }
  });

  for (const scenario of scenarios) {
    it(`profiles ${scenario.name}`, async () => {
      results[scenario.name] = [];
      for (let run = 0; run < RUNS; run++) {
        loadFixture({ tracks: TRACKS, clipsPerTrack: PER_TRACK });
        if (scenario.name === "mount") {
          results.mount.push(await sample(async () => { render(<><Timeline /><InspectorPanel /></>); await flush(); }));
          cleanup();
          continue;
        }
        render(<><Timeline /><InspectorPanel /></>);
        await flush();
        await scenario.setup?.();
        await flush();
        results[scenario.name].push(await sample(() => scenario.run()));
        cleanup();
      }
      expect(results[scenario.name].length).toBe(RUNS);
    }, 300_000);
  }
});
