import "../../test/install-local-storage-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../../stores/project-store";
import { EmptyProjectStart } from "./EmptyProjectStart";
import { useOnboardingStore } from "../../stores/onboarding-store";

beforeEach(() => {
  useProjectStore.getState().createNewProject("Format workflow");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("empty project format workflow", () => {
  it("offers four exclusive radios and commits a changed format with one exact Undo", async () => {
    render(<EmptyProjectStart />);
    expect(
      screen.getByRole("radiogroup", { name: "Project format" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    fireEvent.click(screen.getByRole("radio", { name: /^9:16/ }));
    expect(screen.getByRole("radio", { name: /^9:16/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^16:9/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Start your project" }),
      ).toBeNull(),
    );
    expect(useProjectStore.getState().project.settings).toMatchObject({
      width: 1080,
      height: 1920,
      frameRate: 30,
    });
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(1);
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(useProjectStore.getState().project.settings).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
  });

  it("does not dismiss a replacement project when an earlier real format update completes", async () => {
    render(<EmptyProjectStart />);
    fireEvent.click(screen.getByRole("radio", { name: /^9:16/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    act(() =>
      useProjectStore
        .getState()
        .createNewProject("Replacement", { width: 1080, height: 1080 }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole("heading", { name: "Start your project" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^1:1/ })).toBeChecked();
    expect(useProjectStore.getState().project.name).toBe("Replacement");
  });

  it("keeps a failed format change available for retry", async () => {
    vi.spyOn(
      useProjectStore.getState(),
      "updateSettings",
    ).mockResolvedValueOnce({
      success: false,
      error: { code: "INVALID_PARAMS", message: "Please try again" },
    });
    render(<EmptyProjectStart />);
    fireEvent.click(screen.getByRole("radio", { name: /^9:16/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Please try again"),
    );
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).not.toBeDisabled();
    expect(useProjectStore.getState().project.settings).toMatchObject({
      width: 1920,
      height: 1080,
    });
  });

});

describe("onboarding format dedupe", () => {
  afterEach(() => useOnboardingStore.setState({ formatChosenProjectId: undefined }));

  it("shows the picker until the welcome screen or a wizard chose this project's format", () => {
    render(<EmptyProjectStart />);
    expect(screen.getByRole("heading", { name: "Start your project" })).toBeInTheDocument();
    act(() => {
      useOnboardingStore.getState().markFormatChosen(useProjectStore.getState().project.id);
    });
    expect(screen.queryByRole("heading", { name: "Start your project" })).toBeNull();
  });

  it("still shows the picker for a different project than the one chosen", () => {
    useOnboardingStore.getState().markFormatChosen("some-other-project");
    render(<EmptyProjectStart />);
    expect(screen.getByRole("heading", { name: "Start your project" })).toBeInTheDocument();
  });
});
