import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOAK, installProbes, readManifest, writeOut } from "./soak-lib";
import { buildFeatureTimeline, importSources } from "./build-timeline";
import { E2E_FFPROBE } from "../env";
import { readAutosaveRecords, stateDigest } from "./session";

/**
 * Crash recovery in real Chrome: the renderer is killed (CDP Page.crash, the same signal as an OOM
 * or a GPU-driver kill) mid-edit, mid-save-storm and mid-export, and a fresh page in the same
 * profile must find the last auto-save intact, restore it exactly, and see the interrupted export
 * job as retryable. Opt-in: OPENREEL_SOAK=1.
 */
test.skip(!SOAK, "set OPENREEL_SOAK=1 (pnpm --filter @openreel/web test:soak)");

const FFPROBE = E2E_FFPROBE;
const workDir = mkdtempSync(join(tmpdir(), "openreel-soak-recovery-"));

const INIT = () => {
  try {
    localStorage.setItem("openreel-onboarding-complete", "true");
    localStorage.setItem("openreel-mograph-tour-complete", "true");
  } catch {
    /* storage unavailable */
  }
};

async function crash(context: BrowserContext, page: Page): Promise<void> {
  const gone = new Promise<void>((resolve) => {
    page.once("crash", () => resolve());
    page.once("close", () => resolve());
  });
  const cdp = await context.newCDPSession(page);
  void cdp.send("Page.crash").catch(() => undefined);
  await gone;
  await page.close({ runBeforeUnload: false }).catch(() => undefined);
}

async function freshPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.autoSave), undefined, { timeout: 60_000 });
  return page;
}

/** Everything the project persists about the edit, as one comparable string. */
const canonical = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const p = (window as any).__openreelE2E.project.getState().getFullProject();
    return JSON.stringify({ timeline: p.timeline, textClips: p.textClips ?? [], shapeClips: p.shapeClips ?? [], sequences: (p.sequences ?? []).map((s: any) => s.id), multicam: (p.multicamSources ?? []).map((m: any) => m.id) });
  });

async function recoverNewest(page: Page): Promise<{ ok: boolean; ms: number; saves: number }> {
  return page.evaluate(async () => {
    const E = (window as any).__openreelE2E;
    await E.autoSave.initialize();
    const saves = await E.autoSave.checkForRecovery();
    const t = performance.now();
    const ok = saves.length > 0 && (await E.project.getState().recoverFromAutoSave(saves[0].id));
    // Opening the recovered project in the editor starts auto-save (App does this); we stay on the welcome page.
    await E.project.getState().initializeAutoSave();
    return { ok, ms: performance.now() - t, saves: saves.length };
  });
}

/** Wait until an auto-save newer than `since` is on disk (the debounce plus the write). */
async function waitSavedAfter(page: Page, since: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const recs = await readAutosaveRecords(page);
    if (recs.some((r) => r.timestamp > since)) return;
    await page.waitForTimeout(250);
  }
  throw new Error("no auto-save appeared");
}

async function setup(context: BrowserContext, page: Page): Promise<{ page: Page; build: Awaited<ReturnType<typeof buildFeatureTimeline>> }> {
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 90_000 });
  const sources = readManifest().filter((s) => /hd-h264-longgop|odd-h264/.test(s.name));
  const ids = await importSources(page, sources);
  const build = await buildFeatureTimeline(page, ids, sources, { clips: 120, minutes: 12 });
  return { page, build };
}

/** N small, distinct edits through the store (each an undo step). */
async function edits(page: Page, n: number, salt: number): Promise<void> {
  await page.evaluate(
    async ({ n, salt }) => {
      const st = (window as any).__openreelE2E.project.getState();
      const clips = st.project.timeline.tracks.filter((t: any) => t.type === "video").flatMap((t: any) => t.clips);
      for (let i = 0; i < n; i++) {
        const c = clips[(salt * 7 + i * 13) % clips.length];
        await st.addVideoEffect(c.id, "gaussian-blur", { radius: 1 + ((salt + i) % 9) });
      }
    },
    { n, salt },
  );
}

test.describe.configure({ mode: "serial", timeout: 30 * 60_000 });

test("renderer crash mid-edit: the last auto-save restores the project exactly", async ({ context }) => {
  await context.addInitScript(INIT);
  await context.addInitScript(installProbes);
  const first = await context.newPage();
  const { page, build } = await setup(context, first);
  expect(build.stageErrors).toEqual([]);

  // A: edits, auto-save lands, crash. Recovered state must equal the pre-crash state.
  const t0 = Date.now();
  await edits(page, 5, 1);
  await waitSavedAfter(page, t0);
  const before = await canonical(page);
  const digestBefore = await stateDigest(page);
  const recordsBefore = await readAutosaveRecords(page);
  await crash(context, page);
  const p2 = await freshPage(context);
  const rec = await recoverNewest(p2);
  expect(rec.ok, "recovery succeeded").toBe(true);
  const after = await canonical(p2);
  const exact = before === after;
  const digestAfter = await stateDigest(p2);
  console.log(`[recovery A] saves ${rec.saves}, recovered in ${rec.ms.toFixed(0)} ms, record ${(Math.max(...recordsBefore.map((r) => r.bytes)) / 1e6).toFixed(2)} MB, exact=${exact}, digest ${digestBefore} -> ${digestAfter}`);
  expect(digestAfter).toBe(digestBefore);
  expect(exact, "recovered timeline is byte-identical to the one that crashed").toBe(true);
  // The recovered session starts a fresh undo history; the edits themselves survived.
  const undoDepth = await p2.evaluate(() => (window as any).__openreelE2E.project.getState().actionExecutor.getHistory().getUndoStackSize());
  writeOut("recovery-a.json", { saves: rec.saves, recoverMs: rec.ms, exact, undoDepthAfterRecovery: undoDepth });

  // B: edits again, crash inside the debounce window. The recovered state is the last committed
  // save (or the new one if the write beat the crash), never a mixture.
  const savedState = await canonical(p2);
  const t1 = Date.now();
  await edits(p2, 3, 2);
  await waitSavedAfter(p2, t1);
  const savedAfterEdit = await canonical(p2);
  await edits(p2, 3, 3);
  const unsaved = await canonical(p2);
  await crash(context, p2);
  const p3 = await freshPage(context);
  const recB = await recoverNewest(p3);
  expect(recB.ok).toBe(true);
  const got = await canonical(p3);
  const which = got === unsaved ? "latest (write beat the crash)" : got === savedAfterEdit ? "previous save (lost the last <=debounce window)" : got === savedState ? "OLDER save" : "MIXTURE";
  console.log(`[recovery B] recovered ${which}`);
  expect([unsaved, savedAfterEdit]).toContain(got);
  writeOut("recovery-b.json", { which });
  await crash(context, p3);
});

test("save storm + crash x6: every auto-save record parses, the newest always recovers", async ({ context }) => {
  await context.addInitScript(INIT);
  const first = await context.newPage();
  let { page } = await setup(context, first);
  const outcomes: Array<{ crashAfterMs: number; records: number; allParse: boolean; recovered: boolean }> = [];
  for (let round = 0; round < 6; round++) {
    // Hammer the writer: edit + force-save without awaiting, then crash at a pseudo-random point.
    const crashAfter = 20 + ((round * 97) % 260);
    void page
      .evaluate(async () => {
        const st = (window as any).__openreelE2E.project.getState();
        const clip = st.project.timeline.tracks.find((t: any) => t.type === "video" && t.clips.length)!.clips[0];
        for (let i = 0; i < 60; i++) {
          void st.moveClip(clip.id, 0.01 * (i + 1)).then(() => st.forceSave()).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 5));
        }
      })
      .catch(() => undefined);
    await page.waitForTimeout(crashAfter);
    await crash(context, page);
    page = await freshPage(context);
    const parse = await page.evaluate(async () => {
      const open = indexedDB.open("openreel-autosave");
      return new Promise<{ n: number; ok: boolean }>((resolve) => {
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("autosaves")) return resolve({ n: 0, ok: true });
          const req = db.transaction("autosaves").objectStore("autosaves").getAll();
          req.onsuccess = () => {
            let ok = true;
            for (const r of req.result as Array<{ data: string }>) {
              try {
                const p = JSON.parse(r.data);
                if (!Array.isArray(p.timeline?.tracks)) ok = false;
              } catch {
                ok = false;
              }
            }
            db.close();
            resolve({ n: req.result.length, ok });
          };
        };
      });
    });
    const rec = await recoverNewest(page);
    outcomes.push({ crashAfterMs: crashAfter, records: parse.n, allParse: parse.ok, recovered: rec.ok });
    expect(parse.ok, `round ${round}: every record is intact JSON`).toBe(true);
    expect(rec.ok, `round ${round}: newest save recovers`).toBe(true);
  }
  console.log(`[recovery storm] ${JSON.stringify(outcomes)}`);
  writeOut("recovery-storm.json", outcomes);
});

test("renderer crash mid-export: the job comes back interrupted, retries from its snapshot and finishes", async ({ context }) => {
  await context.addInitScript(INIT);
  const first = await context.newPage();
  const { page } = await setup(context, first);
  const jobId = await page.evaluate(() => {
    const q = (window as any).__openreelE2E.exportQueue.getState();
    const job = q.enqueue({ settings: { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000, range: { startTime: 0, endTime: 60 } }, presetLabel: "Crash me" });
    q.start();
    return job.id as string;
  });
  await expect
    .poll(() => page.evaluate((id) => (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((j: any) => j.id === id)?.progress ?? 0, jobId), { timeout: 600_000, intervals: [500] })
    .toBeGreaterThan(0.1);
  await page.waitForTimeout(1500); // let the persisted state (running) flush
  // 60 s of output so the job is still running when the crash lands (a 6 s range finished inside
  // the flush wait once export got faster, turning the crash into a no-op).
  const before = await page.evaluate((id) => (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((j: any) => j.id === id)?.status as string, jobId);
  expect(before, "the export is still running when the renderer is killed").toBe("running");
  await crash(context, page);

  const p2 = await freshPage(context);
  await p2.evaluate(() => (window as any).__openreelE2E.exportQueue.getState().hydrate());
  const state = await p2.evaluate((id) => {
    const q = (window as any).__openreelE2E.exportQueue.getState().queue;
    const j = q.jobs.find((x: any) => x.id === id);
    return { status: j?.status as string, paused: q.paused as boolean, error: j?.error as string | undefined };
  }, jobId);
  console.log(`[recovery export] after crash: ${JSON.stringify(state)}`);
  expect(state.status).toBe("interrupted");
  expect(state.paused, "queue comes back paused").toBe(true);

  await p2.evaluate((id) => {
    const q = (window as any).__openreelE2E.exportQueue.getState();
    q.retry(id);
    q.start();
  }, jobId);
  const deadline = Date.now() + 12 * 60_000;
  let lastLog = -1;
  let final = "";
  let error: string | undefined;
  while (Date.now() < deadline) {
    const j = await p2.evaluate((id) => {
      const x = (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((y: any) => y.id === id);
      return { status: x?.status as string, error: x?.error as string | undefined, outputName: x?.outputName as string, progress: x?.progress as number, phase: x?.phase as string };
    }, jobId);
    if (Math.floor(Date.now() / 20_000) !== lastLog) {
      lastLog = Math.floor(Date.now() / 20_000);
      console.log(`[recovery export] retry ${j.status} progress ${((j.progress ?? 0) * 100).toFixed(1)}% ${j.phase ?? ""}`);
    }
    final = j.status;
    error = j.error;
    if (final === "completed" || final === "failed") {
      if (final === "completed") {
        // The editor is not open on the welcome page, so there is no queue panel: ask the store for the download.
        const [dl] = await Promise.all([p2.waitForEvent("download", { timeout: 60_000 }), p2.evaluate((id) => (window as any).__openreelE2E.exportQueue.getState().download(id), jobId)]);
        const file = join(workDir, "retried.mp4");
        await dl.saveAs(file);
        const probe = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", file], { encoding: "utf8" }));
        console.log(`[recovery export] retried output ${JSON.stringify(probe)}`);
        expect(Number(probe.format.duration)).toBeGreaterThan(59);
        expect(probe.streams.some((s: any) => s.codec_name === "h264" && s.width === 640)).toBe(true);
      }
      break;
    }
    await p2.waitForTimeout(500);
  }
  console.log(`[recovery export] retry -> ${final} ${error ?? ""}`);
  expect(final, error).toBe("completed");
});
