import { describe, expect, it } from "vitest";
import { ActionHistory } from "./action-history";
import type { Action } from "../types/actions";

const act = (n: number, params: Record<string, unknown> = {}): Action =>
  ({ type: "clip/remove", id: `a${n}`, timestamp: n, params: { clipId: `c${n}`, ...params } }) as Action;

describe("ActionHistory size limit counts undo steps", () => {
  it("keeps a group larger than the limit whole and does not push earlier steps out", () => {
    const history = new ActionHistory(10);
    history.push(act(0), act(0));
    history.push(act(1), act(1));
    history.beginGroup("Delete 50");
    for (let i = 0; i < 50; i++) history.push(act(100 + i), act(100 + i));
    history.endGroup();
    expect(history.getUndoStackSize()).toBe(52);
    expect(history.undoGroup()).toHaveLength(50);
    // The two earlier single steps are still there.
    expect(history.getUndoStackSize()).toBe(2);
  });

  it("drops whole oldest steps once there are more than the limit", () => {
    const history = new ActionHistory(3);
    history.beginGroup("g");
    for (let i = 0; i < 4; i++) history.push(act(i), act(i));
    history.endGroup();
    for (let i = 10; i < 15; i++) history.push(act(i), act(i));
    // 3 steps kept: the three newest single entries; the 4-entry group went whole.
    expect(history.getUndoStackSize()).toBe(3);
    expect(history.getHistoryEntries().map((e) => e.action.id)).toEqual(["a12", "a13", "a14"]);
  });
});

describe("ActionHistory coalesceKey", () => {
  it("merges consecutive pushes of one gesture into one entry that keeps the first inverse", () => {
    const history = new ActionHistory(100);
    history.beginGroup("drag");
    const batch = (t: number): Action => ({ type: "clip/moveBatch", id: `m${t}`, timestamp: t, params: { moves: [], coalesceKey: "g1" } }) as Action;
    history.push(batch(1), { ...batch(1), id: "inverse-first" });
    history.push(batch(2), { ...batch(2), id: "inverse-second" });
    history.push(batch(3), { ...batch(3), id: "inverse-third" });
    history.endGroup();
    const entries = history.getHistoryEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].action.id).toBe("m3");
    expect(entries[0].inverseAction?.id).toBe("inverse-first");
  });

  it("does not merge across different keys or outside a group", () => {
    const history = new ActionHistory(100);
    const batch = (t: number, key: string): Action => ({ type: "clip/moveBatch", id: `m${t}`, timestamp: t, params: { moves: [], coalesceKey: key } }) as Action;
    history.push(batch(1, "a"), batch(1, "a"));
    history.push(batch(2, "a"), batch(2, "a"));
    expect(history.getHistoryEntries()).toHaveLength(2);
    history.beginGroup("g");
    history.push(batch(3, "a"), batch(3, "a"));
    history.push(batch(4, "b"), batch(4, "b"));
    history.endGroup();
    expect(history.getHistoryEntries()).toHaveLength(4);
  });
});
