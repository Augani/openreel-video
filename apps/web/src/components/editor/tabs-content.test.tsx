import { useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";

function Harness() {
  const [value, setValue] = useState("a");
  return (
    <div>
      <SegmentedControl
        value={value}
        onChange={setValue}
        label="Mode"
        size="sm"
        layout="fill"
      >
        <SegmentedControlItem value="a" label="TabA" />
        <SegmentedControlItem value="b" label="TabB" />
      </SegmentedControl>
      {value === "a" && <div>ALPHA_CONTENT</div>}
      {value === "b" && <div>BETA_CONTENT</div>}
    </div>
  );
}

describe("TabsContent", () => {
  it("renders the active tab's children", () => {
    render(<Harness />);
    expect(screen.getByText("ALPHA_CONTENT")).toBeInTheDocument();
  });

  it("renders the newly activated tab's children after switching", async () => {
    render(<Harness />);
    const tabB = screen.getByRole("radio", { name: "TabB" });
    fireEvent.pointerDown(tabB, { button: 0 });
    fireEvent.mouseDown(tabB, { button: 0 });
    fireEvent.click(tabB);
    await waitFor(() =>
      expect(screen.getByText("BETA_CONTENT")).toBeInTheDocument(),
    );
  });
});
