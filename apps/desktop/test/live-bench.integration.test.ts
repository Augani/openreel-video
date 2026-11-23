/**
 * The live insert benchmark: 4 live inserts (AUDelay, AULowpass, AUPeakLimiter, AUMultibandCompressor, each with its own helper
 * process and chain) on ONE audio thread for 60 s while the machine is loaded with CPU burners, reporting underruns, the CPU each
 * insert costs, the round trips and how late the audio thread itself was scheduled.
 *
 * Opt in (it takes a minute and loads the machine):  OPENREEL_LIVE_BENCH=1 OPENREEL_LIVE_LOG_DIR=<dir> pnpm --filter @openreel/desktop exec vitest run test/live-bench.integration.test.ts
 * Needs macOS and the built Swift helper.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LiveStepConfig } from "../src/main/plughost/live-chain";
import { noiseInput, runLiveSims } from "./live-sim/live-sim";
import { SR } from "./live-sim/measure";

const HELPER = process.env.OPENREEL_PLUGHOST_PATH ?? path.resolve(__dirname, `../resources/plughost/darwin-${process.arch}/openreel-plughost`);
const enabled = process.env.OPENREEL_LIVE_BENCH === "1" && process.platform === "darwin" && existsSync(HELPER);
const d = enabled ? describe : describe.skip;
const LOG_DIR = process.env.OPENREEL_LIVE_LOG_DIR;
const SECONDS = Number(process.env.OPENREEL_LIVE_BENCH_SECONDS ?? 60);

const step = (pluginId: string, values: Record<string, number> = {}): LiveStepConfig => ({ pluginId, effectId: pluginId, values, automation: {}, spawn: { command: HELPER, args: ["serve"] } });
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))];

d("4 live inserts for 60 s under CPU load", () => {
  for (const blockFrames of [256, 128] as const) {
    it(`block size ${blockFrames}`, async () => {
      // one burner per two cores: a busy machine, not a starved one
      const burners = Array.from({ length: Math.max(2, Math.floor(os.cpus().length / 2)) }, () => spawn(process.execPath, ["-e", "for(;;){Math.sqrt(Math.random())}"], { stdio: "ignore" }));
      const inserts = [
        { name: "AUDelay", steps: [step("au:aufx:dely:appl", { "0": 40, "1": 0.3, "2": 30 })] },
        { name: "AULowpass", steps: [step("au:aufx:lpas:appl", { "0": 3000, "1": 4 })] },
        { name: "AUPeakLimiter", steps: [step("au:aufx:lmtr:appl", { "2": 6 })] },
        { name: "AUMultibandCompressor", steps: [step("au:aufx:mcmp:appl", { "0": 3 })] },
      ];
      try {
        const results = await runLiveSims(
          inserts.map((insert, i) => ({ steps: insert.steps, blockFrames, input: noiseInput(SR * 10, 3 + i) })),
          SECONDS,
        );
        const lateMs = results[0].lateNs.map((n) => n / 1e6);
        const report = {
          seconds: SECONDS,
          blockFrames,
          cpuBurners: burners.length,
          cores: os.cpus().length,
          audioThreadLateMs: { p50: quantile(lateMs, 0.5), p99: quantile(lateMs, 0.99), p999: quantile(lateMs, 0.999), max: Math.max(...lateMs) },
          inserts: results.map((r, i) => ({
            insert: inserts[i].name,
            prefillBlocks: r.prefillBlocks,
            latencyMs: (r.latencyFrames / SR) * 1000,
            underruns: r.stats.underruns,
            lateBlocks: r.stats.lateBlocks,
            blocksSent: r.stats.blocksSent,
            underrunPercent: (100 * r.stats.underruns) / Math.max(1, r.stats.blocksSent),
            queued: r.chain.queued,
            dropped: r.chain.dropped,
            roundTripMs: r.chain.roundTripMs,
            helperCpuPercentOfOneCore: (100 * r.cpu.helperSeconds) / r.cpu.wallSeconds,
            mainThreadCpuPercentOfOneCore: (100 * r.cpu.mainSeconds) / r.cpu.wallSeconds,
            failed: r.chain.failed,
          })),
        };
        console.log(`[live-metric] bench-${blockFrames} ${JSON.stringify(report)}`);
        if (LOG_DIR) {
          mkdirSync(LOG_DIR, { recursive: true });
          writeFileSync(path.join(LOG_DIR, `bench-${blockFrames}.json`), JSON.stringify(report, null, 2));
        }
        for (const insert of report.inserts) expect(insert.failed).toBeNull();
      } finally {
        for (const burner of burners) burner.kill("SIGKILL");
      }
    }, (SECONDS + 60) * 1000);
  }
});
