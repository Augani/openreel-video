import { beforeEach, describe, expect, it } from "vitest";
import { applyPendingWorkspace, chooseOnboardingWorkspace, resetWorkspaceApplyForTests } from "./workspace-apply";
import { useOnboardingStore } from "../stores/onboarding-store";
import { useWorkspaceLayoutStore, BUILT_IN_WORKSPACES } from "../stores/workspace-layout-store";

beforeEach(() => {
  localStorage.clear();
  resetWorkspaceApplyForTests();
  useOnboardingStore.getState().reset();
  useWorkspaceLayoutStore.getState().applyWorkspace("editing");
});

describe("workspace-apply", () => {
  it("does nothing when no workspace was chosen", () => {
    expect(applyPendingWorkspace()).toBe(false);
    expect(useWorkspaceLayoutStore.getState().activeId).toBe("editing");
  });

  it("rejects ids that are not one of the offered built-ins", () => {
    expect(chooseOnboardingWorkspace("nope")).toBe(false);
    expect(useOnboardingStore.getState().workspace).toBeUndefined();
  });

  it("applies the chosen workspace once, on the first editor mount", () => {
    expect(chooseOnboardingWorkspace("audio")).toBe(true);
    expect(useWorkspaceLayoutStore.getState().activeId).toBe("editing");
    expect(applyPendingWorkspace()).toBe(true);
    const state = useWorkspaceLayoutStore.getState();
    expect(state.activeId).toBe("audio");
    expect(state.layout.timelineVh).toBe(BUILT_IN_WORKSPACES.find((w) => w.id === "audio")!.layout.timelineVh);
    // The user then moves on; a re-mount must not override that.
    state.applyWorkspace("color");
    expect(applyPendingWorkspace()).toBe(false);
    expect(useWorkspaceLayoutStore.getState().activeId).toBe("color");
  });

  it("a new explicit choice applies again", () => {
    chooseOnboardingWorkspace("audio");
    applyPendingWorkspace();
    chooseOnboardingWorkspace("color");
    expect(applyPendingWorkspace()).toBe(true);
    expect(useWorkspaceLayoutStore.getState().activeId).toBe("color");
  });
});
