import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCanWriteProject,
  describeHolder,
  readOnlyReason,
  resetProjectLockForTests,
  retryProjectLock,
  trackProjectFile,
  useProjectLockStore,
} from "./project-lock";
import { LazyActionExecutor } from "./lazy-action-executor";
import { ActionHistory } from "@openreel/core";

const holder = { pid: 10, host: "mac", user: "sam", since: 1, heartbeatAt: 2, sameApp: false, sameHost: true };

function install(lock: (path: string) => Promise<unknown>, unlock = vi.fn(async (_path: string) => true)) {
  (window as unknown as { openreel: unknown }).openreel = { platform: "desktop", fs: { lockProject: lock, unlockProject: unlock } };
  return unlock;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => resetProjectLockForTests());
afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
  resetProjectLockForTests();
});

describe("project lock tracking", () => {
  it("stays editable when the lock is acquired", async () => {
    install(vi.fn(async () => ({ status: "acquired" })));
    trackProjectFile("/p/a.oreel");
    await flush();
    expect(useProjectLockStore.getState()).toMatchObject({ path: "/p/a.oreel", readOnly: false });
    expect(readOnlyReason()).toBeNull();
  });

  it("goes read-only when another window holds the project", async () => {
    install(vi.fn(async () => ({ status: "held", holder })));
    trackProjectFile("/p/a.oreel");
    await flush();
    expect(useProjectLockStore.getState().readOnly).toBe(true);
    expect(readOnlyReason()).toMatch(/read-only/);
    expect(describeHolder(holder)).toContain("sam");
  });

  it("stays editable when locking is unsupported, and when there is no desktop bridge", async () => {
    install(vi.fn(async () => ({ status: "unsupported", reason: "EROFS" })));
    trackProjectFile("/p/a.oreel");
    await flush();
    expect(readOnlyReason()).toBeNull();
    delete (window as unknown as { openreel?: unknown }).openreel;
    trackProjectFile("/p/b.oreel");
    await flush();
    expect(readOnlyReason()).toBeNull();
  });

  it("releases the previous lock when the project changes or closes, and clears read-only", async () => {
    const lock = vi.fn(async () => ({ status: "held", holder }));
    const unlock = install(lock);
    trackProjectFile("/p/a.oreel");
    await flush();
    trackProjectFile(null);
    expect(unlock).toHaveBeenCalledWith("/p/a.oreel");
    expect(readOnlyReason()).toBeNull();
  });

  it("Retry takes the lock once the other window is gone", async () => {
    const lock = vi.fn().mockResolvedValueOnce({ status: "held", holder }).mockResolvedValueOnce({ status: "acquired" });
    install(lock);
    trackProjectFile("/p/a.oreel");
    await flush();
    expect(useProjectLockStore.getState().readOnly).toBe(true);
    expect(await retryProjectLock()).toBe(true);
    expect(useProjectLockStore.getState().readOnly).toBe(false);
  });

  it("refuses Save As over a project another window has open", async () => {
    install(vi.fn(async () => ({ status: "held", holder })));
    await expect(assertCanWriteProject("/p/other.oreel")).rejects.toThrow(/is open in/);
  });

  it("refuses to save the file the window holds read-only", async () => {
    install(vi.fn(async () => ({ status: "held", holder })));
    trackProjectFile("/p/a.oreel");
    await flush();
    await expect(assertCanWriteProject("/p/a.oreel")).rejects.toThrow(/read-only/);
  });
});

describe("read-only editing", () => {
  it("refuses edit, undo and redo through the action executor", async () => {
    install(vi.fn(async () => ({ status: "held", holder })));
    trackProjectFile("/p/a.oreel");
    await flush();
    const executor = new LazyActionExecutor(new ActionHistory());
    const project = {} as never;
    const action = { id: "a", type: "clip/split", timestamp: 0, params: {} } as never;
    for (const result of [await executor.execute(action, project), await executor.undo(project), await executor.redo(project), ...(await executor.executeMany([action], project))]) {
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("READ_ONLY");
    }
  });
});
