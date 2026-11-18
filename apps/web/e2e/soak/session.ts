import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";

/** Scripted editor interactions with in-page timing. Everything goes through the live stores/hook. */

const PROGRAM = 'canvas[aria-label^="Program frame"]';

export interface ScrubResult {
  times: number[];
  latencyMs: number[];
  timedOut: number;
}

/**
 * Scrub latency: from seekTo(t) until the Program monitor shows a picture that no longer changes (the
 * exact frame landed). The picture is read as the user sees it (a compositor screenshot of the canvas
 * element), because the preview canvas is GPU-backed and cannot be read back from script reliably.
 * Resolution is one screenshot (~30-80 ms); a seek whose picture does not change within 900 ms
 * (same frame as before) is reported as 0 and skipped by the caller.
 */
export async function scrub(page: Page, targets: number[]): Promise<ScrubResult> {
  const canvas = page.locator(PROGRAM);
  const shot = async (): Promise<string> =>
    createHash("md5").update(await canvas.screenshot({ type: "jpeg", quality: 40, animations: "disabled", caret: "initial" })).digest("hex");
  const latency: number[] = [];
  let timedOut = 0;
  for (const t of targets) {
    const before = await shot();
    const start = Date.now();
    await page.evaluate((time) => (window as any).__openreelE2E.timeline.getState().seekTo(time), t);
    let last = before;
    let lastChange = start;
    let changed = false;
    for (;;) {
      const h = await shot();
      const now = Date.now();
      if (h !== last) {
        last = h;
        lastChange = now;
        changed = true;
      }
      if ((changed && now - lastChange > 300) || (!changed && now - start > 900)) break;
      if (now - start > 8000) {
        timedOut++;
        break;
      }
    }
    latency.push(changed ? lastChange - start : 0);
  }
  return { times: targets, latencyMs: latency, timedOut };
}

export interface PlaybackResult {
  wallSeconds: number;
  advancedSeconds: number;
  frames: number;
  dropped25ms: number;
  dropped50ms: number;
  maxFrameMs: number;
  p95FrameMs: number;
  longTasks: number;
  longTaskMs: number;
  /** Longest time the playhead did not move while playing, and where on the timeline it stood. */
  maxFlatMs?: number;
  flatAtSeconds?: number;
}

/** Play for `seconds` from the current playhead; rAF cadence + long tasks measure frame drops. */
export async function playFor(page: Page, seconds: number): Promise<PlaybackResult> {
  return page.evaluate(async (seconds) => {
    const E = (window as any).__openreelE2E;
    const tl = E.timeline.getState();
    const dts: number[] = [];
    let longTasks = 0;
    let longTaskMs = 0;
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTasks++;
        longTaskMs += e.duration;
      }
    });
    try {
      po.observe({ entryTypes: ["longtask"] });
    } catch {
      /* unsupported */
    }
    const p0 = E.timeline.getState().playheadPosition;
    const t0 = performance.now();
    let prev = t0;
    let running = true;
    const tick = (now: number) => {
      dts.push(now - prev);
      prev = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    let lastPos = p0;
    let lastMove = performance.now();
    let maxFlat = 0;
    let flatAt = p0;
    const watch = setInterval(() => {
      const pos = E.timeline.getState().playheadPosition;
      const now = performance.now();
      if (pos !== lastPos) {
        lastPos = pos;
        lastMove = now;
      } else if (now - lastMove > maxFlat) {
        maxFlat = now - lastMove;
        flatAt = pos;
      }
    }, 250);
    tl.play();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    clearInterval(watch);
    E.timeline.getState().pause();
    running = false;
    const wall = (performance.now() - t0) / 1000;
    const p1 = E.timeline.getState().playheadPosition;
    po.disconnect();
    const sorted = [...dts].sort((a, b) => a - b);
    return {
      wallSeconds: wall,
      advancedSeconds: p1 - p0,
      frames: dts.length,
      dropped25ms: dts.filter((d) => d > 25).length,
      dropped50ms: dts.filter((d) => d > 50).length,
      maxFrameMs: sorted[sorted.length - 1] ?? 0,
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      longTasks,
      longTaskMs,
      maxFlatMs: Math.round(maxFlat),
      flatAtSeconds: Math.round(flatAt * 100) / 100,
    };
  }, seconds);
}

/** Hash of the state the edit loop must restore exactly on undo (track/clip geometry + effect counts). */
export async function stateDigest(page: Page): Promise<string> {
  return page.evaluate(() => {
    const p = (window as any).__openreelE2E.project.getState().project;
    let h = 5381;
    const mix = (s: string) => {
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    };
    for (const t of p.timeline.tracks) {
      mix(t.id);
      for (const c of [...t.clips].sort((x: any, y: any) => (x.id < y.id ? -1 : 1))) {
        mix(`${c.id}|${c.startTime.toFixed(4)}|${c.duration.toFixed(4)}|${c.inPoint.toFixed(4)}|${c.outPoint.toFixed(4)}|${c.effects?.length ?? 0}|${c.volume}|${t.id}`);
      }
    }
    mix(String((p.timeline.subtitles ?? []).length));
    return `${p.timeline.tracks.reduce((n: number, t: any) => n + t.clips.length, 0)}:${h >>> 0}`;
  });
}

export interface EditBurstResult {
  steps: number;
  addedHistory: number;
  undoRestoredExactly: boolean;
  redoRestoredExactly: boolean;
  /** Which steps did not undo/redo to the digest recorded on the way in (edit index 0-based). */
  mismatches: string[];
  editMs: number[];
  undoMs: number[];
  redoMs: number[];
}

/**
 * Five different edits (move, trim, effect, split, volume) on random V1/A1 clips, each exactly one
 * undo step; then undo all five and check the state digest is bit-identical to the one before, redo
 * all five and check it matches the post-edit digest.
 */
export async function editBurst(page: Page, seed: number): Promise<EditBurstResult> {
  return page.evaluate(async (seed) => {
    const E = (window as any).__openreelE2E;
    const st = () => E.project.getState();
    let s = seed;
    const rnd = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const digest = () => {
      const p = st().project;
      let h = 5381;
      for (const t of p.timeline.tracks) {
        h = ((h << 5) + h + t.id.length) | 0;
        for (const c of [...t.clips].sort((x: any, y: any) => (x.id < y.id ? -1 : 1))) {
          const x = `${c.id}|${c.startTime.toFixed(4)}|${c.duration.toFixed(4)}|${c.inPoint.toFixed(4)}|${c.outPoint.toFixed(4)}|${c.effects?.length ?? 0}|${c.volume}|${t.id}`;
          for (let i = 0; i < x.length; i++) h = ((h << 5) + h + x.charCodeAt(i)) | 0;
        }
      }
      return `${p.timeline.tracks.reduce((n: number, t: any) => n + t.clips.length, 0)}:${h >>> 0}`;
    };
    const tracks = st().project.timeline.tracks;
    const pick = (type: string) => {
      const t = tracks.filter((x: any) => x.type === type && x.clips.length > 3);
      const tr = t[Math.floor(rnd() * t.length)];
      return tr.clips[Math.floor(rnd() * tr.clips.length)];
    };
    // The undo stack is capped (1000), so its size stops growing once full: count pushes by watching
    // the identity of the newest entry instead.
    const hist = () => st().actionExecutor.getHistory();
    let pushes = 0;
    let top = hist().peekUndo();
    const countPush = () => {
      const now = hist().peekUndo();
      if (now !== top) pushes++;
      top = now;
    };
    const before = digest();
    const editMs: number[] = [];
    const time = async (fn: () => Promise<unknown>) => {
      const a = performance.now();
      await fn();
      editMs.push(performance.now() - a);
    };
    const chain: string[] = [before];
    const names = ["move", "trim", "effect", "split", "volume"];
    const v = pick("video");
    await time(() => st().moveClip(v.id, v.startTime + 0.2));
    countPush();
    chain.push(digest());
    const v2 = pick("video");
    await time(() => st().trimClip(v2.id, v2.inPoint + 0.5, undefined));
    countPush();
    chain.push(digest());
    const v3 = pick("video");
    await time(() => st().addVideoEffect(v3.id, "gaussian-blur", { radius: 3 }));
    countPush();
    chain.push(digest());
    const v4 = pick("video");
    await time(() => st().splitClip(v4.id, v4.startTime + v4.duration / 2));
    countPush();
    chain.push(digest());
    const a = pick("audio");
    await time(() => st().executeAction({ type: "audio/setVolume", params: { clipId: a.id, volume: 0.6 } }));
    countPush();
    chain.push(digest());
    const added = pushes;
    const mismatches: string[] = [];
    const after = digest();
    const undoMs: number[] = [];
    const redoMs: number[] = [];
    for (let i = 0; i < added; i++) {
      const t = performance.now();
      await st().undo();
      undoMs.push(performance.now() - t);
      if (digest() !== chain[added - 1 - i]) mismatches.push(`undo of ${names[added - 1 - i]}`);
    }
    const undone = digest();
    for (let i = 0; i < added; i++) {
      const t = performance.now();
      await st().redo();
      redoMs.push(performance.now() - t);
      if (digest() !== chain[i + 1]) mismatches.push(`redo of ${names[i]}`);
    }
    const redone = digest();
    // Leave the project as it was: undo the five again (they stay on the redo stack, not the undo stack).
    for (let i = 0; i < added; i++) await st().undo();
    return {
      steps: 5,
      addedHistory: added,
      undoRestoredExactly: undone === before,
      redoRestoredExactly: redone === after,
      mismatches,
      editMs,
      undoMs,
      redoMs,
    };
  }, seed);
}

export interface AutosaveReport {
  forceSaveMs: number;
  records: Array<{ id: string; bytes: number; timestamp: number }>;
}

/** Read every auto-save record straight from IndexedDB (size + timestamp + parsed-ness of its JSON). */
export async function readAutosaveRecords(page: Page): Promise<Array<{ id: string; bytes: number; timestamp: number }>> {
  return page.evaluate(async () => {
    return new Promise<Array<{ id: string; bytes: number; timestamp: number }>>((resolve, reject) => {
      const open = indexedDB.open("openreel-autosave");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("autosaves")) {
          db.close();
          resolve([]);
          return;
        }
        const req = db.transaction("autosaves", "readonly").objectStore("autosaves").getAll();
        req.onsuccess = () => {
          resolve((req.result as Array<{ id: string; data: string; timestamp: number }>).map((r) => ({ id: r.id, bytes: r.data.length, timestamp: r.timestamp })));
          db.close();
        };
        req.onerror = () => reject(req.error);
      };
    });
  });
}

/** Force an auto-save, then read the IndexedDB records back to learn what was written. */
export async function autosaveNow(page: Page): Promise<AutosaveReport> {
  const forceSaveMs = await page.evaluate(async () => {
    const E = (window as any).__openreelE2E;
    const t = performance.now();
    await E.project.getState().forceSave();
    return performance.now() - t;
  });
  const records = await readAutosaveRecords(page);
  return { forceSaveMs, records };
}

/** Enqueue a short range export and wait for it; returns wall ms and the job's end state. */
export async function exportRange(page: Page, startTime: number, endTime: number, timeoutMs = 240_000): Promise<{ ms: number; status: string; error?: string }> {
  const t0 = Date.now();
  const id = await page.evaluate(
    (range) => {
      const q = (window as any).__openreelE2E.exportQueue.getState();
      const job = q.enqueue({ settings: { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000, range }, presetLabel: "Soak range" });
      q.start();
      return job?.id as string;
    },
    { startTime, endTime },
  );
  for (;;) {
    const j = await page.evaluate((jobId) => {
      const x = (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((y: any) => y.id === jobId);
      return { status: x?.status as string, error: x?.error as string | undefined };
    }, id);
    if (j.status === "completed" || j.status === "failed" || j.status === "cancelled") return { ms: Date.now() - t0, ...j };
    if (Date.now() - t0 > timeoutMs) return { ms: Date.now() - t0, status: "timeout" };
    await page.waitForTimeout(500);
  }
}
