import { describe, expect, it } from "vitest";
import { detectScenes, type FrameLike } from "./scene-detection";

function solid(r: number, g: number, b: number): FrameLike {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width: 16, height: 16 };
}

describe("detectScenes review", () => {
  it("refines a hard cut to within one step after the true cut and never before it", async () => {
    const trueCut = 3.13;
    const result = await detectScenes({
      sampler: async (t) => (t < trueCut ? solid(200, 30, 30) : solid(20, 40, 220)),
      startTime: 0,
      endTime: 8,
      minSceneLength: 0.5,
    });
    expect(result.cuts).toHaveLength(1);
    const time = result.cuts[0].time;
    expect(time).toBeGreaterThanOrEqual(trueCut);
    expect(time - trueCut).toBeLessThanOrEqual(1 / 30 + 1e-9);
  });

  it("does not sample outside the requested source range", async () => {
    const calls: number[] = [];
    await detectScenes({
      sampler: async (t) => {
        calls.push(t);
        return solid(10, 10, 10);
      },
      startTime: 2,
      endTime: 4.3,
    });
    expect(Math.min(...calls)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...calls)).toBeLessThanOrEqual(4.3);
  });

  it("stops sampling promptly after abort", async () => {
    const controller = new AbortController();
    let count = 0;
    await expect(
      detectScenes({
        sampler: async () => {
          if (++count === 3) controller.abort();
          return solid(1, 2, 3);
        },
        startTime: 0,
        endTime: 20,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(count).toBe(3);
  });
});
