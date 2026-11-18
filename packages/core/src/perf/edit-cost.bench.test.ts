import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import { buildBenchProject } from "./bench-project";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function time(label: string, runs: number, fn: (i: number) => Promise<void>): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    await fn(i);
    samples.push(performance.now() - start);
  }
  const m = median(samples);
  console.log(`[bench] ${label}: median ${m.toFixed(2)} ms over ${runs} runs`);
  return m;
}

describe("edit cost benchmark (8 tracks / 400 clips / 50 text / 2000 history)", () => {
  it("measures move, split and remove edits with a 2000 entry history", async () => {
    const project = buildBenchProject();
    const executor = new ActionExecutor();
    const warmStart = performance.now();
    for (let i = 0; i < 2000; i += 1) {
      await executor.execute({
        id: `warm-${i}`, type: "transform/update", timestamp: i,
        params: { clipId: `clip-${i % 400}`, transform: { opacity: 0.5 + (i % 5) / 10 } },
      }, project);
    }
    console.log(`[bench] 2000-entry history fill: ${(performance.now() - warmStart).toFixed(0)} ms`);
    const move = await time("clip/move", 15, async (i) => {
      await executor.execute({ id: `m-${i}`, type: "clip/move", timestamp: 1, params: { clipId: "clip-3", startTime: 18 + i * 0.001 } }, project);
    });
    const split = await time("clip/split", 15, async (i) => {
      const n = 10 + i * 7;
      await executor.execute({ id: `s-${i}`, type: "clip/split", timestamp: 1, params: { clipId: `clip-${n}`, time: (n % 50) * 6 + 2.5 } }, project);
    });
    const remove = await time("clip/remove", 15, async (i) => {
      await executor.execute({ id: `r-${i}`, type: "clip/remove", timestamp: 1, params: { clipId: `clip-${200 + i}` } }, project);
    });
    console.log(`[bench] SUMMARY move=${move.toFixed(2)} split=${split.toFixed(2)} remove=${remove.toFixed(2)}`);
    expect(move).toBeGreaterThan(0);
  }, 300_000);
});
