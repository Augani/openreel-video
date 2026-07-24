import "../test/install-local-storage-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "./ui-store";

describe("ui-store transition selection", () => {
  beforeEach(() => {
    useUIStore.getState().clearSelection();
  });

  it("selects a transition item", () => {
    useUIStore.getState().select({
      type: "transition",
      id: "tr-1",
      trackId: "track-1",
    });
    const items = useUIStore.getState().selectedItems;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "transition", id: "tr-1" });
  });

  it("excludes transitions from getSelectedClipIds", () => {
    useUIStore.getState().select({ type: "transition", id: "tr-1" });
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([]);
  });
});
