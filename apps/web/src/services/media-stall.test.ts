import { describe, expect, it } from "vitest";
import { StallWatchdog, isWedged, type MediaSample } from "./media-stall";

const wedged: MediaSample = { currentTime: 1.257, readyState: 2, seeking: false, bufferedEnd: 6 };

describe("isWedged", () => {
  it("flags a buffered element with no future data and no pending seek", () => {
    expect(isWedged(wedged)).toBe(true);
  });
  it("ignores healthy, seeking and genuinely unbuffered elements", () => {
    expect(isWedged({ ...wedged, readyState: 4 })).toBe(false);
    expect(isWedged({ ...wedged, readyState: 4, seeking: false })).toBe(false);
    expect(isWedged({ ...wedged, bufferedEnd: -1 })).toBe(false);
    expect(isWedged({ ...wedged, bufferedEnd: 1.3 })).toBe(false);
  });
});

describe("StallWatchdog", () => {
  it("gives a pending seek longer than a plain stall before re-issuing it", () => {
    const w = new StallWatchdog(700, 2000);
    const seeking = { ...wedged, readyState: 1, seeking: true };
    expect(w.check(seeking, 0)).toBe(false);
    expect(w.check(seeking, 1500)).toBe(false);
    expect(w.check(seeking, 2000)).toBe(true);
  });
  it("asks for a re-seek after the element stays wedged at one position, then retries", () => {
    const w = new StallWatchdog(700);
    expect(w.check(wedged, 0)).toBe(false);
    expect(w.check(wedged, 400)).toBe(false);
    expect(w.check(wedged, 700)).toBe(true);
    expect(w.check(wedged, 1000)).toBe(false);
    expect(w.check(wedged, 1400)).toBe(true);
  });
  it("never fires while the position keeps moving or the element is healthy", () => {
    const w = new StallWatchdog(700);
    for (let t = 0; t < 3000; t += 250) expect(w.check({ ...wedged, currentTime: 1 + t / 1000 }, t)).toBe(false);
    for (let t = 0; t < 3000; t += 250) expect(w.check({ ...wedged, readyState: 4 }, t)).toBe(false);
  });
  it("restarts the timer when the position changes", () => {
    const w = new StallWatchdog(700);
    w.check(wedged, 0);
    w.check({ ...wedged, currentTime: 1.3 }, 600);
    expect(w.check({ ...wedged, currentTime: 1.3 }, 1000)).toBe(false);
    expect(w.check({ ...wedged, currentTime: 1.3 }, 1300)).toBe(true);
  });
});
