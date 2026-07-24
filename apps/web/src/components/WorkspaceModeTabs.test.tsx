import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { WorkspaceModeTabs } from "./WorkspaceModeTabs";

describe("WorkspaceModeTabs", () => {
  it("renders the two workspace modes and reports selection", () => {
    const onSelectMode = vi.fn();

    render(
      <WorkspaceModeTabs
        activeMode="video"
        ariaLabel="Editor workspaces"
        onSelectMode={onSelectMode}
      />,
    );

    expect(screen.getByRole("tab", { name: "Video Editor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tab", { name: "Motion Design" }),
    ).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("tab", { name: "Motion Design" }));

    expect(onSelectMode).toHaveBeenCalledWith("motion");
  });
});
