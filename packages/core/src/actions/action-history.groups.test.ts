import { describe, expect, it, vi } from "vitest";
import { ActionHistory } from "./action-history";

describe("explicit history groups", () => {
  it("does not pull the next rapid edit into a completed explicit group", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      const history = new ActionHistory();
      const first = { id: "first", type: "transform/update", timestamp: 1234, params: { clipId: "clip", transform: { opacity: 0.5 } } };
      const second = { ...first, id: "second", params: { clipId: "clip", transform: { opacity: 0.7 } } };
      const group = history.beginGroup("Canvas resize");
      history.push(first, { ...first, id: "undo-first" });
      history.endGroup();
      history.push(second, { ...second, id: "undo-second" });
      expect(history.getHistoryEntries()[0].groupId).toBe(group);
      expect(history.undoGroup().map(action => action.id)).toEqual(["undo-second"]);
      expect(history.undoGroup().map(action => action.id)).toEqual(["undo-first"]);
    } finally { now.mockRestore(); }
  });
  it("keeps distinct edits separate even in the same millisecond and preserves nested groups", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      const history = new ActionHistory();
      const first = history.beginGroup("Move linked clips");
      expect(history.beginGroup("Nested clip move")).toBe(first);
      history.endGroup();
      expect(history.beginGroup("Another nested move")).toBe(first);
      history.endGroup();
      history.endGroup();
      expect(history.beginGroup("Split linked clips")).not.toBe(first);
    } finally {
      now.mockRestore();
    }
  });
});
