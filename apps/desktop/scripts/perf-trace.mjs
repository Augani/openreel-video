/**
 * Trace analysis for the perf harness's `trace` scenario (see apps/desktop/PERF.md).
 *
 * Input: Chromium trace events (contentTracing.stopRecording output) of one Electron launch that
 * clicked "New project" on the welcome screen. Output: load-robust renderer-main-thread numbers.
 *
 * Why CPU time: every X event carries `tdur` (thread CPU time) and every event `tts` (thread clock),
 * so "how much work did the main thread do" is independent of how many other processes were
 * competing for the cores. Wall clock numbers are reported next to them, but only the CPU ones are
 * budgeted. Marks used: `openreel:entry`, `openreel:welcome-visible` (app), `perf:editor-ready`
 * (harness: Program canvas + ruler present).
 */

const ms = (us) => Math.round((us / 1000) * 10) / 10;
const sum = (list, f) => list.reduce((a, e) => a + f(e), 0);
const cpu = (e) => e.tdur ?? e.dur ?? 0;
const GC_TOP_LEVEL = /^(MajorGC|MinorGC|V8\.GCIncrementalMarking|V8\.GCIncrementalMarkingStart)$/;
const scriptName = (e) => String(e.args?.data?.url ?? e.args?.fileName ?? "").split("/").pop();

/** Metrics for the main-thread events in [from, to] (trace `ts` microseconds). */
function windowStats(main, from, to) {
  const inside = main.filter((e) => e.ph === "X" && e.ts >= from && e.ts <= to);
  const tasks = inside.filter((e) => e.name === "RunTask");
  const compiles = inside.filter((e) => /^v8\.compile(Module)?$/.test(e.name) && scriptName(e) !== "");
  const evals = inside.filter((e) => e.name === "v8.evaluateModule" || e.name === "EvaluateScript");
  // evaluateModule / EvaluateScript nest (a module graph evaluates inside another one's event), so only
  // the outermost events are summed.
  const outer = [];
  for (const e of [...evals].sort((a, b) => a.ts - b.ts || b.dur - a.dur)) {
    const last = outer[outer.length - 1];
    if (last && e.ts < last.ts + last.dur) continue;
    outer.push(e);
  }
  const perChunk = new Map();
  for (const e of compiles) perChunk.set(scriptName(e), (perChunk.get(scriptName(e)) ?? 0) + cpu(e));
  return {
    tasks: tasks.length,
    longTasks: tasks.filter((e) => e.dur > 50000).length,
    taskCpuMs: ms(sum(tasks, cpu)),
    compileCpuMs: ms(sum(compiles, cpu)),
    evalCpuMs: ms(sum(outer, cpu)),
    // Writing the V8 code cache for each script after its first run (v8CacheOptions "bypassHeatCheck").
    // Paid only by a launch whose profile has no cache yet; a repeat launch consumes it instead.
    cacheProduceCpuMs: ms(sum(inside.filter((e) => e.name === "v8.produceModuleCache" || e.name === "v8.produceCache"), cpu)),
    // Top-level GC events only. V8 emits a tree per collection (MajorGC > V8.GCFinalizeMC >
    // V8.GC_MARK_COMPACTOR > V8.GC_MC_* ...), so summing every `V8.GC_*` event counted one
    // mark-compact four to six times over (reported as ~18-35 ms on a ~5 ms collection).
    gcCpuMs: ms(sum(inside.filter((e) => GC_TOP_LEVEL.test(e.name)), cpu)),
    majorGcs: inside.filter((e) => e.name === "MajorGC").length,
    minorGcs: inside.filter((e) => e.name === "MinorGC").length,
    layoutCpuMs: ms(sum(inside.filter((e) => /^(UpdateLayoutTree|Layout|PrePaint|Paint)$/.test(e.name)), cpu)),
    chunksCompiled: perChunk.size,
    chunkNames: [...perChunk.keys()].sort(),
    // Agent/MCP stack chunks (loaded lazily; must stay off the cold-start and enter-editor paths).
    agentStackCompileCpuMs: ms(sum(compiles.filter((e) => /^(executor|host-singleton|export-job-runner|mcp-listener)-/.test(scriptName(e))), cpu)),
    compilePerChunkMs: [...perChunk.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, us]) => `${ms(us)} ${name}`),
  };
}

export function analyzeTrace(traceEvents) {
  const events = Array.isArray(traceEvents) ? traceEvents : (traceEvents.traceEvents ?? []);
  const entry = events.find((e) => e.name === "openreel:entry");
  if (!entry) throw new Error("trace has no openreel:entry mark");
  const main = events.filter((e) => e.pid === entry.pid && e.tid === entry.tid);
  const find = (name) => main.find((e) => e.name === name);
  const nav = main.find((e) => e.name === "navigationStart") ?? main[0];
  const welcome = find("openreel:welcome-visible");
  const ready = find("perf:editor-ready");
  const click = main.find((e) => e.name === "EventDispatch" && e.args?.data?.type === "click" && (!welcome || e.ts >= welcome.ts - 1));
  if (!welcome || !ready || !click) throw new Error(`trace is missing marks (welcome ${!!welcome}, click ${!!click}, ready ${!!ready})`);

  const startup = windowStats(main, nav.ts, welcome.ts);
  const warm = windowStats(main, welcome.ts, click.ts);
  const enter = windowStats(main, click.ts, ready.ts);
  const total = windowStats(main, nav.ts, ready.ts);
  return {
    // Renderer main-thread CPU (ms), navigation start -> welcome screen visible.
    startupCpuMs: ms(welcome.tts - nav.tts),
    startupWallMs: ms(welcome.ts - nav.ts),
    startupCompileCpuMs: startup.compileCpuMs,
    startupEvalCpuMs: startup.evalCpuMs,
    startupLongTasks: startup.longTasks,
    startupTasks: startup.tasks,
    // Click on "Horizontal" -> Program canvas and ruler present.
    enterCpuMs: ms(ready.tts - click.tts),
    enterWallMs: ms(ready.ts - click.ts),
    enterTaskCpuMs: enter.taskCpuMs,
    enterCompileCpuMs: enter.compileCpuMs,
    enterEvalCpuMs: enter.evalCpuMs,
    enterGcCpuMs: enter.gcCpuMs,
    enterMajorGcs: enter.majorGcs,
    enterMinorGcs: enter.minorGcs,
    totalGcCpuMs: total.gcCpuMs,
    enterLayoutCpuMs: enter.layoutCpuMs,
    enterLongTasks: enter.longTasks,
    enterTasks: enter.tasks,
    // navigation start -> editor interactive, all on the renderer main thread.
    totalCpuMs: ms(ready.tts - nav.tts),
    totalCompileCpuMs: total.compileCpuMs,
    totalEvalCpuMs: total.evalCpuMs,
    totalCacheProduceCpuMs: total.cacheProduceCpuMs,
    totalLongTasks: total.longTasks,
    totalChunksCompiled: total.chunksCompiled,
    // Every script compiled between navigation start and editor interactive, so a chunk-count change
    // can be attributed to the chunks that caused it.
    totalChunkNames: total.chunkNames,
    // Welcome screen visible -> click (the editor warm-up window).
    warmCpuMs: warm.taskCpuMs,
    warmCompileCpuMs: warm.compileCpuMs,
    // Compile time of the agent stack chunks before the click / inside the enter window. A user who
    // clicks right away must not pay for them (they load once the warm-up settled and the thread is idle).
    agentStackCompileBeforeClickCpuMs: ms(sum(main.filter((e) => e.ph === "X" && e.ts >= nav.ts && e.ts <= click.ts && /^v8\.compile(Module)?$/.test(e.name) && /^(executor|host-singleton|export-job-runner|mcp-listener)-/.test(scriptName(e))), cpu)),
    agentStackCompileInEnterCpuMs: enter.agentStackCompileCpuMs,
    enterCompilePerChunk: enter.compilePerChunkMs,
    startupCompilePerChunk: startup.compilePerChunkMs,
  };
}
