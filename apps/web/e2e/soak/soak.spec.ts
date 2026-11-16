import { expect, test } from "./fixture";
import { Sampler, SOAK, historyRetainedBytes, SOAK_CLIPS, SOAK_MINUTES, SOAK_TIMELINE_MINUTES, installProbes, pct, readManifest, writeOut } from "./soak-lib";
import { buildFeatureTimeline, importSources, openBlankEditor } from "./build-timeline";
import { autosaveNow, editBurst, exportRange, playFor, scrub, stateDigest } from "./session";

/**
 * Long-form soak: feature-length timeline built through the real store paths, then a scripted
 * session (scrub, play, edit, undo/redo, auto-save, range export) while memory and resource
 * counters are sampled. See docs/soak-report.md. Opt-in: OPENREEL_SOAK=1.
 */
test.skip(!SOAK, "set OPENREEL_SOAK=1 (pnpm --filter @openreel/web test:soak)");

test("feature-length timeline: scripted session, memory and latency", async ({ page, context }) => {
  test.setTimeout((SOAK_MINUTES + 120) * 60_000);
  const sources = readManifest().filter((s) => !s.desktopOnly);
  await page.addInitScript(installProbes);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const sampler = new Sampler(page, cdp);
  let cycle = 0;
  const log = (msg: string) => console.log(`[soak] ${msg}`);
  page.on("framenavigated", (f) => f === page.mainFrame() && log(`NAVIGATED to ${f.url()}`));
  let crashed = false;
  let currentStep = "setup";
  page.on("crash", () => {
    crashed = true;
    log(`PAGE CRASHED at cycle ${cycle} in step ${currentStep}; last sample ${JSON.stringify({ ...sampler.samples.at(-1), counters: undefined, live: sampler.samples.at(-1)?.live })}`);
  });
  page.on("pageerror", (e) => log(`pageerror ${e.message.slice(0, 200)}`));
  page.on("console", (m) => m.type() === "error" && log(`console.error ${m.text().slice(0, 200)}`));

  const bootStart = Date.now();
  await openBlankEditor(page);
  log(`editor ready in ${((Date.now() - bootStart) / 1000).toFixed(1)}s`);
  await sampler.sample(true);

  // --- (a) material + timeline ---------------------------------------------------------------
  const importStart = Date.now();
  const mediaIds = await importSources(page, sources);
  const importMs = Date.now() - importStart;
  log(`imported ${sources.length} sources (${(sources.reduce((n, s) => n + s.bytes, 0) / 1e9).toFixed(2)} GB) in ${(importMs / 1000).toFixed(0)}s`);
  sampler.phase = "post-import";
  await sampler.sample(true);

  const build = await buildFeatureTimeline(page, mediaIds, sources);
  build.importMs = importMs;
  log(`built ${build.clips.total} clips on ${build.tracks.video}V+${build.tracks.audio}A tracks, ${build.timelineSeconds.toFixed(0)}s, in ${(build.buildMs / 1000).toFixed(0)}s; ` +
    `clip/add ${build.addClipMsFirst100.toFixed(1)}ms (first 100) -> ${build.addClipMsLast100.toFixed(1)}ms (last 100); undo depth ${build.historyDepth}; stage errors ${JSON.stringify(build.stageErrors)}`);
  sampler.phase = "post-build";
  const afterBuild = await sampler.sample(true);
  const historyAfterBuild = await historyRetainedBytes(page);
  log(`undo history after build: ${historyAfterBuild.entries} entries, ${(historyAfterBuild.uniqueBytes / 1e6).toFixed(2)} MB not shared with the project (${(historyAfterBuild.jsonBytes / 1e6).toFixed(1)} MB as JSON), ${historyAfterBuild.objects} objects`);
  writeOut("build.json", { ...build, historyAfterBuild });
  expect(build.clips.total, "timeline reached the requested size").toBeGreaterThanOrEqual(SOAK_CLIPS * 0.9);
  expect(build.stageErrors, "every build stage worked").toEqual([]);
  expect(build.captions, "captions were created").toBeGreaterThan(0);

  // --- (b) scripted session ---------------------------------------------------------------------
  sampler.phase = "session";
  sampler.start();
  const deadline = Date.now() + SOAK_MINUTES * 60_000;
  const T = build.timelineSeconds;
  const scrubLat: number[] = [];
  const playRes: Awaited<ReturnType<typeof playFor>>[] = [];
  const edits: Awaited<ReturnType<typeof editBurst>>[] = [];
  const autosaves: Awaited<ReturnType<typeof autosaveNow>>[] = [];
  const exports: Awaited<ReturnType<typeof exportRange>>[] = [];
  let rng = 7;
  const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Every scripted step has its own watchdog so a hang is reported with the step that hung.
  const step = <T,>(name: string, work: Promise<T>, ms = 180_000): Promise<T> =>
    (currentStep = name, Promise).race([
      work,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`HUNG in step "${name}" after ${ms / 1000}s`)), ms)),
      new Promise<T>((_, rej) => {
        const t = setInterval(() => crashed && (clearInterval(t), rej(new Error(`renderer crashed during step "${name}" (cycle ${cycle})`))), 500);
        void work.then(() => clearInterval(t), () => clearInterval(t));
      }),
    ]);
  while (Date.now() < deadline) {
    cycle++;
    const targets = Array.from({ length: 6 }, () => rand() * (T - 5));
    const s = await step("scrub", scrub(page, targets));
    scrubLat.push(...s.latencyMs.filter((x) => x > 0));
    await page.evaluate((t) => (window as any).__openreelE2E.timeline.getState().seekTo(t), rand() * (T - 20));
    playRes.push(await step("play", playFor(page, 6)));
    const e = await step("edit burst", editBurst(page, cycle));
    edits.push(e);
    expect(e.addedHistory, "five edits are five undo steps").toBe(5);
    expect(e.mismatches, "undo/redo restores each step exactly").toEqual([]);
    expect(e.undoRestoredExactly, "undo x5 restores the exact state").toBe(true);
    expect(e.redoRestoredExactly, "redo x5 restores the exact state").toBe(true);
    if (cycle % Number(process.env.SOAK_AUTOSAVE_EVERY ?? 3) === 0) autosaves.push(await step("autosave", autosaveNow(page)));
    if (cycle % Number(process.env.SOAK_EXPORT_EVERY ?? 6) === 0) {
      const at = rand() * (T - 10);
      const x = await step("export", exportRange(page, at, at + 3), 300_000);
      exports.push(x);
      expect(x.status, `range export ${x.error ?? ""}`).toBe("completed");
    }
    sampler.phase = "session";
    const smp = await step("sample", sampler.sample(true), 120_000);
    log(`cycle ${cycle}: heap ${smp.jsHeapMB.toFixed(0)}MB renderer ${smp.rendererRssMB.toFixed(0)}MB total ${smp.rssMB.toFixed(0)}MB; scrub p50 ${pct(s.latencyMs, 50).toFixed(0)}ms, play drops>50ms ${playRes.at(-1)!.dropped50ms}/${playRes.at(-1)!.frames}, edit ${e.editMs.map((x) => x.toFixed(0)).join("/")}ms`);
  }
  sampler.stop();

  // Quiesce, then compare against the post-build baseline after a full GC.
  sampler.phase = "idle-end";
  await page.waitForTimeout(20_000);
  const end = await sampler.sample(true);
  const historyEnd = await historyRetainedBytes(page);
  // Real retained size of the undo history: heap after a full GC with it, minus heap after clearing it.
  const heapWithHistory = (await sampler.sample(true)).jsHeapMB;
  await page.evaluate(() => {
    const h = (window as any).__openreelE2E.project.getState().actionExecutor.getHistory();
    h.clear();
  });
  const heapWithoutHistory = (await sampler.sample(true)).jsHeapMB;
  log(`undo history (${historyEnd.entries} entries) retains ~${(heapWithHistory - heapWithoutHistory).toFixed(1)} MB of JS heap`);
  const sessionSamples = sampler.samples.filter((s) => s.phase === "session" && s.tMin > afterBuild.tMin);
  const drift = {
    jsHeapMBPerMin: sampler.drift("jsHeapMB", "session"),
    rssMBPerMin: sampler.drift("rssMB", "session"),
    rendererRssMBPerMin: sampler.drift("rendererRssMB", "session"),
  };
  const report = {
    config: { SOAK_MINUTES, SOAK_CLIPS, SOAK_TIMELINE_MINUTES, sources: sources.map((s) => ({ name: s.name, w: s.w, h: s.h, codec: s.codec, seconds: s.seconds, MB: Math.round(s.bytes / 1e6) })) },
    build,
    cycles: cycle,
    scrub: { n: scrubLat.length, p50: pct(scrubLat, 50), p95: pct(scrubLat, 95), max: Math.max(0, ...scrubLat) },
    playback: {
      runs: playRes.length,
      frames: playRes.reduce((n, r) => n + r.frames, 0),
      dropped25ms: playRes.reduce((n, r) => n + r.dropped25ms, 0),
      dropped50ms: playRes.reduce((n, r) => n + r.dropped50ms, 0),
      worstFrameMs: Math.max(...playRes.map((r) => r.maxFrameMs)),
      realtimeRatio: playRes.reduce((n, r) => n + r.advancedSeconds, 0) / playRes.reduce((n, r) => n + r.wallSeconds, 0),
      longTaskMs: playRes.reduce((n, r) => n + r.longTaskMs, 0),
    },
    edits: {
      bursts: edits.length,
      editMsP50: pct(edits.flatMap((x) => x.editMs), 50),
      editMsP95: pct(edits.flatMap((x) => x.editMs), 95),
      undoMsP95: pct(edits.flatMap((x) => x.undoMs), 95),
      redoMsP95: pct(edits.flatMap((x) => x.redoMs), 95),
    },
    autosave: {
      saves: autosaves.length,
      forceSaveMsP50: pct(autosaves.map((a) => a.forceSaveMs), 50),
      forceSaveMsMax: Math.max(0, ...autosaves.map((a) => a.forceSaveMs)),
      recordMB: autosaves.length ? Math.max(...autosaves.at(-1)!.records.map((r) => r.bytes)) / 1e6 : 0,
      slots: autosaves.at(-1)?.records.length ?? 0,
    },
    exports: { n: exports.length, msP50: pct(exports.map((x) => x.ms), 50), msMax: Math.max(0, ...exports.map((x) => x.ms)) },
    memory: {
      afterBuild: { jsHeapMB: afterBuild.jsHeapMB, rssMB: afterBuild.rssMB, rendererRssMB: afterBuild.rendererRssMB },
      end: { jsHeapMB: end.jsHeapMB, rssMB: end.rssMB, rendererRssMB: end.rendererRssMB },
      drift,
      peakRssMB: Math.max(...sampler.samples.map((s) => s.rssMB)),
      peakJsHeapMB: Math.max(...sampler.samples.map((s) => s.jsHeapMB)),
      undoDepth: end.undoDepth,
      historyAfterBuild,
      historyEnd,
      historyHeapMB: heapWithHistory - heapWithoutHistory,
      live: { afterBuild: afterBuild.live, end: end.live },
      counters: end.counters,
    },
    samples: sampler.samples,
    sessionSamples: sessionSamples.length,
  };
  const path = writeOut("soak-report.json", report);
  log(`wrote ${path}`);
  log(`drift: heap ${drift.jsHeapMBPerMin.toFixed(2)} MB/min, rss ${drift.rssMBPerMin.toFixed(2)} MB/min; live end ${JSON.stringify(end.live)}`);

  // --- leak gates: what must not grow without bound ---------------------------------------------
  expect(end.live.videoFrames - afterBuild.live.videoFrames, "VideoFrames not closed").toBeLessThan(40);
  expect(end.live.workers - afterBuild.live.workers, "workers not terminated").toBeLessThan(3);
  expect(end.live.decoders - afterBuild.live.decoders, "decoders not closed").toBeLessThan(12);
  expect(end.live.audioContexts, "AudioContexts not closed").toBeLessThan(6);
  expect(end.live.syncHandles, "OPFS sync handles not closed").toBeLessThan(4);
  expect(end.live.writables, "OPFS writables not closed").toBeLessThan(4);
  expect(end.documents ?? 1).toBeLessThan(4);
  expect(drift.jsHeapMBPerMin, "post-GC JS heap drift (MB/min)").toBeLessThan(5);
  expect(end.undoDepth, "undo stack is bounded").toBeLessThanOrEqual(1000);
  void stateDigest;
});
