import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fsSync from "node:fs";
import { ProjectLocks, isStale, lockPathFor, parseLock, LOCAL_STALE_MS, REMOTE_STALE_MS, type LockInfo } from "../src/main/project-lock";

let dir: string;
let project: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "openreel-lock-"));
  project = path.join(dir, "Film.oreel");
  writeFileSync(project, "{}");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = (over: ConstructorParameters<typeof ProjectLocks>[0] = {}) => new ProjectLocks({ host: "mac", pid: process.pid, ...over });

describe("lock file location", () => {
  it("is a hidden sibling of the project", () => {
    expect(lockPathFor(project)).toBe(path.join(dir, ".Film.oreel.lock"));
  });
});

describe("isStale", () => {
  const info = (over: Partial<LockInfo> = {}): LockInfo => ({ owner: "a:1", instanceId: "a", pid: 4242, host: "mac", user: "me", startedAt: 0, heartbeatAt: 1000, ...over });
  it("same machine: a dead process is stale, a live one is not", () => {
    expect(isStale(info(), 2000, "mac", () => false)).toBe(true);
    expect(isStale(info(), 2000, "mac", () => true)).toBe(false);
    expect(isStale(info(), 1000 + LOCAL_STALE_MS + 1, "mac", () => true)).toBe(true);
  });
  it("another machine: only a stopped heartbeat makes it stale", () => {
    expect(isStale(info({ host: "other" }), 2000, "mac", () => false)).toBe(false);
    expect(isStale(info({ host: "other" }), 1000 + REMOTE_STALE_MS + 1, "mac", () => true)).toBe(true);
  });
});

describe("ProjectLocks", () => {
  it("grants the first opener and refuses a second instance, naming the holder", async () => {
    const first = make({ instanceId: "A" });
    const second = make({ instanceId: "B" });
    expect(await first.acquire(project, "A:1")).toEqual({ status: "acquired" });
    const result = await second.acquire(project, "B:1");
    expect(result.status).toBe("held");
    if (result.status === "held") {
      expect(result.holder.sameApp).toBe(false);
      expect(result.holder.pid).toBe(process.pid);
      expect(result.holder.sameHost).toBe(true);
    }
    await first.releaseOwner("A:1");
    expect(existsSync(lockPathFor(project))).toBe(false);
    expect(await second.acquire(project, "B:1")).toEqual({ status: "acquired" });
    await second.releaseOwner("B:1");
  });

  it("treats a second window of the same app as a conflict, and the same window as reentrant", async () => {
    const app = make({ instanceId: "A" });
    expect(await app.acquire(project, "A:1")).toEqual({ status: "acquired" });
    expect(await app.acquire(project, "A:1")).toEqual({ status: "acquired" });
    const other = await app.acquire(project, "A:2");
    expect(other.status).toBe("held");
    if (other.status === "held") expect(other.holder.sameApp).toBe(true);
    await app.releaseOwner("A:1");
  });

  it("takes over the lock of a crashed process", async () => {
    const crashed: LockInfo = { owner: "Z:1", instanceId: "Z", pid: 999999, host: "mac", user: "me", startedAt: 1, heartbeatAt: Date.now() };
    writeFileSync(lockPathFor(project), JSON.stringify(crashed));
    const locks = make({ instanceId: "A", pidAlive: () => false });
    expect(await locks.acquire(project, "A:1")).toEqual({ status: "acquired" });
    expect(parseLock(readFileSync(lockPathFor(project), "utf8"))?.owner).toBe("A:1");
    await locks.releaseOwner("A:1");
  });

  it("takes over a corrupt lock file once it is not brand new", async () => {
    writeFileSync(lockPathFor(project), "{not json");
    const old = new Date(Date.now() - 60_000);
    fsSync.utimesSync(lockPathFor(project), old, old);
    const locks = make({ instanceId: "A" });
    expect(await locks.acquire(project, "A:1")).toEqual({ status: "acquired" });
    await locks.releaseOwner("A:1");
  });

  it("does not delete a lock it does not own on release", async () => {
    const a = make({ instanceId: "A" });
    const b = make({ instanceId: "B" });
    await a.acquire(project, "A:1");
    expect(await b.release(project, "B:1")).toBe(false);
    expect(existsSync(lockPathFor(project))).toBe(true);
    await a.releaseOwner("A:1");
  });

  it("heartbeats refresh the lock, and stand down if the lock was taken over", async () => {
    let now = 1_000_000;
    const a = make({ instanceId: "A", now: () => now });
    await a.acquire(project, "A:1");
    now += 5000;
    await a.beat();
    expect(parseLock(readFileSync(lockPathFor(project), "utf8"))?.heartbeatAt).toBe(now);
    writeFileSync(lockPathFor(project), JSON.stringify({ owner: "B:1", instanceId: "B", pid: 1, host: "mac", user: "", startedAt: now, heartbeatAt: now }));
    await a.beat();
    expect(a.heldPaths()).toEqual([]);
    expect(parseLock(readFileSync(lockPathFor(project), "utf8"))?.owner).toBe("B:1");
  });

  it("reports unsupported (project stays editable) when the folder cannot hold a lock", async () => {
    const locks = make();
    const result = await locks.acquire(path.join(dir, "missing-folder", "x.oreel"), "A:1");
    expect(result.status).toBe("unsupported");
  });

  it("releases everything synchronously at exit", async () => {
    const a = make({ instanceId: "A" });
    await a.acquire(project, "A:1");
    a.releaseAllSync(fsSync);
    expect(existsSync(lockPathFor(project))).toBe(false);
  });

  it("lets exactly one of two racing openers win", async () => {
    const a = make({ instanceId: "A" });
    const b = make({ instanceId: "B" });
    const [ra, rb] = await Promise.all([a.acquire(project, "A:1"), b.acquire(project, "B:1")]);
    expect([ra.status, rb.status].sort()).toEqual(["acquired", "held"]);
    await a.releaseOwner("A:1");
    await b.releaseOwner("B:1");
  });

  it("removes the lock file before releaseOwner's promise is awaited, so a quit right after a window closes leaves none behind", async () => {
    const a = make({ instanceId: "A" });
    await a.acquire(project, "A:1");
    const pending = a.releaseOwner("A:1");
    // No await yet: the process could exit here.
    expect(existsSync(lockPathFor(project))).toBe(false);
    await pending;
    await a.acquire(project, "A:2");
    const released = a.release(project, "A:2");
    expect(existsSync(lockPathFor(project))).toBe(false);
    await released;
  });
});
