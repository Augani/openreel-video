import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { OpenReelMark } from "./OpenReelMark";

describe("OpenReelMark", () => {
  it("renders an svg with the expected viewBox and size", () => {
    const { container } = render(<OpenReelMark size={48} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(svg?.getAttribute("width")).toBe("48");
    expect(svg?.getAttribute("height")).toBe("48");
  });

  it("renders the center dot, faint ring, and eight spokes", () => {
    const { container } = render(<OpenReelMark />);
    expect(container.querySelectorAll("circle").length).toBe(2);
    expect(container.querySelectorAll("line").length).toBe(8);
  });
});
