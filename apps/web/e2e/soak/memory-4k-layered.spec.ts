import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOAK, SOAK_MEDIA_DIR, browserProcessMemory, browserRendererPids, rendererFootprint, installProbes, pct, startMemoryInfra, writeOut, type InfraTop } from "./soak-lib";
import { scrub } from "./session";
import { importInput, openEditor } from "../helpers";
import { E2E_FFMPEG } from "../env";

/**
 * The 4K long-GOP memory reproduction and gate (docs/known-limitations.md, Memory).
 *
 * Three real 4K long-GOP cuts (H.264, HEVC, H.264) of SOAK_4K_SECONDS (default 90) are stream-copied from the soak
 * sources, imported with 540p proxy creation, and stacked on three video tracks. The run then does what an editor
 * does: random scrubbing, layered playback, proxy toggling on and off while playing, scrubbing again. Browser
 * process-tree RSS (renderer, GPU, utility) is sampled every second together with the renderer's `footprint`,
 * the page's JS heap, open VideoFrames / ImageBitmaps and the memory governor state, and the run writes a
 * breakdown plus scrub latency and playback stall figures to SOAK_OUT/memory-4k-layered.json.
 *
 * Gate: fails when the total browser RSS peak exceeds SOAK_4K_GATE_MB (3072 MB), when the import phase of 600 s sources
 * exceeds SOAK_4K_IMPORT_GATE_MB (2048 MB), when playback stalls (the playhead does not advance for 3 s while playing),
 * when playback advances less than 90 % of wall time, or when the memory governor does not degrade and recover.
 *
 *   pnpm --filter @openreel/web test:memory-gate         # 3 x 90 s sources, proxies, ~4 min
 *   pnpm --filter @openreel/web test:memory-gate:long    # 3 x 10 min sources, no proxies, ~4 min
 */
test.skip(!SOAK, "set OPENREEL_SOAK=1 (pnpm --filter @openreel/web test:soak)");

const SECONDS = Number(process.env.SOAK_4K_SECONDS ?? 90);
// Budgets come from the w17 measurements of the fixed build (3 runs each, docs/known-limitations.md, Memory):
//  - 90 s sources with proxies: total peak 2212-2260 MB;
//  - 600 s sources (SOAK_4K_SECONDS=600): total peak 1914-2354 MB, import phase 1334-1420 MB.
// The total gate is 3072 MB (the highest measurement plus about 30 %, and well under the 4 GB target); the import
// phase gate (long sources only) is 2048 MB: the pre-fix build read every source whole into ffmpeg.wasm during
// import and measured 2527-2913 MB there, so it fails the gate and the fixed build passes it with margin.
// SOAK_4K_GATE_MB / SOAK_4K_IMPORT_GATE_MB override.
const GATE_MB = Number(process.env.SOAK_4K_GATE_MB ?? 3072);
const IMPORT_GATE_MB = Number(process.env.SOAK_4K_IMPORT_GATE_MB ?? 2048);
const PLAY_SECONDS = Number(process.env.SOAK_4K_PLAY_SECONDS ?? 40);
// SOAK_4K_PROXY=0 skips proxy creation and the proxy phases (whole 10-minute sources take long to proxy).
const WITH_PROXY = process.env.SOAK_4K_PROXY !== "0";
// Playhead where the first playback starts (SOAK_4K_SECONDS=600 sources: mid-file starts a fresh GOP chain).
const PLAY_FROM = Number(process.env.SOAK_4K_PLAY_FROM ?? 1);

/** `footprint` category table of the renderer with the largest dirty size (the Program page's). */
function largestRendererFootprint(): string {
  let best = { mb: -1, text: "" };
  const unit = { B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 } as Record<string, number>;
  for (const pid of browserRendererPids()) {
    try {
      const out = execFileSync("footprint", ["-p", String(pid)], { encoding: "utf8", maxBuffer: 1 << 24 });
      const total = /^\s*([\d.]+) (B|KB|MB|GB)\s+[\d.]+ (B|KB|MB|GB)\s+[\d.]+ (B|KB|MB|GB)\s+\d+\s+TOTAL/m.exec(out);
      const mb = total ? +total[1] * unit[total[2]] : 0;
      if (mb > best.mb) {
        const lines = out.split("\n").filter((l) => /^\s*[\d.]+ (B|KB|MB|GB)\s+[\d.]+ (B|KB|MB|GB)\s+[\d.]+ (B|KB|MB|GB)\s+\d+\s+\S/.test(l));
        best = { mb, text: `pid ${pid} dirty ${Math.round(mb)} MB\n` + lines.slice(0, 14).join("\n") };
      }
    } catch {
      /* exited */
    }
  }
  return best.text;
}

interface Sample {
  t: number;
  phase: string;
  totalMB: number;
  rendererMB: number;
  gpuMB: number;
  otherMB: number;
  inUseMB?: number;
}

test("4K layered long-GOP: scrub, play and toggle proxies under the memory gate", async ({ page, browser }) => {
  test.setTimeout(40 * 60_000);
  const sources = [
    { src: "uhd-h264-longgop.mp4", start: 30 },
    { src: "uhd-hevc.mp4", start: 60 },
    { src: "uhd-h264-longgop.mp4", start: 200 },
  ];
  for (const s of sources) test.skip(!existsSync(join(SOAK_MEDIA_DIR, s.src)), `missing ${s.src}; run node e2e/soak/gen-media.mjs`);
  const dir = mkdtempSync(join(tmpdir(), "openreel-mem4k-"));
  const names: string[] = [];
  sources.forEach((s, i) => {
    const out = join(dir, `lg4k-${i}.mp4`);
    execFileSync(E2E_FFMPEG, ["-v", "error", "-y", "-ss", String(SECONDS >= 300 ? 0 : s.start), "-i", join(SOAK_MEDIA_DIR, s.src), "-t", String(SECONDS), "-c", "copy", out]);
    names.push(out);
  });

  await page.addInitScript(installProbes);
  // Console warnings/errors and page errors by message, printed at the end.
  const consoleTally = new Map<string, number>();
  const tally = (kind: string, text: string): void => {
    const key = `${kind}: ${text.replace(/\s+/g, " ").slice(0, 160)}`;
    consoleTally.set(key, (consoleTally.get(key) ?? 0) + 1);
  };
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") tally(m.type(), m.text());
  });
  page.on("pageerror", (e) => tally("pageerror", String(e)));
  // SOAK_4K_TRACE_AB=1: attribute ArrayBuffer-producing Blob reads (arrayBuffer(), stream chunks) to their call sites.
  if (process.env.SOAK_4K_TRACE_AB === "1") {
    await page.addInitScript(() => {
      const agg: Record<string, { bytes: number; calls: number }> = {};
      (window as any).__abAgg = agg;
      const note = (bytes: number): void => {
        const frames = (new Error().stack ?? "").split("\n").slice(2, 6).map((f) => f.replace(/^\s*at\s+/, "").replace(/https?:\/\/[^/]+/, "").slice(0, 90));
        const key = frames.join(" < ");
        const e = (agg[key] ??= { bytes: 0, calls: 0 });
        e.bytes += bytes;
        e.calls++;
      };
      const ab = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function (this: Blob) {
        note(this.size);
        return ab.call(this);
      };
      const FR = FileReader.prototype.readAsArrayBuffer;
      FileReader.prototype.readAsArrayBuffer = function (this: FileReader, b: Blob) {
        note(b.size);
        return FR.call(this, b);
      };
    });
  }
  // SOAK_4K_MEMINFRA=1: Chrome memory-infra dumps (partition_alloc, blink, v8, media, gpu) every 3 s, parsed at the end.
  const infraTrace = process.env.SOAK_4K_MEMINFRA === "1" ? await startMemoryInfra(browser) : null;
  await openEditor(page);

  if (WITH_PROXY) {
    const panel = page.getByTestId("proxy-panel");
    await panel.waitFor({ timeout: 30_000 });
    const header = panel.getByRole("button", { name: /^Proxies/ }).first();
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    await page.getByRole("combobox", { name: "Ingest preset" }).click();
    await page.getByRole("option", { name: "Create proxies" }).click();
    await page.getByRole("combobox", { name: "Proxy size" }).click();
    await page.getByRole("option", { name: /540p/ }).click();
  }

  // Sampler (1 s): process-tree RSS by type, renderer footprint, page heap, frames/bitmaps held, governor level.
  let phase = "start";
  const samples: Sample[] = [];
  const peakDetails: Array<{ t: number; phase: string; totalMB: number; footprint: string; page: unknown }> = [];
  let sampling = true;
  let maxSeen = 0;
  const t0 = Date.now();
  const pageStats = async (): Promise<unknown> =>
    page
      .evaluate(() => {
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        const c = (window as unknown as { __soak?: Record<string, number> }).__soak ?? {};
        const gov = (window as unknown as { __openreelE2E?: { memoryGovernor?: () => unknown } }).__openreelE2E?.memoryGovernor?.();
        return {
          jsHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
          framesOpen: (c.videoFrameOut ?? 0) - (c.videoFrameClosed ?? 0),
          bitmapsOpen: (c.bitmapCreated ?? 0) - (c.bitmapClosed ?? 0),
          decodersOpen: (c.decodersOpen ?? 0) - (c.decodersClosed ?? 0),
          videoEls: document.querySelectorAll("video").length,
          blobUrlsOpen: (c.blobUrlCreated ?? 0) - (c.blobUrlRevoked ?? 0),
          audioContexts: (c.audioContexts ?? 0) - (c.audioContextsClosed ?? 0),
          governor: gov ?? null,
        };
      })
      .catch(() => null);
  const sampler = (async () => {
    while (sampling) {
      const m = browserProcessMemory();
      const fp = rendererFootprint();
      const s: Sample = {
        t: (Date.now() - t0) / 1000,
        phase,
        totalMB: Math.round(m.totalMB),
        rendererMB: Math.round(m.rendererMB),
        gpuMB: Math.round(m.gpuMB),
        otherMB: Math.round(m.totalMB - m.rendererMB - m.gpuMB),
        inUseMB: fp?.inUseMB,
      };
      samples.push(s);
      if (s.totalMB > maxSeen + 250 && s.phase !== "start") {
        maxSeen = s.totalMB;
        const footprint = largestRendererFootprint();
        peakDetails.push({ t: s.t, phase: s.phase, totalMB: s.totalMB, footprint, page: await pageStats() });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  phase = "import+proxy";
  await importInput(page).setInputFiles(names);
  for (let i = 0; i < names.length; i++) await page.getByLabel(`Select media lg4k-${i}.mp4`).waitFor({ timeout: 120_000 });
  if (WITH_PROXY) await expect
    .poll(
      () => page.evaluate((n) => (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.filter((m: any) => /^lg4k-/.test(m.name) && m.proxy?.status === "ready").length === n, names.length),
      { timeout: 30 * 60_000, intervals: [2000] },
    )
    .toBe(true);

  phase = "build";
  await page.evaluate(async ({ seconds }) => {
    const E = (window as any).__openreelE2E;
    await E.project.getState().updateSettings({ width: 3840, height: 2160, frameRate: 30 });
    const layout = [
      { name: "lg4k-0.mp4", at: 0, len: seconds },
      { name: "lg4k-1.mp4", at: 6, len: seconds - 12 },
      { name: "lg4k-2.mp4", at: 14, len: seconds - 28 },
    ];
    for (const l of layout) {
      await E.project.getState().addTrack("video", undefined, { name: l.name });
      const track = E.project.getState().project.timeline.tracks.filter((t: any) => t.type === "video").at(-1).id;
      const item = E.project.getState().project.mediaLibrary.items.find((m: any) => m.name === l.name);
      await E.project.getState().executeAction({ type: "clip/add", params: { trackId: track, mediaId: item.id, startTime: l.at, clipId: crypto.randomUUID(), duration: l.len, inPoint: 0, outPoint: l.len } });
    }
    E.timeline.getState().seekTo(0);
  }, { seconds: SECONDS });
  phase = "settle";
  await page.waitForTimeout(5000);

  const rng = (() => {
    let s = 4242;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  const toggle = page.getByTestId("toggle-proxies");
  const setProxies = async (on: boolean): Promise<void> => {
    if ((await toggle.getAttribute("aria-pressed")) !== String(on)) await toggle.click();
    await page.waitForTimeout(1200);
  };
  const lat = (r: { latencyMs: number[] }) => r.latencyMs.filter((x) => x > 0);

  // Playback with a playhead trace: a stall is >3 s without the playhead moving while playing.
  const play = async (seconds: number) =>
    page.evaluate(async (seconds) => {
      const E = (window as any).__openreelE2E;
      const trace: Array<[number, number, number]> = [];
      const clock = () => (E.audioClock ? E.audioClock() : { time: 0, state: "n/a" });
      const a0 = clock().time;
      let minAudioRate = Infinity;
      let lastWin = { w: performance.now(), a: a0 };
      let audioState = "";
      const p0 = E.timeline.getState().playheadPosition;
      const w0 = performance.now();
      E.timeline.getState().play();
      let lastMove = w0;
      let lastPos = p0;
      let maxFlat = 0;
      while (performance.now() - w0 < seconds * 1000) {
        await new Promise((r) => setTimeout(r, 250));
        const pos = E.timeline.getState().playheadPosition;
        const now = performance.now();
        if (pos !== lastPos) {
          lastPos = pos;
          lastMove = now;
        }
        maxFlat = Math.max(maxFlat, now - lastMove);
        const c = clock();
        audioState = c.state;
        trace.push([Math.round(now - w0), Math.round(pos * 100) / 100, Math.round((c.time - a0) * 100) / 100]);
        if (now - lastWin.w >= 2000) {
          minAudioRate = Math.min(minAudioRate, (c.time - lastWin.a) / ((now - lastWin.w) / 1000));
          lastWin = { w: now, a: c.time };
        }
      }
      E.timeline.getState().pause();
      const wall = (performance.now() - w0) / 1000;
      // minAudioRate: slowest audio-clock rate over 2 s windows (1 = real time). The playhead follows this clock, so a
      // playback that "advanced 16 s of 46 s" with a low minAudioRate is a stalled audio render thread, not video decode.
      return { wall, advanced: E.timeline.getState().playheadPosition - p0, maxFlatMs: Math.round(maxFlat), minAudioRate: Math.round(minAudioRate * 100) / 100, audioState, trace: trace.filter((_, i) => i % 8 === 0) };
    }, seconds);

  const targets = (n: number, lo = 3, hi = SECONDS - 4) => Array.from({ length: n }, () => lo + rng() * (hi - lo));
  const out: Record<string, unknown> = {};

  phase = "scrub-original-1";
  if (WITH_PROXY) await setProxies(false);
  await scrub(page, targets(3));
  const s1 = await scrub(page, targets(16));
  out.scrubOriginal1 = { n: lat(s1).length, p50: pct(lat(s1), 50), p95: pct(lat(s1), 95), max: Math.max(0, ...lat(s1)) };

  phase = "play-original";
  await page.evaluate((t) => (window as any).__openreelE2E.timeline.getState().seekTo(t), PLAY_FROM);
  await page.waitForTimeout(800);
  const p1 = await play(PLAY_SECONDS);
  out.playOriginal = p1;

  phase = "proxy-toggle";
  const toggles: unknown[] = [];
  for (let i = 0; i < (WITH_PROXY ? 3 : 0); i++) {
    await setProxies(true);
    await scrub(page, targets(3));
    toggles.push(await play(6));
    await setProxies(false);
    await scrub(page, targets(3));
    toggles.push(await play(6));
  }
  out.proxyToggles = toggles;

  phase = "scrub-proxy";
  if (WITH_PROXY) await setProxies(true);
  await scrub(page, targets(3));
  const s2 = await scrub(page, targets(12));
  out.scrubProxy = { n: lat(s2).length, p50: pct(lat(s2), 50), p95: pct(lat(s2), 95), max: Math.max(0, ...lat(s2)) };

  phase = "scrub-original-2";
  if (WITH_PROXY) await setProxies(false);
  await scrub(page, targets(3));
  const s3 = await scrub(page, targets(16));
  out.scrubOriginal2 = { n: lat(s3).length, p50: pct(lat(s3), 50), p95: pct(lat(s3), 95), max: Math.max(0, ...lat(s3)) };

  phase = "play-original-2";
  await page.evaluate((t) => (window as any).__openreelE2E.timeline.getState().seekTo(t), Math.min(20, SECONDS / 4));
  await page.waitForTimeout(800);
  const p2 = await play(Math.min(PLAY_SECONDS, 30));
  out.playOriginal2 = p2;

  // The governor degrades the preview and recovers: forced critical pressure shrinks the Program canvas and
  // the shared cache budget and shows the badge; releasing it restores all three.
  phase = "governor";
  const programCanvas = page.locator('canvas[aria-label^="Program frame"]');
  const widthOf = (): Promise<number> => programCanvas.evaluate((c) => (c as HTMLCanvasElement).width);
  let governorError: string | null = null;
  // SOAK_4K_NO_GOVERNOR=1: a build without the governor (the "before" side of the comparison).
  if (process.env.SOAK_4K_NO_GOVERNOR !== "1") try {
    const normalWidth = await widthOf();
    const normalReading = await page.evaluate(() => (window as any).__openreelE2E.memoryGovernor());
    await page.evaluate(() => (window as any).__openreelE2E.forceMemoryPressure("critical"));
    await expect(page.getByTestId("memory-pressure-badge")).toBeVisible({ timeout: 10_000 });
    await expect.poll(widthOf, { timeout: 10_000 }).toBeLessThan(normalWidth);
    const degradedWidth = await widthOf();
    const criticalReading = await page.evaluate(() => (window as any).__openreelE2E.memoryGovernor());
    await page.evaluate(() => (window as any).__openreelE2E.forceMemoryPressure(null));
    await page.waitForTimeout(2500);
    const releasedReading = await page.evaluate(() => (window as any).__openreelE2E.memoryGovernor());
    console.log(`[mem4k] governor after release ${JSON.stringify({ ...releasedReading, policy: undefined })}`);
    await expect(page.getByTestId("memory-pressure-badge")).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(widthOf, { timeout: 10_000 }).toBe(normalWidth);
    out.governor = { normalWidth, degradedWidth, normalPolicy: normalReading.policy, criticalPolicy: criticalReading.policy, consumers: normalReading.consumers };
  } catch (e) {
    governorError = String(e).slice(0, 400);
    await page.evaluate(() => (window as any).__openreelE2E.forceMemoryPressure(null)).catch(() => undefined);
  }
  out.governorError = governorError;

  phase = "end";
  const endStats = await pageStats();
  sampling = false;
  await sampler;

  const peak = samples.reduce((a, s) => (s.totalMB > a.totalMB ? s : a), samples[0]);
  const byPhase: Record<string, { peakTotalMB: number; peakRendererMB: number; peakGpuMB: number; peakOtherMB: number }> = {};
  for (const s of samples) {
    const b = (byPhase[s.phase] ??= { peakTotalMB: 0, peakRendererMB: 0, peakGpuMB: 0, peakOtherMB: 0 });
    b.peakTotalMB = Math.max(b.peakTotalMB, s.totalMB);
    b.peakRendererMB = Math.max(b.peakRendererMB, s.rendererMB);
    b.peakGpuMB = Math.max(b.peakGpuMB, s.gpuMB);
    b.peakOtherMB = Math.max(b.peakOtherMB, s.otherMB);
  }
  if (process.env.SOAK_4K_TRACE_AB === "1") {
    const agg = await page.evaluate(() => Object.entries((window as any).__abAgg as Record<string, { bytes: number; calls: number }>).map(([k, v]) => ({ k, mb: Math.round(v.bytes / 1048576), calls: v.calls })).sort((a, b) => b.mb - a.mb).slice(0, 10));
    console.log(`[mem4k] arrayBuffer call sites ${JSON.stringify(agg)}`);
  }
  let infra: InfraTop[] = [];
  if (infraTrace) {
    infra = await infraTrace.stop();
    console.log(`[mem4k] memory-infra top dumps ${JSON.stringify(infra)}`);
  }
  const consoleTop = [...consoleTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (consoleTop.length) console.log(`[mem4k] console ${JSON.stringify(consoleTop)}`);
  out.consoleTop = consoleTop;
  out.playbackStalls = await page.evaluate(() => (window as any).__openreelE2E?.playbackStalls?.() ?? null).catch(() => null);
  const summary = { peak, byPhase, ...out, endStats, infra, peakDetails, samples };
  writeOut("memory-4k-layered.json", summary);
  const q = (r: any) => (r ? `p50 ${r.p50} p95 ${r.p95}` : "-");
  console.log(`[mem4k] peak total ${peak.totalMB} MB at ${peak.t.toFixed(0)} s in ${peak.phase} (renderer ${peak.rendererMB}, gpu ${peak.gpuMB}, other ${peak.otherMB})`);
  console.log(`[mem4k] scrub original ${q(out.scrubOriginal1)} | proxy ${q(out.scrubProxy)} | original after ${q(out.scrubOriginal2)}`);
  console.log(`[mem4k] play ${JSON.stringify({ wall: p1.wall, advanced: p1.advanced, maxFlatMs: p1.maxFlatMs })} / ${JSON.stringify({ wall: p2.wall, advanced: p2.advanced, maxFlatMs: p2.maxFlatMs })}`);
  console.log(`[mem4k] by phase ${JSON.stringify(byPhase)}`);

  for (const p of [p1, p2]) {
    expect(p.maxFlatMs, "playhead stalled while playing").toBeLessThan(3000);
    expect(p.advanced, "playback fell behind wall clock").toBeGreaterThan(p.wall * 0.9);
  }
  expect(governorError, "memory governor degrade/recover").toBeNull();
  if (SECONDS >= 300) expect(byPhase["import+proxy"]?.peakTotalMB ?? 0, "import-phase RSS peak with long sources").toBeLessThan(IMPORT_GATE_MB);
  expect(peak.totalMB, "total browser RSS peak").toBeLessThan(GATE_MB);
});
