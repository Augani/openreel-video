import "../../../test/install-local-storage-mock";
import { describe, expect, it } from "vitest";
import { computeOnboardingGate } from "./useOnboardingGate";
import { shouldSkipForAgent, isWelcomeRoute } from "./agent-flip";

describe("computeOnboardingGate", () => {
  it("shows the band only for an unseen desktop profile", () => {
    expect(computeOnboardingGate({ desktop: true, status: "unseen", bandOpen: false })).toEqual({
      enabled: true,
      showBand: true,
    });
  });

  it.each(["in-progress", "done", "skipped"] as const)("hides the band when %s", (status) => {
    expect(computeOnboardingGate({ desktop: true, status, bandOpen: false }).showBand).toBe(false);
  });

  it("is never enabled on the web build, even if the band was forced", () => {
    expect(computeOnboardingGate({ desktop: false, status: "unseen", bandOpen: true })).toEqual({
      enabled: false,
      showBand: false,
    });
  });

  it("Welcome & Setup re-opens the band for any status", () => {
    for (const status of ["done", "skipped", "in-progress"] as const) {
      expect(computeOnboardingGate({ desktop: true, status, bandOpen: true }).showBand).toBe(true);
    }
  });
});

describe("agent flip matrix", () => {
  const welcome = "#/welcome";
  it.each([
    ["unseen", null, true],
    ["in-progress", null, true],
    ["in-progress", "ai", true],
    ["done", "agent", true],
    ["done", null, false],
    ["skipped", null, false],
  ] as const)("status %s, sheet %s -> flip %s", (status, openSheet, expected) => {
    expect(shouldSkipForAgent({ status, openSheet }, welcome, false, true)).toBe(expected);
  });

  it("never fires for a user-started project", () => {
    expect(shouldSkipForAgent({ status: "unseen", openSheet: "ai" }, welcome, true, true)).toBe(false);
  });

  it("never fires without an MCP tool call in flight (recent, template, open-file)", () => {
    expect(shouldSkipForAgent({ status: "unseen", openSheet: null }, welcome, false, false)).toBe(false);
  });

  it("never fires off the welcome routes", () => {
    expect(shouldSkipForAgent({ status: "unseen", openSheet: null }, "#/editor", false, true)).toBe(false);
    expect(isWelcomeRoute("#/welcome?x=1")).toBe(true);
    expect(isWelcomeRoute("")).toBe(true);
    expect(isWelcomeRoute("#/editor")).toBe(false);
  });
});
