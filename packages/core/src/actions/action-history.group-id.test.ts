import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action } from "../types/actions";
import { ActionHistory } from "./action-history";

const action = (type: string, params: Record<string, unknown> = {}): Action =>
  ({ type, id: `${type}-${Math.random()}`, timestamp: 0, params }) as Action;

describe("ActionHistory group identity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps two explicit groups started in the same millisecond separately undoable", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const history = new ActionHistory();

    history.beginGroup("AI turn 1");
    history.push(action("project/applyEditSnapshot"), action("inverse"));
    history.endGroup();
    history.beginGroup("AI turn 2");
    history.push(action("project/applyEditSnapshot"), action("inverse"));
    history.endGroup();

    expect(history.undoGroup()).toHaveLength(1);
    expect(history.canUndo()).toBe(true);
  });

  it("keeps same-millisecond auto-groups for different targets apart", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const history = new ActionHistory();
    history.push(action("audio/setVolume", { clipId: "a" }), action("inverse"));
    history.push(action("audio/setVolume", { clipId: "a" }), action("inverse"));
    history.push(action("clip/move", { clipId: "b" }), action("inverse"));
    history.push(action("clip/move", { clipId: "b" }), action("inverse"));

    expect(history.undoGroup()).toHaveLength(2);
    expect(history.undoGroup()).toHaveLength(2);
    expect(history.canUndo()).toBe(false);
  });
});
