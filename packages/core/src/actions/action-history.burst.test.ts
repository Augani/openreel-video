import { describe, expect, it } from "vitest";
import { ActionHistory } from "./action-history";

const act = (id: string, burstKey?: string) => ({
  id,
  type: "timeline/toolEdit",
  timestamp: 0,
  params: burstKey ? { burstKey } : {},
});
const push = (h: ActionHistory, id: string, burstKey?: string, group?: string | null) =>
  h.push(act(id, burstKey) as never, act(`inv-${id}`) as never, group);

describe("history bursts", () => {
  it("merges only pushes carrying the burst key", () => {
    const h = new ActionHistory();
    h.beginBurst("nudge");
    push(h, "n1", "nudge");
    push(h, "n2", "nudge");
    push(h, "other");
    push(h, "n3", "nudge");
    const entries = h.getHistoryEntries();
    expect(entries[0].groupId).toBeDefined();
    expect(entries[0].groupId).toBe(entries[1].groupId);
    expect(entries[2].groupId).toBeUndefined();
    expect(h.hasBurst()).toBe(false);
    // n3 arrived after the burst was closed by the unrelated push: not grouped with n1/n2.
    expect(entries[3].groupId).not.toBe(entries[0].groupId);
  });

  it("does not detach an unrelated push whose group id was captured before it closed the burst", () => {
    const h = new ActionHistory();
    h.beginBurst("nudge");
    const group = h.getCurrentGroupId();
    push(h, "other", undefined, group);
    expect(h.getHistoryEntries()[0].groupId).toBeUndefined();
  });

  it("undo closes the burst", () => {
    const h = new ActionHistory();
    h.beginBurst("nudge");
    push(h, "n1", "nudge");
    h.undo();
    expect(h.hasBurst()).toBe(false);
    expect(h.getCurrentGroupId()).toBeNull();
  });

  it("a transaction opened during a burst gets its own group so all its pushes stay together", () => {
    const h = new ActionHistory();
    h.beginBurst("nudge");
    push(h, "n1", "nudge");
    const txn = h.beginGroup("agent");
    expect(h.hasBurst()).toBe(false);
    push(h, "a1", undefined, txn);
    push(h, "a2", undefined, txn);
    h.endGroup();
    const entries = h.getHistoryEntries();
    expect(entries[1].groupId).toBe(txn);
    expect(entries[2].groupId).toBe(txn);
    expect(entries[0].groupId).not.toBe(txn);
    expect(h.getCurrentGroupId()).toBeNull();
  });
});
