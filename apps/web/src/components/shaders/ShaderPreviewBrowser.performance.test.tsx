import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMotionShaderEffectDefs } from "@openreel/core";
import { ShaderPreviewBrowser } from "./ShaderPreviewBrowser";

describe("shader browser previews", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps every shader selectable and never paints a synthetic stand-in when previews cannot run", () => {
    const defs = getMotionShaderEffectDefs().slice(0, 3);
    const onSelect = vi.fn();
    const { container } = render(
      <ShaderPreviewBrowser defs={defs} onSelect={onSelect} sample="effect" label="Shader effect previews" />,
    );
    for (const def of defs) {
      expect(screen.getByRole("button", { name: new RegExp(`Preview and apply ${def.name}`) })).toBeEnabled();
    }
    // Honest state instead of the old hash-hued gradient / "FX" artwork.
    expect(screen.getAllByText("Preview unavailable")).toHaveLength(defs.length);
    expect(container.innerHTML).not.toContain("linear-gradient(135deg");
    expect(container.textContent).not.toContain("FX");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Preview and apply ${defs[1].name}`) }));
    expect(onSelect).toHaveBeenCalledWith(defs[1].id);
  });

  it("starts no shader work while mounted (previews render lazily, in view, through the shared engine)", () => {
    const defs = getMotionShaderEffectDefs();
    const { container } = render(<ShaderPreviewBrowser defs={defs} onSelect={() => undefined} sample="effect" />);
    expect(container.querySelectorAll('canvas[data-preview-state="poster"]')).toHaveLength(0);
  });
});
