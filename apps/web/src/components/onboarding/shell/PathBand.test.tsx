import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { PathBand } from "./PathBand";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));
vi.mock("../../../hooks/use-router", () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
}));
vi.mock("../../../hooks/useEditorPreload", () => ({ useEditorPreload: () => {} }));
vi.mock("../../../hooks/usePhoneEditor", () => ({ usePhoneEditor: () => false }));
vi.mock("../../../hooks/useAnalytics", () => ({
  useAnalytics: () => ({ track: vi.fn() }),
  AnalyticsEvents: { PROJECT_CREATED: "project_created" },
}));

type OpenReelWindow = { openreel?: { platform: "desktop"; automation?: boolean } };
const win = window as unknown as OpenReelWindow;

function resetStore(status: "unseen" | "in-progress" | "done" | "skipped" = "unseen") {
  useOnboardingStore.setState({
    status,
    skippedBy: undefined,
    openSheet: null,
    bandOpen: false,
    lessons: {},
    persona: undefined,
  });
}

beforeEach(() => {
  win.openreel = { platform: "desktop" };
  resetStore();
});
afterEach(() => {
  cleanup();
  delete win.openreel;
  vi.useRealTimers();
});

describe("PathBand", () => {
  it("renders the three tiles in a labelled group on a fresh desktop profile", () => {
    render(<PathBand />);
    const group = screen.getByRole("group", { name: "Choose how to start" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How do you want to start?" })).toBeInTheDocument();
    for (const name of [/Edit with AI/, /Learn to edit/, /I already edit/]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /Connect an agent/ })).toBeInTheDocument();
  });

  it("renders nothing on the web build", () => {
    delete win.openreel;
    render(<PathBand />);
    expect(screen.queryByTestId("onboarding-path-band")).toBeNull();
  });

  it.each(["done", "skipped"] as const)("renders nothing when status is %s", (status) => {
    resetStore(status);
    render(<PathBand />);
    expect(screen.queryByTestId("onboarding-path-band")).toBeNull();
  });

  it("renders nothing under automation (the store folds it into skipped)", () => {
    useOnboardingStore.setState({ status: "skipped", skippedBy: "automation" });
    render(<PathBand />);
    expect(screen.queryByTestId("onboarding-path-band")).toBeNull();
  });

  it("is in the first paint with no fixed or absolute overlay", () => {
    const { container } = render(<PathBand />);
    expect(screen.getByTestId("onboarding-path-band")).toHaveAttribute("data-state", "open");
    const positioned = Array.from(container.querySelectorAll<HTMLElement>("*")).filter((el) =>
      /(^|\s)(fixed|absolute)(\s|$)/.test(el.className),
    );
    expect(positioned).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the matching sheet from the AI and Learn tiles without changing status", () => {
    render(<PathBand />);
    fireEvent.click(screen.getByRole("button", { name: /Edit with AI/ }));
    expect(useOnboardingStore.getState().openSheet).toBe("ai");
    fireEvent.click(screen.getByRole("button", { name: /Learn to edit/ }));
    expect(useOnboardingStore.getState().openSheet).toBe("learn");
    expect(useOnboardingStore.getState().status).toBe("unseen");
  });

  it("opens the agent sheet from the footer link", () => {
    render(<PathBand />);
    fireEvent.click(screen.getByRole("button", { name: "Connect an agent" }));
    expect(useOnboardingStore.getState().openSheet).toBe("agent");
  });

  it("expands the pro row in place and moves focus to the first chip", async () => {
    render(<PathBand />);
    const tile = screen.getByRole("button", { name: /I already edit/ });
    expect(tile).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByTestId("onboarding-pro-row")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("radio", { name: "OpenReel keys" })).toHaveFocus());
  });

  it("is a roving-focus group: one tab stop, arrows move, Home/End jump", () => {
    render(<PathBand />);
    const tiles = [/Edit with AI/, /Learn to edit/, /I already edit/].map((n) =>
      screen.getByRole("button", { name: n }),
    );
    expect(tiles.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    tiles[0].focus();
    fireEvent.keyDown(tiles[0], { key: "ArrowRight" });
    expect(tiles[1]).toHaveFocus();
    expect(tiles.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(tiles[1], { key: "End" });
    expect(tiles[2]).toHaveFocus();
    fireEvent.keyDown(tiles[2], { key: "ArrowRight" });
    expect(tiles[0]).toHaveFocus();
    fireEvent.keyDown(tiles[0], { key: "ArrowLeft" });
    expect(tiles[2]).toHaveFocus();
  });

  it("Esc dismisses the band only: captured and stopped before app handlers", () => {
    const appHandler = vi.fn();
    window.addEventListener("keydown", appHandler);
    render(<PathBand />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(appHandler).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState()).toMatchObject({ status: "skipped", skippedBy: "user" });
    // Once dismissed, Esc reaches the other handlers again.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(appHandler).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", appHandler);
  });

  it("Esc inside a text field is left to the field", () => {
    render(
      <>
        <input aria-label="field" />
        <PathBand />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "Escape" });
    expect(useOnboardingStore.getState().status).toBe("unseen");
  });

  it("Esc with a sheet open is left alone: the band neither dismisses nor swallows it (the host owns it)", () => {
    useOnboardingStore.setState({ openSheet: "ai" });
    render(<PathBand />);
    const notPrevented = fireEvent.keyDown(document.body, { key: "Escape" });
    expect(notPrevented, "PathBand did not preventDefault, so the host's handler still sees it").toBe(true);
    expect(useOnboardingStore.getState().status).toBe("unseen");
    expect(useOnboardingStore.getState().openSheet).toBe("ai");
    expect(screen.getByTestId("onboarding-path-band")).toHaveAttribute("data-state", "open");
  });

  it("Skip setup collapses the band and unmounts it after the transition", () => {
    vi.useFakeTimers();
    render(<PathBand />);
    fireEvent.click(screen.getByRole("button", { name: /Skip setup/ }));
    expect(useOnboardingStore.getState().skippedBy).toBe("user");
    expect(screen.getByTestId("onboarding-path-band")).toHaveAttribute("data-state", "closed");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId("onboarding-path-band")).toBeNull();
  });

  it("stays open once a path is started from it (a key chip), so the rest of the row can be used", () => {
    render(<PathBand />);
    act(() => useOnboardingStore.getState().start("pro"));
    expect(useOnboardingStore.getState().status).toBe("in-progress");
    expect(screen.getByTestId("onboarding-path-band")).toHaveAttribute("data-state", "open");
  });

  it("an in-progress path from an earlier visit does not bring the band back by itself", () => {
    resetStore("in-progress");
    render(<PathBand />);
    expect(screen.queryByTestId("onboarding-path-band")).toBeNull();
  });

  it("re-opens after dismissal when Welcome & Setup asks for it", () => {
    resetStore("skipped");
    render(<PathBand />);
    expect(screen.queryByTestId("onboarding-path-band")).toBeNull();
    act(() => useOnboardingStore.getState().reopenBand());
    expect(screen.getByTestId("onboarding-path-band")).toBeInTheDocument();
    expect(useOnboardingStore.getState().status).toBe("skipped");
  });
});
