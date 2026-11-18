import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoreModule = typeof import("./onboarding-store");

async function freshStore(): Promise<StoreModule> {
  vi.resetModules();
  return import("./onboarding-store");
}

function setAutomation(value: boolean | undefined): void {
  (window as unknown as { openreel?: { automation?: boolean } }).openreel =
    value === undefined ? undefined : { automation: value };
}

describe("onboarding store first-run decision", () => {
  beforeEach(() => {
    localStorage.clear();
    setAutomation(undefined);
  });
  afterEach(() => {
    localStorage.clear();
    setAutomation(undefined);
    vi.restoreAllMocks();
  });

  it("starts unseen on a fresh profile", async () => {
    const { useOnboardingStore } = await freshStore();
    const s = useOnboardingStore.getState();
    expect(s.status).toBe("unseen");
    expect(s.lessons).toEqual({});
    expect(s.openSheet).toBeNull();
  });

  it("treats the legacy tour-complete key as done and persists it", async () => {
    localStorage.setItem("openreel-onboarding-complete", "true");
    const { useOnboardingStore, ONBOARDING_STORAGE_KEY } = await freshStore();
    expect(useOnboardingStore.getState().status).toBe("done");
    const stored = JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}");
    expect(stored.state.status).toBe("done");
  });

  it("treats skipWelcomeScreen=true in ui preferences as done", async () => {
    localStorage.setItem(
      "openreel-ui-preferences",
      JSON.stringify({ state: { skipWelcomeScreen: true }, version: 1 }),
    );
    const { useOnboardingStore } = await freshStore();
    expect(useOnboardingStore.getState().status).toBe("done");
  });

  it("ignores skipWelcomeScreen=false and malformed ui preferences", async () => {
    localStorage.setItem(
      "openreel-ui-preferences",
      JSON.stringify({ state: { skipWelcomeScreen: false } }),
    );
    expect((await freshStore()).useOnboardingStore.getState().status).toBe("unseen");
    localStorage.setItem("openreel-ui-preferences", "{not json");
    expect((await freshStore()).useOnboardingStore.getState().status).toBe("unseen");
  });

  it("does not re-apply legacy flags once an onboarding record exists (reset sticks)", async () => {
    localStorage.setItem("openreel-onboarding-complete", "true");
    let mod = await freshStore();
    expect(mod.useOnboardingStore.getState().status).toBe("done");
    mod.useOnboardingStore.getState().reset();
    mod = await freshStore();
    expect(mod.useOnboardingStore.getState().status).toBe("unseen");
  });

  it("restores persisted progress but never the transient fields", async () => {
    let mod = await freshStore();
    const s = mod.useOnboardingStore.getState();
    s.start("learn", "learn");
    s.setLesson("split", "done");
    s.setCurrentLesson("delete");
    s.showSheet("learn");
    s.markFormatChosen("p1");
    mod = await freshStore();
    const r = mod.useOnboardingStore.getState();
    expect(r.status).toBe("in-progress");
    expect(r.persona).toBe("learn");
    expect(r.lessons).toEqual({ split: "done" });
    expect(r.currentLesson).toBe("delete");
    expect(r.openSheet).toBeNull();
    expect(r.formatChosenProjectId).toBeUndefined();
    const raw = JSON.parse(localStorage.getItem(mod.ONBOARDING_STORAGE_KEY) ?? "{}");
    expect(raw.state).not.toHaveProperty("openSheet");
    expect(raw.state).not.toHaveProperty("formatChosenProjectId");
  });

  it("discards a corrupt stored record and falls back to unseen", async () => {
    localStorage.setItem(
      "openreel-onboarding",
      JSON.stringify({ state: { status: "bogus", lessons: 7 }, version: 1 }),
    );
    expect((await freshStore()).useOnboardingStore.getState().status).toBe("unseen");
    localStorage.setItem("openreel-onboarding", "garbage");
    expect((await freshStore()).useOnboardingStore.getState().status).toBe("unseen");
  });

  it("is safe when localStorage throws on every access", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { useOnboardingStore } = await freshStore();
    expect(useOnboardingStore.getState().status).toBe("unseen");
    expect(() => useOnboardingStore.getState().start("pro")).not.toThrow();
    expect(useOnboardingStore.getState().status).toBe("in-progress");
  });

  it("skips in memory only under automation and never persists it", async () => {
    setAutomation(true);
    const { useOnboardingStore, ONBOARDING_STORAGE_KEY } = await freshStore();
    const s = useOnboardingStore.getState();
    expect(s.status).toBe("skipped");
    expect(s.skippedBy).toBe("automation");
    s.setKeymap("premiere");
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    // A later real launch on the same profile still sees onboarding.
    setAutomation(false);
    expect((await freshStore()).useOnboardingStore.getState().status).toBe("unseen");
  });

  it("keeps done under automation", async () => {
    localStorage.setItem("openreel-onboarding-complete", "1");
    setAutomation(true);
    const { useOnboardingStore } = await freshStore();
    expect(useOnboardingStore.getState().status).toBe("done");
  });

  it("skip keeps progress and never downgrades done", async () => {
    const { useOnboardingStore } = await freshStore();
    const s = useOnboardingStore.getState();
    s.start("ai", "ai");
    s.setStep("describe");
    s.showSheet("ai");
    s.skip("agent");
    let r = useOnboardingStore.getState();
    expect(r).toMatchObject({ status: "skipped", skippedBy: "agent", step: "describe", openSheet: null });
    s.markDone();
    s.skip("user");
    r = useOnboardingStore.getState();
    expect(r.status).toBe("done");
    expect(r.completedAt).toBeTypeOf("number");
  });

  it("applyMirror collapses an unseen store but never overrides local progress", async () => {
    const { useOnboardingStore } = await freshStore();
    useOnboardingStore.getState().applyMirror({ v: 1, status: "done", persona: "pro" });
    expect(useOnboardingStore.getState()).toMatchObject({ status: "done", persona: "pro" });

    localStorage.clear();
    const other = await freshStore();
    other.useOnboardingStore.getState().start("ai");
    other.useOnboardingStore.getState().applyMirror({ v: 1, status: "done" });
    expect(other.useOnboardingStore.getState().status).toBe("in-progress");
    other.useOnboardingStore.getState().applyMirror(null);
    expect(other.useOnboardingStore.getState().status).toBe("in-progress");
  });

  it("toOnboardingMirror snapshots the persisted fields", async () => {
    const { useOnboardingStore, toOnboardingMirror } = await freshStore();
    useOnboardingStore.getState().start("pro");
    expect(toOnboardingMirror(useOnboardingStore.getState())).toEqual({
      v: 1,
      status: "in-progress",
      skippedBy: undefined,
      persona: "pro",
      path: undefined,
      completedAt: undefined,
    });
  });
});
