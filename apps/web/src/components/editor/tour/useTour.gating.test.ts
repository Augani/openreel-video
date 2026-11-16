import "../../../test/install-local-storage-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldAutoStartTour } from "./useTour";
import { ONBOARDING_KEY } from "./tour-steps";

type OpenReelWindow = { openreel?: { platform: "desktop" } };
const win = window as unknown as OpenReelWindow;

afterEach(() => {
  delete win.openreel;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("passive tour auto-start gating", () => {
  it("never auto-starts on desktop, even on a fresh profile", () => {
    win.openreel = { platform: "desktop" };
    expect(shouldAutoStartTour()).toBe(false);
  });

  it("keeps auto-starting on web until it was completed", () => {
    expect(shouldAutoStartTour()).toBe(true);
    localStorage.setItem(ONBOARDING_KEY, "true");
    expect(shouldAutoStartTour()).toBe(false);
  });

  it("does not throw and does not nag when storage is blocked", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => shouldAutoStartTour()).not.toThrow();
    expect(shouldAutoStartTour()).toBe(false);
  });
});
