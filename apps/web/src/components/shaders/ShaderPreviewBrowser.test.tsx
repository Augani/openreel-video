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

  it("labels effect search as effects instead of materials", () => {
    render(
      <ShaderPreviewBrowser
        defs={getMotionShaderFillDefs().slice(0, 1)}
        onSelect={vi.fn()}
        sample="effect"
        label="Effect previews"
      />,
    );

    expect(
      screen.getByRole("searchbox", { name: "Search effect previews" }),
    ).toHaveAttribute("placeholder", "Search effects");
    expect(
      screen.getByRole("button", { name: /Preview and apply/ }),
    ).not.toHaveAttribute("aria-pressed");
  });

  it("disambiguates previews when shader names repeat across collections", () => {
    const builtIn = getMotionShaderFillDefs().find(
      (def) => def.name === "Liquid Metal",
    );
    expect(builtIn).toBeDefined();
    const defs = [
      builtIn!,
      {
        ...builtIn!,
        id: "paper-liquid-metal-test",
        collection: "Paper",
        category: "effect" as const,
      },
    ];
    render(
      <ShaderPreviewBrowser
        defs={defs}
        onSelect={vi.fn()}
        sample="text"
        label="Text material previews"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Preview and select Liquid Metal, Built-in fill",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Preview and select Liquid Metal, Paper effect",
      }),
    ).toBeInTheDocument();
  });

  it("filters previews by shader collection while retaining visual selection", () => {
    const defs = getMotionShaderFillDefs().filter((def) =>
      ["liquid-metal", "paper-mesh-gradient", "paper-dot-grid"].includes(def.id),
    );
    render(
      <ShaderPreviewBrowser
        defs={defs}
        onSelect={vi.fn()}
        sample="text"
        label="Text material previews"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Paper · 2/i }));
    expect(screen.getByRole("button", { name: /Paper · 2/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Preview and select Liquid Metal" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview and select Mesh Gradient" }),
    ).toBeInTheDocument();
  });
});
