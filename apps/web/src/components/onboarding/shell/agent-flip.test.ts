import "../../../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { handleProjectOpenedOnWelcomeRoute } from "./agent-flip";
import { withAgentToolCall, withUserProjectCreation } from "./project-intent";
import { installOnboardingSync } from "./onboarding-sync";

function reset(patch: Partial<ReturnType<typeof useOnboardingStore.getState>> = {}) {
  useOnboardingStore.getState().reset();
  useOnboardingStore.setState({ status: "unseen", ...patch });
}

describe("handleProjectOpenedOnWelcomeRoute", () => {
  beforeEach(() => reset());

  it("labels an MCP tool call as the agent and closes the sheet", async () => {
    reset({ openSheet: "ai" });
    await withAgentToolCall(async () => {
      expect(handleProjectOpenedOnWelcomeRoute("#/welcome")).toBe(true);
    });
    expect(useOnboardingStore.getState()).toMatchObject({ status: "skipped", skippedBy: "agent", openSheet: null });
  });

  it("does not label a user open (recent project, template, open-file) as the agent", () => {
    expect(handleProjectOpenedOnWelcomeRoute("#/recent")).toBe(false);
    expect(handleProjectOpenedOnWelcomeRoute("#/templates")).toBe(false);
    expect(useOnboardingStore.getState().status).toBe("unseen");
  });

  it("does not label user-started creation as the agent even during an MCP call", async () => {
    await withAgentToolCall(() =>
      withUserProjectCreation(async () => {
        expect(handleProjectOpenedOnWelcomeRoute("#/welcome")).toBe(false);
      }),
    );
    expect(useOnboardingStore.getState().status).toBe("unseen");
  });

  it("clears a re-opened band even when onboarding is already done", async () => {
    reset({ status: "done", bandOpen: true });
    await withAgentToolCall(async () => {
      expect(handleProjectOpenedOnWelcomeRoute("#/welcome")).toBe(false);
    });
    expect(useOnboardingStore.getState().bandOpen).toBe(false);
  });
});

describe("installOnboardingSync mirror seeding", () => {
  beforeEach(() => reset());

  it("writes the mirror once when status is derived (done) and no mirror exists", async () => {
    reset({ status: "done" });
    const set = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue(null);
    Object.defineProperty(window, "openreel", { value: { onboarding: { get, set } }, configurable: true });
    const stop = installOnboardingSync();
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0][0]).toMatchObject({ status: "done" });
    stop();
    Reflect.deleteProperty(window, "openreel");
  });

  it("does not write when the profile is unseen", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue(null);
    Object.defineProperty(window, "openreel", { value: { onboarding: { get, set } }, configurable: true });
    const stop = installOnboardingSync();
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    await Promise.resolve();
    expect(set).not.toHaveBeenCalled();
    stop();
    Reflect.deleteProperty(window, "openreel");
  });
});
