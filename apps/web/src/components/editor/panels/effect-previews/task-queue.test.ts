import { describe, expect, it, vi } from "vitest";
import { PriorityTaskQueue, TaskCancelledError, whenIdle } from "./task-queue";

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe("PriorityTaskQueue", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    const queue = new PriorityTaskQueue(2);
    const gates = Array.from({ length: 6 }, gate);
    let running = 0;
    let peak = 0;
    const results = gates.map((g, index) =>
      queue.enqueue({
        priority: "poster",
        run: async () => {
          running++;
          peak = Math.max(peak, running);
          await g.promise;
          running--;
          return index;
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.running).toBe(2);
    expect(queue.queued).toBe(4);
    for (const g of gates) {
      g.release();
      await Promise.resolve();
    }
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    expect(queue.peakRunning).toBe(2);
  });

  it("runs hover work before queued poster work, FIFO within a priority", async () => {
    const queue = new PriorityTaskQueue(1);
    const first = gate();
    const order: string[] = [];
    const run = (label: string, priority: "hover" | "poster", wait?: Promise<void>) =>
      queue.enqueue({
        priority,
        run: async () => {
          await wait;
          order.push(label);
        },
      });
    const blocker = run("blocker", "poster", first.promise);
    const p1 = run("poster-1", "poster");
    const p2 = run("poster-2", "poster");
    const h1 = run("hover-1", "hover");
    const h2 = run("hover-2", "hover");
    first.release();
    await Promise.all([blocker, p1, p2, h1, h2]);
    expect(order).toEqual(["blocker", "hover-1", "hover-2", "poster-1", "poster-2"]);
  });

  it("gives each concurrent task its own slot", async () => {
    const queue = new PriorityTaskQueue(2);
    const gates = [gate(), gate()];
    const slots: number[] = [];
    const tasks = gates.map((g) =>
      queue.enqueue({
        priority: "poster",
        run: async (slot) => {
          slots.push(slot);
          await g.promise;
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(new Set(slots).size).toBe(2);
    gates.forEach((g) => g.release());
    await Promise.all(tasks);
  });

  it("a queued task whose signal aborts never starts", async () => {
    const queue = new PriorityTaskQueue(1);
    const hold = gate();
    const abort = new AbortController();
    let started = false;
    const blocker = queue.enqueue({ priority: "poster", run: () => hold.promise });
    const cancelled = queue.enqueue({
      priority: "hover",
      signal: abort.signal,
      run: async () => {
        started = true;
      },
    });
    abort.abort();
    await expect(cancelled).rejects.toBeInstanceOf(TaskCancelledError);
    hold.release();
    await blocker;
    expect(started).toBe(false);
  });

  it("dispose rejects everything still queued", async () => {
    const queue = new PriorityTaskQueue(1);
    const hold = gate();
    const running = queue.enqueue({ priority: "poster", run: () => hold.promise });
    const queued = queue.enqueue({ priority: "poster", run: async () => 1 });
    await new Promise((resolve) => setTimeout(resolve, 0)); // the first task has started
    queue.dispose();
    await expect(queued).rejects.toBeInstanceOf(TaskCancelledError);
    hold.release();
    await running;
    await expect(queue.enqueue({ priority: "poster", run: async () => 1 })).rejects.toBeInstanceOf(TaskCancelledError);
  });

  it("awaits beforeStart (the idle yield) before each task", async () => {
    const calls: string[] = [];
    const queue = new PriorityTaskQueue(1, async (priority) => {
      calls.push(`idle:${priority}`);
    });
    await queue.enqueue({ priority: "poster", run: async () => calls.push("run") });
    expect(calls).toEqual(["idle:poster", "run"]);
  });

  it("caps poster tasks below the overall lane count while hover tasks use every lane", async () => {
    const queue = new PriorityTaskQueue(3, undefined, 1);
    const gates = Array.from({ length: 4 }, gate);
    let running = 0;
    let peakPosters = 0;
    const results = gates.map((g) =>
      queue.enqueue({
        priority: "poster",
        run: async () => {
          running++;
          peakPosters = Math.max(peakPosters, running);
          await g.promise;
          running--;
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(queue.running).toBe(1);
    // A hover task is not held back by the poster cap.
    await expect(queue.enqueue({ priority: "hover", run: async () => "hover" })).resolves.toBe("hover");
    gates.forEach((g) => g.release());
    await Promise.all(results);
    expect(peakPosters).toBe(1);
  });

  it("pause() stops new tasks from starting until resume()", async () => {
    const queue = new PriorityTaskQueue(2);
    queue.pause();
    const started = vi.fn();
    const result = queue.enqueue({ priority: "poster", run: async () => started() });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).not.toHaveBeenCalled();
    expect(queue.queued).toBe(1);
    queue.resume();
    await result;
    expect(started).toHaveBeenCalledTimes(1);
  });
});

describe("whenIdle", () => {
  it("waits for an idle period with enough time left, then resolves", async () => {
    const remaining = [2, 2, 30];
    const idle = vi.fn((cb: (deadline: { timeRemaining(): number }) => void) => {
      setTimeout(() => cb({ timeRemaining: () => remaining.shift() ?? 30 }), 0);
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    try {
      await whenIdle(1000, 8);
      expect(idle).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives up after the timeout so work is never starved", async () => {
    vi.stubGlobal("requestIdleCallback", (cb: (deadline: { timeRemaining(): number }) => void) => {
      setTimeout(() => cb({ timeRemaining: () => 0 }), 0);
      return 1;
    });
    try {
      await whenIdle(40, 8);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
