/**
 * Test rig for live plugin inserts: the real LiveChain and the real helper processes in this (main) thread, the real
 * LiveInsertDsp in a worker thread that plays the part of the AudioWorklet, a MessageChannel between them in place of the
 * worklet's MessagePort. What it does not include is Electron's own port hop; the Electron test covers that.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { MessageChannel, Worker } from "node:worker_threads";
import { LiveChain, type LiveChainOptions, type LiveOpenResult } from "../../src/main/plughost/live-chain";
import type { LiveInsertStats } from "../../../../packages/core/src/audio/native-plugin/live/live-insert-dsp";

const root = path.resolve(__dirname, "../../../..");
const require = createRequire(path.join(root, "package.json"));

let bundled: string | null = null;
/** Bundles worker.ts (TypeScript, imports core by relative path) into a temp CommonJS file once per process. */
export function workerBundle(): string {
  if (bundled && fs.existsSync(bundled)) return bundled;
  const pnpmDir = path.join(root, "node_modules/.pnpm");
  const esbuildDir = fs.readdirSync(pnpmDir).filter((name) => name.startsWith("esbuild@")).sort().pop();
  const { buildSync } = require(path.join(pnpmDir, esbuildDir!, "node_modules/esbuild"));
  // inside the (gitignored) desktop cache folder, not the system temp folder: one fixed file, rebuilt per process
  const dir = path.join(__dirname, "../../.cache/live-sim");
  fs.mkdirSync(dir, { recursive: true });
  const outfile = path.join(dir, `worker-${process.pid}.cjs`);
  process.once("exit", () => fs.rmSync(outfile, { force: true }));
  buildSync({ entryPoints: [path.join(__dirname, "worker.ts")], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "silent" });
  bundled = outfile;
  return outfile;
}

export interface SimOptions {
  readonly steps: LiveChainOptions["steps"];
  readonly blockFrames: 128 | 256 | 512;
  readonly input: Float32Array[];
  readonly record?: boolean;
  /** Fixed jitter buffer instead of the measured one. */
  readonly prefillBlocks?: number;
  readonly maxInFlight?: number;
  readonly blockTimeoutMs?: number;
  readonly headroomBlocks?: number;
  /** Runs while the stream plays, with the chain: change parameters, measure. */
  readonly during?: (chain: LiveChain, control: { elapsedMs: () => number }) => Promise<void>;
}

export interface SimResult {
  readonly open: LiveOpenResult;
  readonly prefillBlocks: number;
  readonly latencyFrames: number;
  readonly stats: LiveInsertStats;
  readonly chain: ReturnType<LiveChain["stats"]>;
  readonly rms: number[];
  readonly recorded: Float32Array[] | null;
  /** How late the audio thread's quanta started against the wall clock, nanoseconds (shared by all inserts of the run). */
  readonly lateNs: number[];
  readonly startNs: bigint;
  readonly hostFailed: string | null;
  readonly cpu: { readonly helperSeconds: number; readonly mainSeconds: number; readonly wallSeconds: number };
  readonly pids: number[];
}

/** Cumulative CPU seconds of a process (ps `cputime`: [[hh:]mm:]ss.ss). */
export function processCpuSeconds(pid: number): number {
  try {
    const text = execFileSync("/bin/ps", ["-o", "cputime=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return text.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
  } catch {
    return 0;
  }
}

/** One insert alone: the usual case of the tests. */
export async function runLiveSim(options: SimOptions & { readonly seconds: number; readonly sampleRate?: number }): Promise<SimResult> {
  return (await runLiveSims([options], options.seconds, options.sampleRate))[0];
}

/** Several inserts at once on ONE audio thread (like the worklets of a page), each with its own chain and helpers. */
export async function runLiveSims(inserts: readonly SimOptions[], seconds: number, sampleRateOption?: number): Promise<SimResult[]> {
  const sampleRate = sampleRateOption ?? 48000;
  const channels = inserts.map(() => new MessageChannel());
  const chains = inserts.map(
    (options, i) =>
      new LiveChain({
        steps: options.steps,
        sampleRate,
        blockFrames: options.blockFrames,
        ...(options.maxInFlight ? { maxInFlight: options.maxInFlight } : {}),
        ...(options.blockTimeoutMs ? { blockTimeoutMs: options.blockTimeoutMs } : {}),
        ...(options.headroomBlocks !== undefined ? { headroomBlocks: options.headroomBlocks } : {}),
        post: (message) => channels[i].port1.postMessage(message),
      }),
  );
  const opens = await Promise.all(chains.map((chain) => chain.open()));
  const prefills = inserts.map((options, i) => options.prefillBlocks ?? opens[i].prefillBlocks);
  const pids = chains.map((chain) => chain.pids);
  const cpu0 = pids.map((list) => list.map(processCpuSeconds));
  const main0 = process.cpuUsage();
  const wall0 = performance.now();
  const worker = new Worker(workerBundle(), {
    workerData: {
      inserts: inserts.map((options, i) => ({ port: channels[i].port2, blockFrames: options.blockFrames, prefillBlocks: prefills[i], pluginLatencyFrames: opens[i].pluginLatencyFrames, input: options.input, record: options.record ?? false })),
      seconds,
      sampleRate,
      quantum: 128,
    },
    transferList: channels.map((c) => c.port2),
  });
  const done = new Promise<Record<string, any>>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", (message) => resolve(message as Record<string, any>));
    channels.forEach((channel, i) => channel.port1.on("message", (message: any) => chains[i].onMessage(message)));
  });
  const during = Promise.all(inserts.map((options, i) => options.during?.(chains[i], { elapsedMs: () => performance.now() - wall0 })));
  const final = await done;
  await during;
  const wallSeconds = (performance.now() - wall0) / 1000;
  const main1 = process.cpuUsage(main0);
  const results: SimResult[] = inserts.map((_, i) => {
    const cpu1 = pids[i].map(processCpuSeconds);
    const chainStats = chains[i].stats();
    const mine = final.inserts[i];
    if (process.env.OPENREEL_LIVE_DEBUG) {
      const lates = (final.lateNs as number[]).map((n) => n / 1e6).sort((a, b) => a - b);
      console.log("[live-sim]", JSON.stringify({ insert: i, prefill: prefills[i], open: opens[i].roundTripMs, stats: mine.stats, chain: chainStats, workerLateMs: { p50: lates[Math.floor(lates.length / 2)], p99: lates[Math.floor(lates.length * 0.99)], max: lates[lates.length - 1] } }));
    }
    return {
      open: opens[i],
      prefillBlocks: prefills[i],
      latencyFrames: mine.latencyFrames,
      stats: mine.stats,
      chain: chainStats,
      rms: mine.rms,
      recorded: mine.recorded,
      lateNs: final.lateNs,
      startNs: BigInt(final.startNs),
      hostFailed: mine.hostFailed,
      cpu: { helperSeconds: cpu1.reduce((a, b, k) => a + (b - cpu0[i][k]), 0), mainSeconds: (main1.user + main1.system) / 1e6 / inserts.length, wallSeconds },
      pids: pids[i],
    };
  });
  for (const chain of chains) chain.dispose();
  for (const channel of channels) channel.port1.close();
  await worker.terminate();
  return results;
}

export const burstInput = (frames: number, sampleRate = 48000): Float32Array[] => {
  const mk = (f: number) => Float32Array.from({ length: frames }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / sampleRate));
  return [mk(440), mk(660)];
};

export const noiseInput = (frames: number, seed = 7): Float32Array[] =>
  [0, 1].map((ch) => {
    let s = seed + ch * 1000;
    return Float32Array.from({ length: frames }, () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return ((s >>> 8) / 16777216 - 0.5) * 0.8;
    });
  });
