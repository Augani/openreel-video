import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolcraftPanelSection } from "@openreel/ui";

describe("ToolcraftPanelSection", () => {
  it("exposes a collapsible Toolcraft-style section header", () => {
    const { rerender } = render(
      <ToolcraftPanelSection
        title="Transform"
        collapsed={false}
        onCollapsedChange={() => undefined}
      >
        <div>Position controls</div>
      </ToolcraftPanelSection>,
    );

    expect(
      screen.getByRole("button", { name: "Collapse Transform section" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Position controls")).toBeInTheDocument();

    rerender(
      <ToolcraftPanelSection
        title="Transform"
        collapsed
        onCollapsedChange={() => undefined}
      >
        <div>Position controls</div>
      </ToolcraftPanelSection>,
    );

    expect(
      screen.getByRole("button", { name: "Expand Transform section" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("requests collapse changes when toggled", () => {
    const onCollapsedChange = vi.fn();

    render(
      <ToolcraftPanelSection
        title="Transform"
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
      >
        <div>Position controls</div>
      </ToolcraftPanelSection>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Transform section" }),
    );

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("can manage collapsed state when used uncontrolled", () => {
    render(
      <ToolcraftPanelSection title="Camera">
        <div>Camera controls</div>
      </ToolcraftPanelSection>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Camera section" }),
    );

    expect(
      screen.getByRole("button", { name: "Expand Camera section" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
