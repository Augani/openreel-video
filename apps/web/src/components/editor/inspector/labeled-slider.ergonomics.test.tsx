import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LabeledSlider } from "@openreel/ui";

describe("LabeledSlider ergonomics", () => {
  it("typing a value and pressing Enter commits the clamped number", () => {
    const onChange = vi.fn();
    render(<LabeledSlider label="Opacity" value={50} min={0} max={100} onChange={onChange} />);
    fireEvent.click(screen.getByText("50"));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("double-clicking the value resets to defaultValue", () => {
    const onChange = vi.fn();
    render(
      <LabeledSlider label="Scale" value={20} min={0} max={100} defaultValue={100} onChange={onChange} />,
    );
    fireEvent.doubleClick(screen.getByText("20"));
    expect(onChange).toHaveBeenCalledWith(100);
  });
});
