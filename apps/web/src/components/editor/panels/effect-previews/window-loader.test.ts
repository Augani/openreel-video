import { describe, expect, it, vi } from "vitest";
import { partnerTimes, ProgressiveWindow, type PartnerFeed } from "./window-loader";

const bitmap = (id: number) => ({ id, close: vi.fn() }) as unknown as ImageBitmap & { id: number; close: ReturnType<typeof vi.fn> };
const idOf = (b: ImageBitmap | null): number | null => (b ? (b as unknown as { id: number }).id : null);

const makeWindow = (feed: PartnerFeed, count = 6) => {
  const times = Array.from({ length: count }, (_, i) => i / 12);
  const window = new ProgressiveWindow("k", "footage", times, 12, 8, 4, 0, feed);
  for (let i = 0; i < count; i++) window.put(i, bitmap(100 + i));
  return window;
};

describe("partnerTimes", () => {
  it("plays the incoming clip from its first frame at the window frame rate, never past its out point", () => {
    const times = partnerTimes({ mediaId: "b", mediaType: "video", time: 3, seconds: 0.25 }, 6, 12);
    expect(times[0]).toBe(3);
    expect(times[1]).toBeCloseTo(3 + 1 / 12, 6);
    expect(times[2]).toBeCloseTo(3 + 2 / 12, 6);
    for (const t of times.slice(3)) expect(t).toBeLessThan(3.25);
    expect(times[5]).toBe(times[4]);
  });
});

describe("ProgressiveWindow incoming shot", () => {
  it("decodes only the first incoming frame for the poster, and the rest only when hover asks", async () => {
    const first = bitmap(1);
    const rest = vi.fn(async (count: number, _fps: number, put: (i: number, b: ImageBitmap) => void) => {
      for (let i = 1; i < count; i++) put(i, bitmap(10 + i));
    });
    const window = makeWindow({ first: async () => first, rest });
    expect(await window.partner(0)).toBe(first);
    expect(await window.partner()).toBe(first);
    expect(rest).not.toHaveBeenCalled();
    expect(idOf(await window.partner(3))).toBe(13);
    expect(rest).toHaveBeenCalledTimes(1);
    // Each hover frame gets its own incoming frame: the incoming shot moves.
    const ids = await Promise.all([0, 1, 2, 3, 4, 5].map(async (i) => idOf(await window.partner(i))));
    expect(ids).toEqual([1, 11, 12, 13, 14, 15]);
    expect(rest).toHaveBeenCalledTimes(1);
  });

  it("repeats the last decoded incoming frame when the clip runs out, so the loop has no holes", async () => {
    const window = makeWindow({
      first: async () => bitmap(1),
      rest: async (_count, _fps, put) => {
        put(1, bitmap(11));
        put(2, bitmap(12));
      },
    });
    const ids = await Promise.all([0, 1, 2, 3, 5].map(async (i) => idOf(await window.partner(i))));
    expect(ids).toEqual([1, 11, 12, 12, 12]);
  });

  it("keeps showing the first incoming frame when the incoming frames cannot be decoded", async () => {
    const window = makeWindow({
      first: async () => bitmap(1),
      rest: async () => {
        throw new Error("decode failed");
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(idOf(await window.partner(4))).toBe(1);
    warn.mockRestore();
  });

  it("holds one still incoming shot for every frame when the feed has no motion (image, sample scene)", async () => {
    const still = bitmap(7);
    const window = makeWindow({ first: async () => still });
    expect(await window.partner(4)).toBe(still);
    expect(await window.partner(0)).toBe(still);
  });

  it("closes every incoming frame on dispose, and frames that land afterwards", async () => {
    let put!: (i: number, b: ImageBitmap) => void;
    let finish!: () => void;
    const first = bitmap(1);
    const window = makeWindow({
      first: async () => first,
      rest: (_count, _fps, p) => {
        put = p;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    });
    const pending = window.partner(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const early = bitmap(11);
    put(1, early);
    window.dispose();
    const late = bitmap(12);
    put(2, late);
    finish();
    expect(await pending).toBeNull();
    expect(first.close).toHaveBeenCalled();
    expect(early.close).toHaveBeenCalled();
    expect(late.close).toHaveBeenCalled();
  });
});
