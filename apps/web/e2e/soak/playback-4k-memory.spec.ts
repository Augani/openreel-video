import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOAK, SOAK_MEDIA_DIR, browserProcessMemory, browserRendererPids, rendererFootprint, installProbes, startMemoryInfra, writeOut } from "./soak-lib";
import { playFor } from "./session";
import { importInput, openEditor } from "../helpers";
import { E2E_FFMPEG } from "../env";

/**
 * Peak memory while playing back-to-back 4K long-GOP clips from several different sources (the case
 * behind the 5.6 GB renderer peak in docs/soak-report.md). Four stream-copied cuts of the 4K soak
 * sources sit on one track, so native video playback runs through clip changes. Browser process-tree
 * RSS is sampled every 2 s; the run fails when the total peak is over the budget below (SOAK_4K_PEAK_MB overrides).
 */
test.skip(!SOAK, "set OPENREEL_SOAK=1 (pnpm --filter @openreel/web test:soak)");

const CLIP_SECONDS = Number(process.env.SOAK_4K_CLIP_SECONDS ?? 12);
// SOAK_4K_LAYERED=1 adds an overlapping layer so the compositing path is exercised instead of native playback.
// SOAK_4K_FULL=1 imports the whole 10-minute sources instead of short stream-copied cuts.
const FULL = process.env.SOAK_4K_FULL === "1";
const LAYERED = process.env.SOAK_4K_LAYERED === "1";
// Hard gate on total browser process memory (renderer + GPU + utility, RSS) while 4K long-GOP clips play.
// Budgets are set from the w16 measurements (docs/known-limitations.md, Memory), with headroom for the
// run-to-run spread of about 500 MB seen on a shared machine:
//   - short stream-copied cuts: measured 1.6-1.7 GB, gate 2560 MB;
//   - SOAK_4K_FULL=1 SOAK_4K_LAYERED=1 (whole 10-minute sources, compositing path): measured 3.05-4.08 GB
//     (median 3.77 GB), gate 4608 MB. The pre-w16 build measured 3.4-4.2 GB on the same fixture, so this
//     catches a return to the 5.6 GB startup peak, not a 5% drift.
// w17 re-measurement (3 runs each side, no change in this shape): before 3749-3840 MB, after 3755-4027 MB; the gate
// above stays. The layered long-GOP gate that carries the 4 GB target is memory-4k-layered.spec.ts.
// SOAK_4K_PEAK_MB overrides either.
const PEAK_BUDGET_MB = Number(process.env.SOAK_4K_PEAK_MB ?? (FULL && LAYERED ? 4608 : 2560));

test("4K multi-source playback stays under the memory budget", async ({ page, browser }) => {
  test.setTimeout(20 * 60_000);
  const sources = ["uhd-h264-longgop.mp4", "uhd-hevc.mp4", "hd-h264-longgop.mp4", "hd-h264-varkf.mp4"].map((n) => join(SOAK_MEDIA_DIR, n));
  for (const s of FULL ? sources : sources.slice(0, 2)) test.skip(!existsSync(s), `missing ${s}; run node e2e/soak/gen-media.mjs`);
  const dir = mkdtempSync(join(tmpdir(), "openreel-soak-4k-mem-"));
  const clips: string[] = [];
  for (let i = 0; i < 4; i++) {
    const out = join(dir, `uhd-cut-${i}.mp4`);
    if (FULL) {
      // Whole 10-minute sources (their audio decodes to a full-length AudioBuffer each), renamed via symlink.
      symlinkSync(sources[i], out);
    } else {
      const start = 20 + i * 70; // distinct GOPs per cut
      execFileSync(E2E_FFMPEG, ["-v", "error", "-y", "-ss", String(start), "-i", sources[i % 2], "-t", String(CLIP_SECONDS + 4), "-c", "copy", out]);
    }
    clips.push(out);
  }
  const diag = async (label: string): Promise<void> => {
    if (process.env.SOAK_4K_DIAG !== "1") return;
    const info = await page.evaluate(async () => {
      const mem = (performance as any).memory;
      let ua: unknown = null;
      try {
        ua = await (performance as any).measureUserAgentSpecificMemory?.();
      } catch (e) {
        ua = String(e);
      }
      const u = ua as { bytes?: number; breakdown?: Array<{ bytes: number; types: string[]; attribution: Array<{ scope: string }> }> } | string | null;
      return {
        jsHeapMB: Math.round(mem.usedJSHeapSize / 1048576),
        jsTotalMB: Math.round(mem.totalJSHeapSize / 1048576),
        uaMB: typeof u === "object" && u ? Math.round((u.bytes ?? 0) / 1048576) : u,
        videos: document.querySelectorAll("video").length, counters: (window as any).__soak,
      };
    });
    console.log(`[4k mem diag] ${label} ${JSON.stringify(info)} proc=${JSON.stringify(browserProcessMemory())}`);
  };
  await page.addInitScript(installProbes);
  // Console warnings/errors and page errors, counted by message, printed at the end: a playback stall leaves its trace here.
  const consoleTally = new Map<string, number>();
  const tally = (kind: string, text: string): void => {
    const key = `${kind}: ${text.replace(/\s+/g, " ").slice(0, 160)}`;
    consoleTally.set(key, (consoleTally.get(key) ?? 0) + 1);
  };
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") tally(m.type(), m.text());
  });
  page.on("pageerror", (e) => tally("pageerror", String(e)));
  // SOAK_4K_MEMINFRA=1: Chrome memory-infra dumps (partition_alloc/array_buffer, blink, v8, gpu), top processes printed at the end.
  const infraTrace = process.env.SOAK_4K_MEMINFRA === "1" ? await startMemoryInfra(browser) : null;
  if (process.env.SOAK_4K_XP) await page.addInitScript((keys) => { for (const k of keys) localStorage.setItem(k, "1"); }, process.env.SOAK_4K_XP.split(","));
  await openEditor(page);
  await diag("editor-open");
  await importInput(page).setInputFiles(clips);
  await diag("import-started");
  for (let i = 0; i < clips.length; i++) {
    await page.getByLabel(`Select media uhd-cut-${i}.mp4`).waitFor({ timeout: 120_000 });
  }
  await diag("imported");
  await page.evaluate(async ({ clipSeconds, layered }) => {
    const E = (window as any).__openreelE2E;
    const st = E.project.getState();
    await st.updateSettings({ width: 3840, height: 2160, frameRate: 30 });
    await st.addTrack("video", undefined, { name: "UHD" });
    const track = E.project.getState().project.timeline.tracks.filter((t: any) => t.type === "video").at(-1).id;
    for (let i = 0; i < 4; i++) {
      const item = E.project.getState().project.mediaLibrary.items.find((m: any) => m.name === `uhd-cut-${i}.mp4`);
      await E.project.getState().executeAction({ type: "clip/add", params: { trackId: track, mediaId: item.id, startTime: i * clipSeconds, clipId: crypto.randomUUID(), duration: clipSeconds, inPoint: 0, outPoint: clipSeconds } });
    }
    if (layered) {
      // A second layer overlapping the first rules out native single-element playback: the frame
      // decoder / compositor path (the one the feature-length soak timeline uses) runs instead.
      await E.project.getState().addTrack("video", undefined, { name: "UHD overlay" });
      const overlay = E.project.getState().project.timeline.tracks.filter((t: any) => t.type === "video").at(-1).id;
      const item = E.project.getState().project.mediaLibrary.items.find((m: any) => m.name === "uhd-cut-1.mp4");
      await E.project.getState().executeAction({ type: "clip/add", params: { trackId: overlay, mediaId: item.id, startTime: 2, clipId: crypto.randomUUID(), duration: clipSeconds, inPoint: 0, outPoint: clipSeconds } });
    }
    E.timeline.getState().seekTo(0);
  }, { clipSeconds: CLIP_SECONDS, layered: LAYERED });
  await diag("timeline-built");
  await page.waitForTimeout(3000);
  await diag("settled-3s");
  if (process.env.SOAK_4K_SETTLE_MS) {
    await page.waitForTimeout(Number(process.env.SOAK_4K_SETTLE_MS));
    await diag("settled-extra");
  }

  // Which part of the project changes while playing (every change restarts the playback effect; see the playback
  // events in the stall diagnosis, docs/known-limitations.md).
  await page.evaluate(() => {
    const E = (window as any).__openreelE2E;
    const log: Array<Record<string, unknown>> = [];
    (window as any).__projectChanges = log;
    E.project.subscribe((state: any, prev: any) => {
      if (state.project === prev.project) return;
      const keys = Object.keys(state.project).filter((k) => state.project[k] !== prev.project[k]);
      const row: Record<string, unknown> = { t: Math.round(performance.now()), keys, pos: E.timeline.getState().playheadPosition, playing: E.timeline.getState().playbackState };
      if (keys.includes("mediaLibrary")) {
        const a = state.project.mediaLibrary.items as any[];
        const b = prev.project.mediaLibrary.items as any[];
        row.media = a.filter((m, i) => m !== b[i]).map((m) => {
          const o = b.find((x) => x.id === m.id) ?? {};
          return { name: m.name, fields: Object.keys(m).filter((k) => m[k] !== o[k]) };
        });
      }
      if (keys.includes("timeline")) row.timelineKeys = Object.keys(state.project.timeline).filter((k) => state.project.timeline[k] !== prev.project.timeline[k]);
      log.push(row);
    });
  });
  await diag("before-play");
  const samples: Array<{ t: number; totalMB: number; rendererMB: number; gpuMB: number; inUseMB?: number }> = [];
  let sampling = true;
  let footprintTaken = false;
  let infraDumps = 0;
  // SOAK_4K_TIMELINE=1: page counters every 500 ms next to the RSS samples (frames/bitmaps/decoders open, JS heap),
  // to see what grows when the RSS spikes.
  const pageSeries: Array<Record<string, number>> = [];
  const pageSampler = process.env.SOAK_4K_TIMELINE === "1"
    ? (async () => {
        while (sampling) {
          const row = await page
            .evaluate(() => {
              const c = (window as any).__soak ?? {};
              const mem = (performance as any).memory;
              return { vfOut: c.videoFrameOut, vfClosed: c.videoFrameClosed, bmp: c.bitmapCreated - c.bitmapClosed, dec: c.decodersOpen - c.decodersClosed, heapMB: Math.round(mem.usedJSHeapSize / 1048576), ac: c.audioContexts, nodes: c.audioNodesCreated - c.audioNodesDisconnected, play: (window as any).__openreelE2E.timeline.getState().playheadPosition };
            })
            .catch(() => null);
          if (row) pageSeries.push({ t: (Date.now() - t0) / 1000, ...row });
          await new Promise((r) => setTimeout(r, 500));
        }
      })()
    : null;
  const t0 = Date.now();
  const sampler = (async () => {
    while (sampling) {
      const m = browserProcessMemory();
      if (infraTrace && m.totalMB > 3000 && infraDumps < 3) {
        infraDumps++;
        void infraTrace.dumpNow();
      }
      if (process.env.SOAK_4K_FOOTPRINT && !footprintTaken && browserProcessMemory().totalMB > Number(process.env.SOAK_4K_FOOTPRINT)) {
        footprintTaken = true;
        for (const pid of browserRendererPids()) {
          try { console.log(`[4k footprint ${pid}]\n` + execFileSync("footprint", ["-p", String(pid)], { encoding: "utf8" }).split("\n").slice(0, 40).join("\n")); } catch (e) { console.log("footprint failed", String(e).slice(0, 200)); }
        }
      }
      samples.push({ t: (Date.now() - t0) / 1000, totalMB: Math.round(m.totalMB), rendererMB: Math.round(m.rendererMB), gpuMB: Math.round(m.gpuMB), inUseMB: rendererFootprint()?.inUseMB });
      await new Promise((r) => setTimeout(r, 2000));
    }
  })();
  const play = process.env.SOAK_4K_NOPLAY === "1"
    ? (await page.waitForTimeout(30_000), { wallSeconds: 30, advancedSeconds: 999, frames: 0, dropped25ms: 0, dropped50ms: 0, maxFrameMs: 0, p95FrameMs: 0, longTasks: 0, longTaskMs: 0 })
    : await playFor(page, CLIP_SECONDS * 4 - 2);
  sampling = false;
  await sampler;
  await pageSampler;
  await diag("after-play");
  const peak = samples.reduce((a, s) => (s.totalMB > a.totalMB ? s : a), samples[0]);
  const peakRenderer = Math.max(...samples.map((s) => s.rendererMB));
  const peakInUse = Math.max(0, ...samples.map((s) => s.inUseMB ?? 0));
  console.log(`[4k mem] peak total ${peak.totalMB} MB (renderer ${peakRenderer}, renderer in use ${peakInUse}), play ${JSON.stringify(play)}`);
  const infra = infraTrace ? await infraTrace.stop() : [];
  if (infraTrace) console.log(`[4k mem] memory-infra top dumps ${JSON.stringify(infra)}`);
  const projectChanges = await page.evaluate(() => (window as any).__projectChanges ?? null).catch(() => null);
  if (projectChanges?.length) console.log(`[4k mem] project changes ${JSON.stringify(projectChanges.slice(0, 30))}`);
  const playbackEvents = await page.evaluate(() => (window as any).__openreelE2E?.playbackEvents?.() ?? null).catch(() => null);
  if (playbackEvents && play.advancedSeconds < 40) console.log(`[4k mem] playback events ${JSON.stringify(playbackEvents.slice(-40))}`);
  const stalls = await page.evaluate(() => (window as any).__openreelE2E?.playbackStalls?.() ?? null).catch(() => null);
  if (stalls?.length) console.log(`[4k mem] playback watchdog recovered ${JSON.stringify(stalls)}`);
  const consoleTop = [...consoleTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (consoleTop.length) console.log(`[4k mem] console ${JSON.stringify(consoleTop)}`);
  writeOut("playback-4k-memory.json", { samples, play, peak, peakRenderer, peakInUse, infra, consoleTop, stalls, pageSeries, playbackEvents, projectChanges });
  expect(play.advancedSeconds).toBeGreaterThan(CLIP_SECONDS * 2);
  expect(peak.totalMB).toBeLessThan(PEAK_BUDGET_MB);
});
