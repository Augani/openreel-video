import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScrubVideoReleaser, SCRUB_VIDEO_RELEASE_DELAY_MS } from "./scrub-video-release";

describe("scrub video releaser", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases once after the delay", () => {
    const r = createScrubVideoReleaser();
    const release = vi.fn();
    r.schedule(release);
    vi.advanceTimersByTime(SCRUB_VIDEO_RELEASE_DELAY_MS - 1);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(r.pending).toBe(false);
  });

  it("a second seek inside the delay re-arms it, so the cached element is not released", () => {
    const r = createScrubVideoReleaser(1000);
    const release = vi.fn();
    r.schedule(release);
    vi.advanceTimersByTime(900);
    r.cancel(); // next seek starts and reuses the element
    r.schedule(release); // ...and finishes
    vi.advanceTimersByTime(900);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("cancel (playback start releases immediately) leaves no pending timer", () => {
    const r = createScrubVideoReleaser();
    const release = vi.fn();
    r.schedule(release);
    r.cancel();
    expect(r.pending).toBe(false);
    vi.advanceTimersByTime(SCRUB_VIDEO_RELEASE_DELAY_MS * 2);
    expect(release).not.toHaveBeenCalled();
  });

  it("keeps the delay longer than a click gap but bounded", () => {
    expect(SCRUB_VIDEO_RELEASE_DELAY_MS).toBeGreaterThan(2000);
    expect(SCRUB_VIDEO_RELEASE_DELAY_MS).toBeLessThanOrEqual(10000);
  });
});
