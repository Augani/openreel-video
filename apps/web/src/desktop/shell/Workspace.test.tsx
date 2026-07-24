import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { useUIStore } from "../../stores/ui-store";

vi.mock("../editor/EditorBootstrapGate", () => ({
  EditorBootstrapGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../pages/EditPage", () => ({
  EditPage: () => <div data-testid="edit-page" />,
}));
vi.mock("../pages/MotionPage", () => ({
  MotionPage: () => <div data-testid="motion-page" />,
}));

import { Workspace } from "./Workspace";

describe("Workspace", () => {
  beforeEach(() => {
    useUIStore.setState({ desktopPage: "edit" });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders two primary workspace tabs above the editor", async () => {
    render(<Workspace />);
    expect(screen.getByTestId("desktop-workspace")).toBeTruthy();
    expect(
      screen.getByRole("tablist", { name: "Desktop workspaces" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Video Editing" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "Motion Creation" }),
    ).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("tab", { name: "Color" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Deliver" })).toBeNull();
    expect(await screen.findByTestId("edit-page")).toBeTruthy();
  });

  it("switches between video editing and motion creation", async () => {
    render(<Workspace />);

    fireEvent.click(screen.getByRole("tab", { name: "Motion Creation" }));

    expect(useUIStore.getState().desktopPage).toBe("motion");
    expect(await screen.findByTestId("motion-page")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Motion Creation" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
