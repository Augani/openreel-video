import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolcraftSliderControl } from "@openreel/ui";

describe("ToolcraftSliderControl", () => {
  it("commits edited percent labels back to normalized slider values", () => {
    const onChange = vi.fn();

    render(
      <ToolcraftSliderControl
        label="Opacity"
        value={0.5}
        onChange={onChange}
        min={0}
        max={1}
        step={0.01}
        formatValue={(value) => `${Math.round(value * 100)}%`}
      />,
    );

    expect(screen.getByRole("slider", { name: "Opacity" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Opacity value" }));
    const input = screen.getByRole("textbox", { name: "Opacity value" });
    fireEvent.change(input, { target: { value: "25%" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(0.25);
  });
});
