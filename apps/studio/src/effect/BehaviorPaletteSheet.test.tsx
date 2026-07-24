import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BehaviorPaletteSheet } from "./BehaviorPaletteSheet";
import { registerAllBehaviors } from "./behaviors/registry";

registerAllBehaviors();

describe("BehaviorPaletteSheet", () => {
  it("shows preset and atomic sections filtered by subject kind", () => {
    const onAdd = vi.fn();
    render(<BehaviorPaletteSheet subjectKind="face" onAdd={onAdd} onClose={() => undefined} />);
    expect(screen.getByText(/Effects/i)).toBeInTheDocument();
    expect(screen.getByText(/Adjustments/i)).toBeInTheDocument();
    expect(screen.getByText("Sparkles")).toBeInTheDocument();
    expect(screen.queryByText("Fire Aura")).toBeNull();
  });

  it("clicking a card calls onAdd with the behavior id", () => {
    const onAdd = vi.fn();
    render(<BehaviorPaletteSheet subjectKind="face" onAdd={onAdd} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Sparkles/ }));
    expect(onAdd).toHaveBeenCalledWith("preset.sparkles.face.v1");
  });

  it("search filters cards live", () => {
    render(<BehaviorPaletteSheet subjectKind="full_frame" onAdd={() => undefined} onClose={() => undefined} />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "warm" } });
    expect(screen.getByText("Warm Look")).toBeInTheDocument();
    expect(screen.queryByText("Dreamy")).toBeNull();
  });
});
