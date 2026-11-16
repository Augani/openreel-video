import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { analyzeTrace } from "../scripts/perf-trace.mjs";

const PID = 10;
const TID = 1;
const at = (name: string, ts: number, tts: number, extra: Record<string, unknown> = {}) => ({ name, ph: "I", pid: PID, tid: TID, ts, tts, ...extra });
const span = (name: string, ts: number, dur: number, tdur: number, args: Record<string, unknown> = {}) => ({ name, ph: "X", pid: PID, tid: TID, ts, dur, tdur, tts: Math.round(ts * 0.6), args });

/** nav at 0, welcome at 300 ms, click at 1000 ms, ready at 1200 ms (microseconds), thread clock = 60 % of wall. */
function syntheticTrace() {
  return [
    at("navigationStart", 0, 0),
    at("openreel:entry", 100_000, 60_000),
    span("RunTask", 100_000, 80_000, 50_000),
    span("v8.compileModule", 110_000, 30_000, 28_000, { data: { url: "app://openreel/assets/index-abc.js" } }),
    span("v8.evaluateModule", 150_000, 40_000, 36_000),
    span("v8.evaluateModule", 160_000, 10_000, 9_000), // nested: must not double count
    at("openreel:welcome-visible", 300_000, 180_000),
    span("RunTask", 400_000, 20_000, 15_000),
    span("v8.compileModule", 410_000, 8_000, 7_000, { data: { url: "app://openreel/assets/executor-xyz.js" } }),
    span("EventDispatch", 1_000_000, 5_000, 4_000, { data: { type: "click" } }),
    span("RunTask", 1_000_000, 150_000, 90_000),
    span("RunTask", 1_160_000, 20_000, 18_000),
    at("perf:editor-ready", 1_200_000, 720_000),
  ];
}

describe("analyzeTrace", () => {
  it("reports renderer main-thread CPU for startup and the enter-editor click", () => {
    const m = analyzeTrace(syntheticTrace());
    expect(m.startupCpuMs).toBe(180);
    expect(m.startupWallMs).toBe(300);
    expect(m.startupCompileCpuMs).toBe(28);
    expect(m.startupEvalCpuMs).toBe(36);
    expect(m.enterCpuMs).toBe(720 - 600);
    expect(m.enterWallMs).toBe(200);
    expect(m.enterTaskCpuMs).toBe(108);
    expect(m.enterLongTasks).toBe(1);
    expect(m.totalCpuMs).toBe(720);
  });

  it("attributes agent-stack compile time to the warm-up window, not the enter window", () => {
    const m = analyzeTrace(syntheticTrace());
    expect(m.agentStackCompileBeforeClickCpuMs).toBe(7);
    expect(m.agentStackCompileInEnterCpuMs).toBe(0);
    expect(m.startupCompilePerChunk).toEqual(["28 index-abc.js"]);
  });

  it("rejects a trace that never reached the editor", () => {
    expect(() => analyzeTrace(syntheticTrace().filter((e) => e.name !== "perf:editor-ready"))).toThrow(/missing marks/);
    expect(() => analyzeTrace([])).toThrow(/openreel:entry/);
  });
});
