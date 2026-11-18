import { describe, expect, it } from "vitest";
import { enqueueThumbJob } from "./thumb-queue";

describe("template thumbnail queue", () => {
  it("runs jobs strictly one after another and yields a macrotask between them", async () => {
    const log: string[] = [];
    let active = 0;
    let peak = 0;
    const job = (name: string) => async () => {
      active++;
      peak = Math.max(peak, active);
      log.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 3));
      log.push(`end ${name}`);
      active--;
    };
    await Promise.all([enqueueThumbJob(job("a")), enqueueThumbJob(job("b")), enqueueThumbJob(job("c"))]);
    expect(peak).toBe(1);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("skips a cancelled job and survives a failing one", async () => {
    const ran: string[] = [];
    await Promise.all([
      enqueueThumbJob(async () => { throw new Error("boom"); }),
      enqueueThumbJob(async () => { ran.push("cancelled"); }, () => true),
      enqueueThumbJob(async () => { ran.push("last"); }),
    ]);
    expect(ran).toEqual(["last"]);
  });
});
