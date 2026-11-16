import type { CDPSession, Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Soak harness plumbing: opt-in (OPENREEL_SOAK=1), page-side resource probes, a memory sampler (JS
 * heap through CDP, process RSS through `ps`) and a least-squares drift estimator so a leak shows
 * up as a number (MB/min) instead of a hunch.
 */
export const SOAK = process.env.OPENREEL_SOAK === "1";
export const SOAK_MINUTES = Number(process.env.SOAK_MINUTES ?? 30);
export const SOAK_CLIPS = Number(process.env.SOAK_CLIPS ?? 800);
export const SOAK_TIMELINE_MINUTES = Number(process.env.SOAK_TIMELINE_MINUTES ?? 100);
export const SOAK_MEDIA_DIR = process.env.SOAK_MEDIA_DIR ?? join(tmpdir(), "openreel-soak-media");
export const SOAK_OUT = process.env.SOAK_OUT ?? join(tmpdir(), "openreel-soak-out");
export const SOAK_SAMPLE_MS = Number(process.env.SOAK_SAMPLE_MS ?? 15_000);

export interface MediaManifestEntry {
  name: string;
  file: string;
  w: number;
  h: number;
  fps: number;
  seconds: number;
  bytes: number;
  codec: string;
  desktopOnly?: boolean;
  note: string;
}

export function readManifest(dir = SOAK_MEDIA_DIR): MediaManifestEntry[] {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) throw new Error(`no soak media at ${dir}: run node apps/web/e2e/soak/gen-media.mjs ${dir}`);
  const all = JSON.parse(readFileSync(path, "utf8")) as MediaManifestEntry[];
  // SOAK_SOURCES=<regex on source name> narrows the library (e.g. '^(hd-|odd)' drops the 4K sources).
  return process.env.SOAK_SOURCES ? all.filter((m) => new RegExp(process.env.SOAK_SOURCES!).test(m.name)) : all;
}

export function writeOut(name: string, data: unknown): string {
  mkdirSync(SOAK_OUT, { recursive: true });
  const path = join(SOAK_OUT, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

/**
 * Installed with addInitScript BEFORE the app boots. Counts the resources that leak in editors:
 * decoded VideoFrames, ImageBitmaps, blob: URLs, Workers, AudioContexts / nodes, OPFS handles.
 * `live` is created - released, so a leak is a counter that keeps rising while the editor is idle or
 * a scripted loop repeats the same work. Frames dropped by the GC without close() are counted by the
 * browser too (console warning), which we also tally.
 */
export function installProbes(): void {
  const w = window as unknown as Record<string, any>;
  const c = {
    videoFrameOut: 0,
    videoFrameClosed: 0,
    videoFrameCtor: 0,
    videoFrameClone: 0,
    bitmapCreated: 0,
    bitmapClosed: 0,
    blobUrlCreated: 0,
    blobUrlRevoked: 0,
    workersCreated: 0,
    workersTerminated: 0,
    audioContexts: 0,
    audioContextsClosed: 0,
    offlineContexts: 0,
    audioNodesCreated: 0,
    audioNodesDisconnected: 0,
    syncHandles: 0,
    syncHandlesClosed: 0,
    writables: 0,
    writablesClosed: 0,
    decodersOpen: 0,
    decodersClosed: 0,
    encodersOpen: 0,
    encodersClosed: 0,
    gcFrameWarnings: 0,
  };
  w.__soak = c;
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && /VideoFrame was garbage collected|garbage collected without being closed/.test(args[0])) c.gcFrameWarnings++;
    origWarn(...args);
  };

  const VF = w.VideoFrame;
  if (VF) {
    const closeProto = VF.prototype.close;
    VF.prototype.close = function (this: any) {
      if (this.format !== null) c.videoFrameClosed++;
      return closeProto.call(this);
    };
    const cloneProto = VF.prototype.clone;
    VF.prototype.clone = function (this: any) {
      c.videoFrameClone++;
      return cloneProto.call(this);
    };
    w.VideoFrame = new Proxy(VF, {
      construct(target, args, newTarget) {
        c.videoFrameCtor++;
        return Reflect.construct(target, args, newTarget);
      },
    });
  }
  const VD = w.VideoDecoder;
  if (VD) {
    w.VideoDecoder = new Proxy(VD, {
      construct(target, args, newTarget) {
        const init = args[0] ?? {};
        const output = init.output;
        const wrapped = { ...init, output: (f: unknown) => { c.videoFrameOut++; return output(f); } };
        c.decodersOpen++;
        const dec = Reflect.construct(target, [wrapped], newTarget);
        const close = dec.close.bind(dec);
        dec.close = () => { if (dec.state !== "closed") c.decodersClosed++; return close(); };
        return dec;
      },
    });
  }
  const VE = w.VideoEncoder;
  if (VE) {
    w.VideoEncoder = new Proxy(VE, {
      construct(target, args, newTarget) {
        c.encodersOpen++;
        const enc = Reflect.construct(target, args, newTarget);
        const close = enc.close.bind(enc);
        enc.close = () => { if (enc.state !== "closed") c.encodersClosed++; return close(); };
        return enc;
      },
    });
  }
  const cib = w.createImageBitmap?.bind(w);
  if (cib) {
    w.createImageBitmap = (...args: unknown[]) => {
      c.bitmapCreated++;
      return cib(...args);
    };
    const IB = w.ImageBitmap;
    if (IB) {
      const closeBm = IB.prototype.close;
      IB.prototype.close = function (this: any) {
        c.bitmapClosed++;
        return closeBm.call(this);
      };
    }
  }
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (o: Blob | MediaSource) => { c.blobUrlCreated++; return create(o); };
  URL.revokeObjectURL = (u: string) => { c.blobUrlRevoked++; return revoke(u); };

  const W = w.Worker;
  if (W) {
    w.Worker = new Proxy(W, {
      construct(target, args, newTarget) {
        c.workersCreated++;
        const worker = Reflect.construct(target, args, newTarget);
        const term = worker.terminate.bind(worker);
        let done = false;
        worker.terminate = () => { if (!done) { done = true; c.workersTerminated++; } return term(); };
        return worker;
      },
    });
  }
  for (const name of ["AudioContext", "OfflineAudioContext"] as const) {
    const AC = w[name];
    if (!AC) continue;
    w[name] = new Proxy(AC, {
      construct(target, args, newTarget) {
        // OfflineAudioContexts cannot be closed and are collected with their graph: not a "live" resource.
        if (name === "AudioContext") c.audioContexts++;
        else c.offlineContexts++;
        const ctx = Reflect.construct(target, args, newTarget);
        const close = ctx.close?.bind(ctx);
        if (close) {
          let done = false;
          ctx.close = () => { if (!done) { done = true; c.audioContextsClosed++; } return close(); };
        }
        return ctx;
      },
    });
  }
  const BAC = w.BaseAudioContext?.prototype;
  if (BAC) {
    for (const key of Object.getOwnPropertyNames(BAC)) {
      if (!/^create(?!Buffer$|PeriodicWave$)/.test(key) || typeof BAC[key] !== "function") continue;
      const orig = BAC[key];
      BAC[key] = function (this: unknown, ...args: unknown[]) {
        c.audioNodesCreated++;
        return orig.apply(this, args);
      };
    }
    const AN = w.AudioNode?.prototype;
    if (AN) {
      const disc = AN.disconnect;
      AN.disconnect = function (this: unknown, ...args: unknown[]) {
        if (args.length === 0) c.audioNodesDisconnected++;
        return disc.apply(this, args);
      };
    }
  }
  const FH = w.FileSystemFileHandle?.prototype;
  if (FH?.createSyncAccessHandle) {
    const orig = FH.createSyncAccessHandle;
    FH.createSyncAccessHandle = async function (this: unknown, ...a: unknown[]) {
      const h = await orig.apply(this, a);
      c.syncHandles++;
      const close = h.close.bind(h);
      h.close = () => { c.syncHandlesClosed++; return close(); };
      return h;
    };
  }
  if (FH?.createWritable) {
    const orig = FH.createWritable;
    FH.createWritable = async function (this: unknown, ...a: unknown[]) {
      const s = await orig.apply(this, a);
      c.writables++;
      const close = s.close.bind(s);
      s.close = () => { c.writablesClosed++; return close(); };
      const abort = s.abort.bind(s);
      s.abort = (...x: unknown[]) => { c.writablesClosed++; return abort(...x); };
      return s;
    };
  }
}

export interface Counters {
  [key: string]: number;
}
export interface Sample {
  tMin: number;
  phase: string;
  /** Taken right after a full garbage collection: only these are comparable for leak drift. */
  gc: boolean;
  jsHeapMB: number;
  jsHeapTotalMB: number;
  domNodes: number;
  listeners: number;
  documents: number;
  rssMB: number;
  rendererRssMB: number;
  gpuRssMB: number;
  processes: number;
  live: Record<string, number>;
  undoDepth: number;
  undoBytesApprox: number;
  counters: Counters;
}

interface ProcRow {
  pid: number;
  ppid: number;
  rssKB: number;
  command: string;
}

function psTable(): ProcRow[] {
  const out = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], { encoding: "utf8", maxBuffer: 1 << 26 });
  const rows: ProcRow[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], rssKB: +m[3], command: m[4] });
  }
  return rows;
}

/** RSS of the Chrome this test worker launched (browser + renderers + GPU + utility), by process tree. */
export function browserProcessMemory(rootPid = process.pid): { totalMB: number; rendererMB: number; gpuMB: number; count: number } {
  const rows = psTable();
  const children = new Map<number, ProcRow[]>();
  for (const r of rows) (children.get(r.ppid) ?? children.set(r.ppid, []).get(r.ppid)!).push(r);
  const roots = (children.get(rootPid) ?? []).filter((r) => /Chrome|chrome|Chromium|Electron/.test(r.command));
  const all: ProcRow[] = [];
  const walk = (r: ProcRow) => {
    all.push(r);
    for (const k of children.get(r.pid) ?? []) walk(k);
  };
  roots.forEach(walk);
  const sum = (rs: ProcRow[]) => rs.reduce((n, r) => n + r.rssKB, 0) / 1024;
  return {
    totalMB: sum(all),
    rendererMB: sum(all.filter((r) => /--type=renderer/.test(r.command))),
    gpuMB: sum(all.filter((r) => /--type=gpu-process/.test(r.command))),
    count: all.length,
  };
}

/** PIDs of the renderer processes of the Chrome this worker launched (for `footprint`/`vmmap` breakdowns). */
export function browserRendererPids(rootPid = process.pid): number[] {
  const rows = psTable();
  const children = new Map<number, ProcRow[]>();
  for (const r of rows) (children.get(r.ppid) ?? children.set(r.ppid, []).get(r.ppid)!).push(r);
  const out: number[] = [];
  const walk = (r: ProcRow) => {
    if (/--type=renderer/.test(r.command)) out.push(r.pid);
    for (const k of children.get(r.pid) ?? []) walk(k);
  };
  for (const r of children.get(rootPid) ?? []) walk(r);
  return out;
}

/**
 * macOS `footprint` of the launched Chrome's renderers: dirty MB and the part of it that is
 * "reclaimable" (freed pages the kernel has not taken back yet; RSS counts them, the app no longer
 * uses them). `inUseMB` = dirty - reclaimable is the memory the page actually holds. Null off macOS.
 */
export function rendererFootprint(rootPid = process.pid): { dirtyMB: number; reclaimableMB: number; inUseMB: number } | null {
  if (process.platform !== "darwin") return null;
  let dirty = 0;
  let reclaimable = 0;
  const unit = (n: number, u: string): number => (u === "KB" ? n / 1024 : u === "GB" ? n * 1024 : u === "B" ? n / 1048576 : n);
  for (const pid of browserRendererPids(rootPid)) {
    try {
      const out = execFileSync("footprint", ["-p", String(pid)], { encoding: "utf8", maxBuffer: 1 << 24 });
      const total = /^\s*([\d.]+) (B|KB|MB|GB)\s+([\d.]+) (B|KB|MB|GB)\s+([\d.]+) (B|KB|MB|GB)\s+\d+\s+TOTAL/m.exec(out);
      if (total) {
        dirty += unit(+total[1], total[2]);
        reclaimable += unit(+total[5], total[6]);
      }
    } catch {
      // A renderer can exit between listing and sampling.
    }
  }
  return { dirtyMB: Math.round(dirty), reclaimableMB: Math.round(reclaimable), inUseMB: Math.round(dirty - reclaimable) };
}

/** Least-squares slope of y over minutes, in units per minute. */
export function slopePerMin(points: Array<{ t: number; y: number }>): number {
  const n = points.length;
  if (n < 3) return 0;
  const mx = points.reduce((s, p) => s + p.t, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - mx) * (p.y - my);
    den += (p.t - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Bytes the undo/redo history keeps alive that the live project does not already own: walks the
 * project first (marking everything it reaches), then the history entries counting only objects not
 * yet seen. Structural sharing between an inverse action and the project is therefore not counted
 * (JSON.stringify would count every reference). Approximate: 8 B per slot, 2 B per char, 40 B per object.
 */
export async function historyRetainedBytes(page: Page): Promise<{ entries: number; uniqueBytes: number; jsonBytes: number; objects: number }> {
  return page.evaluate(() => {
    const h = (window as any).__openreelE2E.project.getState();
    const seen = new WeakSet<object>();
    const walk = (root: unknown, count: boolean): { bytes: number; objects: number } => {
      let bytes = 0;
      let objects = 0;
      const stack: unknown[] = [root];
      while (stack.length) {
        const v = stack.pop();
        if (typeof v === "string") {
          if (count) bytes += v.length * 2;
          continue;
        }
        if (typeof v !== "object" || v === null) {
          if (count) bytes += 8;
          continue;
        }
        if (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) continue;
        if (seen.has(v as object)) continue;
        seen.add(v as object);
        if (count) {
          bytes += 40;
          objects++;
        }
        for (const k of Object.keys(v as object)) {
          if (count) bytes += 8 + k.length * 2;
          stack.push((v as Record<string, unknown>)[k]);
        }
      }
      return { bytes, objects };
    };
    walk(h.project, false);
    const history = h.actionExecutor.getHistory();
    const entries = [...history.getHistoryEntries(), ...history.getRedoEntries()];
    let total = 0;
    let objs = 0;
    for (const e of entries) {
      const r = walk(e, true);
      total += r.bytes;
      objs += r.objects;
    }
    let json = 0;
    try {
      json = JSON.stringify(entries).length;
    } catch {
      json = -1;
    }
    return { entries: entries.length, uniqueBytes: total, jsonBytes: json, objects: objs };
  });
}

export class Sampler {
  readonly samples: Sample[] = [];
  phase = "setup";
  private timer: NodeJS.Timeout | null = null;
  private t0 = Date.now();

  constructor(
    private page: Page,
    private cdp: CDPSession,
  ) {}

  async sample(forceGc = false): Promise<Sample> {
    if (forceGc) {
      // A leak is what survives a full collection; a garbage-heavy but healthy session does not.
      await this.cdp.send("HeapProfiler.collectGarbage").catch(() => undefined);
    }
    const m = await this.cdp.send("Performance.getMetrics");
    const get = (name: string) => m.metrics.find((x) => x.name === name)?.value ?? 0;
    const page = await this.page.evaluate(() => {
      const e = (window as unknown as { __openreelE2E?: any; __soak?: Record<string, number> });
      const c = { ...(e.__soak ?? {}) };
      const history = e.__openreelE2E?.project.getState().actionExecutor.getHistory();
      let bytes = 0;
      let depth = 0;
      try {
        depth = history?.getUndoStackSize?.() ?? 0;
        // Retained size is measured separately (historyRetainedBytes) at phase boundaries.
        bytes = 0;
      } catch {
        bytes = -1;
      }
      return { c, depth, bytes };
    });
    const mem = browserProcessMemory();
    const c = page.c;
    const s: Sample = {
      tMin: (Date.now() - this.t0) / 60_000,
      phase: this.phase,
      gc: forceGc,
      jsHeapMB: get("JSHeapUsedSize") / 1048576,
      jsHeapTotalMB: get("JSHeapTotalSize") / 1048576,
      domNodes: get("Nodes"),
      listeners: get("JSEventListeners"),
      documents: get("Documents"),
      rssMB: mem.totalMB,
      rendererRssMB: mem.rendererMB,
      gpuRssMB: mem.gpuMB,
      processes: mem.count,
      live: {
        videoFrames: (c.videoFrameOut ?? 0) + (c.videoFrameCtor ?? 0) + (c.videoFrameClone ?? 0) - (c.videoFrameClosed ?? 0),
        bitmaps: (c.bitmapCreated ?? 0) - (c.bitmapClosed ?? 0),
        blobUrls: (c.blobUrlCreated ?? 0) - (c.blobUrlRevoked ?? 0),
        workers: (c.workersCreated ?? 0) - (c.workersTerminated ?? 0),
        audioContexts: (c.audioContexts ?? 0) - (c.audioContextsClosed ?? 0),
        audioNodesNetCreated: (c.audioNodesCreated ?? 0) - (c.audioNodesDisconnected ?? 0),
        decoders: (c.decodersOpen ?? 0) - (c.decodersClosed ?? 0),
        encoders: (c.encodersOpen ?? 0) - (c.encodersClosed ?? 0),
        syncHandles: (c.syncHandles ?? 0) - (c.syncHandlesClosed ?? 0),
        writables: (c.writables ?? 0) - (c.writablesClosed ?? 0),
      },
      undoDepth: page.depth,
      undoBytesApprox: page.bytes,
      counters: c,
    };
    this.samples.push(s);
    return s;
  }

  start(everyMs = SOAK_SAMPLE_MS): void {
    this.timer = setInterval(() => void this.sample().catch(() => undefined), everyMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Drift over [from, to] of samples taken at the same editor state (after a GC), MB per minute. */
  drift(key: "jsHeapMB" | "rssMB" | "rendererRssMB", phase?: string): number {
    const pts = this.samples.filter((s) => s.gc && (!phase || s.phase === phase)).map((s) => ({ t: s.tMin, y: s[key] }));
    return slopePerMin(pts);
  }
}

/** Percentile of a numeric list. */
export function pct(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Chrome memory-infra: the processes with the biggest dumps and their largest allocators. */
export interface InfraTop { t: number; pid: number; processTotalMB: number; top: Array<{ name: string; mb: number }> }
export function peakAllocators(events: any[]): InfraTop[] {
  const out: InfraTop[] = [];
  const mb = (v: unknown): number => (typeof v === "string" ? parseInt(v, 16) : Number(v)) / 1048576;
  for (const e of events) {
    if (e.ph !== "v" || !e.args?.dumps?.allocators) continue;
    const a = e.args.dumps.allocators as Record<string, { attrs?: Record<string, { value: string }> }>;
    const all = Object.entries(a).map(([name, v]) => ({ name, mb: mb(v.attrs?.effective_size?.value ?? v.attrs?.size?.value ?? 0) }));
    const rows = all.filter((r) => r.mb > 8 && r.name.split("/").length <= 4);
    const total = all.filter((r) => !r.name.includes("/")).reduce((n, r) => n + r.mb, 0);
    out.push({ t: e.ts / 1e6, pid: e.pid, processTotalMB: Math.round(total), top: rows.sort((x, y) => y.mb - x.mb).slice(0, 18).map((r) => ({ name: r.name, mb: Math.round(r.mb) })) });
  }
  return out.sort((x, y) => y.processTotalMB - x.processTotalMB).slice(0, 4);
}


/** Starts Chrome memory-infra dumps (partition_alloc, blink, v8, media, gpu) every 3 s on the browser the page runs in. */
export async function startMemoryInfra(browser: { newBrowserCDPSession(): Promise<CDPSession> }): Promise<{ stop(): Promise<InfraTop[]>; dumpNow(): Promise<void> }> {
  const events: any[] = [];
  const cdp = await browser.newBrowserCDPSession();
  cdp.on("Tracing.dataCollected", (m: any) => events.push(...m.value));
  await cdp.send("Tracing.start", {
    traceConfig: {
      includedCategories: ["disabled-by-default-memory-infra"],
      memoryDumpConfig: { triggers: [{ mode: "detailed", periodicIntervalMs: 3000 }] },
    },
  } as never);
  return {
    /** An immediate detailed dump of every process (the periodic ones can miss a short spike). */
    async dumpNow() {
      await cdp.send("Tracing.requestMemoryDump", { deterministic: true, levelOfDetail: "detailed" } as never).catch(() => undefined);
    },
    async stop() {
      const done = new Promise<void>((r) => cdp.once("Tracing.tracingComplete", () => r()));
      await cdp.send("Tracing.end");
      await done;
      return peakAllocators(events);
    },
  };
}
