import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginClipDragActivity, endClipDragActivity, isClipDragActive, subscribeClipDragActivity } from "./clip-drag-activity";

describe("clip drag activity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
  });

  it("is active from the drag start until the settle delay after the drop", () => {
    const seen: boolean[] = [];
    const off = subscribeClipDragActivity(() => seen.push(isClipDragActive()));
    beginClipDragActivity();
    beginClipDragActivity();
    expect(isClipDragActive()).toBe(true);
    endClipDragActivity();
    expect(isClipDragActive()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(isClipDragActive()).toBe(false);
    expect(seen).toEqual([true, false]);
    off();
  });

  it("stays active when the drag effect is torn down and rebuilt mid-gesture", () => {
    beginClipDragActivity();
    endClipDragActivity();
    beginClipDragActivity();
    vi.advanceTimersByTime(500);
    expect(isClipDragActive()).toBe(true);
    endClipDragActivity();
    vi.advanceTimersByTime(500);
    expect(isClipDragActive()).toBe(false);
  });
});
