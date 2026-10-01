import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { useUIStore } from "../../stores/ui-store";

vi.mock("../editor/EditorBootstrapGate", () => ({
  EditorBootstrapGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../pages/EditPage", () => ({
  EditPage: () => <div data-testid="edit-page" />,
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

  it("renders only the video editor workspace", async () => {
    render(<Workspace />);
    expect(screen.getByTestId("desktop-workspace")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(await screen.findByTestId("edit-page")).toBeTruthy();
  });

  it("does not render Motion Creator for stale motion state", async () => {
    useUIStore.setState({ desktopPage: "motion" });
    render(<Workspace />);
    expect(await screen.findByTestId("edit-page")).toBeTruthy();
    expect(screen.queryByTestId("motion-page")).toBeNull();
  });
});
