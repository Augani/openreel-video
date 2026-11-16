import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const { start, stop } = vi.hoisted(() => ({ start: vi.fn(() => 7), stop: vi.fn() }));
vi.mock("electron", () => ({ powerSaveBlocker: { start, stop } }));

import { acquirePowerHold, releasePowerHold, releaseAllPowerHolds } from "../src/main/power";

function fakeWc() {
  const wc = new EventEmitter() as EventEmitter & {
    setBackgroundThrottling: ReturnType<typeof vi.fn>;
    isDestroyed: () => boolean;
  };
  wc.setBackgroundThrottling = vi.fn();
  wc.isDestroyed = () => false;
  return wc;
}

describe("power hold", () => {
  beforeEach(() => {
    releaseAllPowerHolds();
    start.mockClear();
    stop.mockClear();
  });

  it("starts once and stops on the last release", () => {
    const wc = fakeWc();
    acquirePowerHold("a", wc as never);
    acquirePowerHold("b", wc as never);
    expect(start).toHaveBeenCalledTimes(1);
    expect(wc.setBackgroundThrottling).toHaveBeenLastCalledWith(false);
    releasePowerHold("a");
    expect(stop).not.toHaveBeenCalled();
    releasePowerHold("b");
    expect(stop).toHaveBeenCalledWith(7);
    expect(wc.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
  });

  it("is idempotent per job id", () => {
    const wc = fakeWc();
    acquirePowerHold("a", wc as never);
    acquirePowerHold("a", wc as never);
    releasePowerHold("a");
    releasePowerHold("a");
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("releases when the renderer goes away", () => {
    const wc = fakeWc();
    acquirePowerHold("a", wc as never);
    wc.emit("render-process-gone");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("releases and reports loss on a main-frame cross-document navigation", () => {
    const wc = fakeWc();
    const onLost = vi.fn();
    acquirePowerHold("a", wc as never, onLost);
    wc.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(wc.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(wc.listenerCount("did-start-navigation")).toBe(0);
  });

  it("ignores same-document and subframe navigations", () => {
    const wc = fakeWc();
    const onLost = vi.fn();
    acquirePowerHold("a", wc as never, onLost);
    wc.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    wc.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    expect(stop).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    releasePowerHold("a");
    expect(wc.listenerCount("did-start-navigation")).toBe(0);
  });
});
