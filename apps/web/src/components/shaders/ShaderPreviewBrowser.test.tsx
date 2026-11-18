import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMotionShaderFillDefs } from "@openreel/core";
import { ShaderPreviewBrowser } from "./ShaderPreviewBrowser";

describe("ShaderPreviewBrowser", () => {
  afterEach(cleanup);

  it("shows visual choices, filters them, and applies the previewed shader", () => {
    const defs = getMotionShaderFillDefs().filter((def) =>
      ["liquid-metal", "paper-mesh-gradient", "paper-dot-grid"].includes(
        def.id,
      ),
    );
    const onSelect = vi.fn();

    render(
      <ShaderPreviewBrowser
        defs={defs}
        selectedId="liquid-metal"
        onSelect={onSelect}
        sample="text"
        label="Text material previews"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Preview and select Liquid Metal" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Preview and select Mesh Gradient" }),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search text material previews" }),
      { target: { value: "dot" } },
    );

    expect(
      screen.queryByRole("button", { name: "Preview and select Mesh Gradient" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview and select Dot Grid" }),
    );
    expect(onSelect).toHaveBeenCalledWith("paper-dot-grid");
  });



});
