/**
 * Two real OS processes contending for one project file: the "opened in two instances" case, without
 * needing a built Electron app. The child is a separate node process (its own pid) using the same
 * ProjectLocks module the main process uses.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProjectLocks, lockPathFor, type LockResult } from "../src/main/project-lock";

const child = path.resolve(__dirname, "project-lock-child.mjs");

let dir: string;
let project: string;
let lockModule = "";
let moduleDir = "";
// Spawning a node child (and loading the lock module in it) is slow on Windows CI runners.
const SPAWN_TIMEOUT_MS = 30_000;
const spawned: ChildProcessWithoutNullStreams[] = [];

beforeAll(() => {
  // The module under test is TypeScript in a CommonJS package: strip its types so a plain node child can import it.
  moduleDir = mkdtempSync(path.join(tmpdir(), "openreel-lock-mod-"));
  lockModule = path.join(moduleDir, "project-lock.mjs");
  writeFileSync(lockModule, stripTypeScriptTypes(readFileSync(path.resolve(__dirname, "../src/main/project-lock.ts"), "utf8")));
  return () => rmSync(moduleDir, { recursive: true, force: true });
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "openreel-lock-proc-"));
  project = path.join(dir, "Film.oreel");
  writeFileSync(project, "{}");
});
afterEach(() => {
  for (const proc of spawned.splice(0)) proc.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
});

function lines(proc: ChildProcessWithoutNullStreams): { next(): Promise<string> } {
  let buffer = "";
  const queue: string[] = [];
  const waiting: Array<(line: string) => void> = [];
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      const waiter = waiting.shift();
      if (waiter) waiter(line);
      else queue.push(line);
    }
  });
  return { next: () => new Promise((resolve) => (queue.length ? resolve(queue.shift()!) : waiting.push(resolve))) };
}

function startChild(owner: string): { proc: ChildProcessWithoutNullStreams; out: ReturnType<typeof lines> } {
  const proc = spawn(process.execPath, [child, project, owner, lockModule], { stdio: ["pipe", "pipe", "pipe"] });
  spawned.push(proc);
  // A child that dies before printing would otherwise leave the test waiting for its timeout.
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => process.stderr.write(`[lock child ${owner}] ${chunk}`));
  return { proc, out: lines(proc) };
}

describe("project lock across processes", () => {
  it("a second instance is told who holds the project, and can open it after a clean close", async () => {
    const first = startChild("child:1");
    expect(JSON.parse(await first.out.next())).toEqual({ status: "acquired" });

    const mine = new ProjectLocks({ instanceId: "parent" });
    const refused: LockResult = await mine.acquire(project, "parent:1");
    expect(refused.status).toBe("held");
    if (refused.status === "held") {
      expect(refused.holder.pid).toBe(first.proc.pid);
      expect(refused.holder.sameApp).toBe(false);
      expect(refused.holder.sameHost).toBe(true);
    }

    first.proc.stdin.write("release\n");
    expect(await first.out.next()).toBe("released");
    expect(existsSync(lockPathFor(project))).toBe(false);
    expect((await mine.acquire(project, "parent:1")).status).toBe("acquired");
    await mine.releaseOwner("parent:1");
  }, SPAWN_TIMEOUT_MS);

  it("takes over the lock of an instance that crashed", async () => {
    const crashing = startChild("child:1");
    expect(JSON.parse(await crashing.out.next())).toEqual({ status: "acquired" });
    const exited = new Promise((resolve) => crashing.proc.once("exit", resolve));
    crashing.proc.kill("SIGKILL");
    await exited;
    expect(existsSync(lockPathFor(project))).toBe(true);

    const mine = new ProjectLocks({ instanceId: "parent" });
    expect((await mine.acquire(project, "parent:1")).status).toBe("acquired");
    await mine.releaseOwner("parent:1");
  }, SPAWN_TIMEOUT_MS);

  it("only one of two instances that open at the same moment gets the project", async () => {
    const a = startChild("a:1");
    const b = startChild("b:1");
    const results = [JSON.parse(await a.out.next()), JSON.parse(await b.out.next())] as LockResult[];
    expect(results.map((r) => r.status).sort()).toEqual(["acquired", "held"]);
  }, SPAWN_TIMEOUT_MS);
});
