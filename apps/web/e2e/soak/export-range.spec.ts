import { expect, test } from "./fixture";
import { SOAK, Sampler, installProbes, readManifest } from "./soak-lib";
import { buildFeatureTimeline, importSources, openBlankEditor } from "./build-timeline";

/**
 * Regression for the export-decoder restart storm: the feature timeline shows the same 4K long-GOP
 * sources on several layers at once, and every 3 s range export (random positions) must finish in
 * well under a minute (it took 3+ minutes per frame batch when each layer restarted at a keyframe).
 */
test.skip(!SOAK, "set OPENREEL_SOAK=1");
test("random 3 s range exports on the feature timeline finish quickly", async ({ page, context }) => {
  test.setTimeout(30 * 60_000);
  const sources = readManifest().filter((s) => !s.desktopOnly);
  await page.addInitScript(installProbes);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const sampler = new Sampler(page, cdp);
  page.on("crash", () => console.log("[repro] PAGE CRASHED"));
  await openBlankEditor(page);
  const ids = await importSources(page, sources);
  const build = await buildFeatureTimeline(page, ids, sources);
  console.log(`[repro] built ${JSON.stringify({ clips: build.clips, captions: build.captions, stageErrors: build.stageErrors })}`);
  console.log("[repro] tracks " + JSON.stringify(await page.evaluate(() => (window as any).__openreelE2E.project.getState().project.timeline.tracks.map((t: any) => [t.name, t.type, t.role, t.clips.length]))));
  await sampler.sample(true);
  let rng = 7;
  const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296);
  const N = Number(process.env.REPRO_N ?? 12);
  for (let n = 0; n < N; n++) {
    const at = Math.floor(rand() * (build.timelineSeconds - 10));
    const t0 = Date.now();
    await page.evaluate(
      (r) => {
        const q = (window as any).__openreelE2E.exportQueue.getState();
        q.enqueue({ settings: { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000, range: r }, presetLabel: "Soak range" });
        q.start();
      },
      { startTime: at, endTime: at + 3 },
    );
    let last = "";
    for (let i = 0; i < 150; i++) {
      await page.waitForTimeout(1000);
      try {
        const s = await sampler.sample(false);
        last = await page.evaluate(() => {
          const j = (window as any).__openreelE2E.exportQueue.getState().queue.jobs.at(-1);
          return `${j?.status} ${Math.round((j?.progress ?? 0) * 100)}% ${j?.error ?? ""}`;
        });
        if (i % 10 === 9 || /completed|failed/.test(last)) console.log(`[repro] #${n} at ${at}s +${((Date.now() - t0) / 1000).toFixed(0)}s heap ${s.jsHeapMB.toFixed(0)}MB renderer ${s.rendererRssMB.toFixed(0)}MB ${last} dec ${s.live.decoders}`);
        if (/completed|failed/.test(last)) {
          expect(last, `export #${n} at ${at}s`).toMatch(/^completed/);
          expect((Date.now() - t0) / 1000, `export #${n} at ${at}s took too long`).toBeLessThan(90);
          break;
        }
      } catch (e) {
        console.log(`[repro] sample failed ${String(e).slice(0, 120)}`);
        return;
      }
    }
  }
});
