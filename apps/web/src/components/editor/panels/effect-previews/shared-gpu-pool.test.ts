import { afterEach, describe, expect, it, vi } from "vitest";
import { LaneSet, MAX_PREVIEW_LANES, SharedResourcePool } from "./shared-gpu-pool";

afterEach(() => {
  vi.useRealTimers();
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("LaneSet: a bounded number of GPU lanes", () => {
  it("never builds more lanes than its bound, however many slots ask", async () => {
    let live = 0;
    let peak = 0;
    const set = new LaneSet<{ id: number }>(
      async (index) => {
        live++;
        peak = Math.max(peak, live);
        return { id: index };
      },
      () => {
        live--;
      },
    );
    await Promise.all(Array.from({ length: 40 }, (_, slot) => set.run(slot, async (lane) => lane.id)));
    expect(set.laneCount).toBe(MAX_PREVIEW_LANES);
    expect(peak).toBe(MAX_PREVIEW_LANES);
    expect(live).toBe(MAX_PREVIEW_LANES);
  });

  it("serialises work on one lane so two preview engines never share its canvases in flight", async () => {
    const set = new LaneSet<object>(async () => ({}), () => undefined);
    let running = 0;
    let overlap = 0;
    const gate = deferred();
    const work = async () => {
      running++;
      overlap = Math.max(overlap, running);
      await gate.promise;
      running--;
    };
    // slots 0 and 2 land on the same lane (2 lanes)
    const first = set.run(0, work);
    const second = set.run(2, work);
    await Promise.resolve();
    gate.resolve();
    await Promise.all([first, second]);
    expect(overlap).toBe(1);
  });

  it("disposes every built lane exactly once and refuses further work", async () => {
    const disposed: number[] = [];
    const onDispose = vi.fn();
    const set = new LaneSet<{ id: number }>(async (index) => ({ id: index }), (lane) => disposed.push(lane.id), 2, onDispose);
    await set.run(0, async () => undefined);
    await set.run(1, async () => undefined);
    set.dispose();
    set.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(disposed.sort()).toEqual([0, 1]);
    expect(onDispose).toHaveBeenCalledTimes(1);
    await expect(set.run(0, async () => 1)).rejects.toThrow("renderer disposed");
  });

  it("keeps a failed lane build from wedging the lane's queue", async () => {
    let attempts = 0;
    const set = new LaneSet<object>(
      async () => {
        attempts++;
        if (attempts === 1) throw new Error("no gl");
        return {};
      },
      () => undefined,
    );
    await expect(set.run(0, async () => 1)).rejects.toThrow("no gl");
    await expect(set.run(0, async () => 2)).resolves.toBe(2);
  });
});

describe("SharedResourcePool: preview engines lease one set", () => {
  const make = () => {
    const built: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    const pool = new SharedResourcePool(() => {
      const resource = { dispose: vi.fn() };
      built.push(resource);
      return resource;
    }, 1000);
    return { pool, built };
  };

  it("builds once for any number of concurrent leases", () => {
    const { pool, built } = make();
    const leases = Array.from({ length: 12 }, () => pool.acquire());
    expect(built).toHaveLength(1);
    expect(new Set(leases.map((lease) => lease.resources)).size).toBe(1);
    expect(pool.stats().leases).toBe(12);
  });

  it("disposes after the idle grace when the last lease is released, not while another is held", () => {
    vi.useFakeTimers();
    const { pool, built } = make();
    const a = pool.acquire();
    const b = pool.acquire();
    a.release();
    vi.advanceTimersByTime(5000);
    expect(built[0].dispose).not.toHaveBeenCalled();
    b.release();
    b.release(); // idempotent
    vi.advanceTimersByTime(999);
    expect(built[0].dispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(built[0].dispose).toHaveBeenCalledTimes(1);
    expect(pool.stats()).toMatchObject({ leases: 0, live: false, builds: 1, disposals: 1 });
  });

  it("reuses the set when a panel remounts inside the grace (tab switches build nothing)", () => {
    vi.useFakeTimers();
    const { pool, built } = make();
    for (let i = 0; i < 20; i++) {
      const lease = pool.acquire();
      lease.release();
      vi.advanceTimersByTime(300);
    }
    expect(built).toHaveLength(1);
    expect(built[0].dispose).not.toHaveBeenCalled();
  });

  it("rebuilds after reset() (device loss) while leases stay valid, disposing the dead set", () => {
    const { pool, built } = make();
    const lease = pool.acquire();
    const before = lease.resources;
    pool.reset();
    expect(built[0].dispose).toHaveBeenCalledTimes(1);
    const after = lease.resources;
    expect(after).not.toBe(before);
    expect(built).toHaveLength(2);
  });

  it("stays bounded over many build/dispose cycles (every cycle disposes what it built)", () => {
    vi.useFakeTimers();
    const { pool, built } = make();
    for (let i = 0; i < 30; i++) {
      pool.acquire().release();
      vi.advanceTimersByTime(2000);
    }
    expect(built).toHaveLength(30);
    expect(built.every((resource) => resource.dispose.mock.calls.length === 1)).toBe(true);
    expect(pool.stats().live).toBe(false);
  });
});
