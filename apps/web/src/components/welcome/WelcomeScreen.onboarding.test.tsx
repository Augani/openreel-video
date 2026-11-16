import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine } from "@openreel/core";
import { WelcomeScreen } from "./WelcomeScreen";
import { useProjectStore } from "../../stores/project-store";
import { useEngineStore } from "../../stores/engine-store";
import { useUIStore } from "../../stores/ui-store";
import { useOnboardingStore } from "../../stores/onboarding-store";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), track: vi.fn(), failCreate: false }));
vi.mock("../../services/project-creation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/project-creation")>();
  return {
    ...actual,
    createEditorProject: (...args: Parameters<typeof actual.createEditorProject>) =>
      mocks.failCreate ? Promise.reject(new Error("boom")) : actual.createEditorProject(...args),
  };
});
vi.mock("../../hooks/use-router", () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
}));
vi.mock("../../hooks/useEditorPreload", () => ({ useEditorPreload: () => {} }));
vi.mock("../../hooks/usePhoneEditor", () => ({ usePhoneEditor: () => false }));
vi.mock("../../hooks/useAnalytics", () => ({
  useAnalytics: () => ({ track: mocks.track }),
  AnalyticsEvents: { PROJECT_CREATED: "project_created" },
}));

type OpenReelWindow = { openreel?: { platform: "desktop" } };
const win = window as unknown as OpenReelWindow;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.failCreate = false;
  win.openreel = { platform: "desktop" };
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  useUIStore.setState({ skipWelcomeScreen: false });
  useOnboardingStore.setState({
    status: "unseen",
    skippedBy: undefined,
    openSheet: null,
    bandOpen: false,
    formatChosenProjectId: undefined,
  });
});
afterEach(() => {
  cleanup();
  delete win.openreel;
});

describe("WelcomeScreen first-run band", () => {
  it("shows the band above the format cards without hiding or renaming them", () => {
    render(<WelcomeScreen />);
    expect(screen.getByRole("group", { name: "Choose how to start" })).toBeInTheDocument();
    for (const label of ["Vertical", "Horizontal", "Square"]) {
      const button = screen.getByRole("button", { name: `Create ${label} project` });
      expect(button).toBeEnabled();
      expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(screen.getByText("Or just pick a format and start")).toBeInTheDocument();
    // Non-modal: nothing but the screen itself is fixed-position and no dialog is open.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not render the band on the web build", () => {
    delete win.openreel;
    render(<WelcomeScreen />);
    expect(screen.queryByRole("group", { name: "Choose how to start" })).toBeNull();
    expect(screen.queryByText("Or just pick a format and start")).toBeNull();
  });

  it("does not render the band once onboarding is done, and offers Setup instead", () => {
    useOnboardingStore.setState({ status: "done" });
    render(<WelcomeScreen />);
    expect(screen.queryByRole("group", { name: "Choose how to start" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(useOnboardingStore.getState().bandOpen).toBe(true);
    expect(screen.getByRole("group", { name: "Choose how to start" })).toBeInTheDocument();
  });

  it("clicking a format retires the band as 'format' and marks the format chosen", async () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Create Horizontal project/ }));
    // Onboarding is retired only once the project exists.
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("editor"));
    expect(useOnboardingStore.getState()).toMatchObject({ status: "skipped", skippedBy: "format" });
    expect(useOnboardingStore.getState().formatChosenProjectId).toBe(
      useProjectStore.getState().project.id,
    );
  });

  it("keeps onboarding when project creation fails", async () => {
    mocks.failCreate = true;
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Create Horizontal project/ }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(useOnboardingStore.getState().status).toBe("unseen");
    expect(useOnboardingStore.getState().formatChosenProjectId).toBeUndefined();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("honours skipWelcomeScreen only when the band was not re-opened", () => {
    useUIStore.setState({ skipWelcomeScreen: true });
    useOnboardingStore.setState({ status: "done", bandOpen: true });
    render(<WelcomeScreen />);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
