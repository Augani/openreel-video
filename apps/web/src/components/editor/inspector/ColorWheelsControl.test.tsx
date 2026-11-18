import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ColorWheelsControl } from "./ColorWheelsControl";

const zero = { r: 0, g: 0, b: 0 };

describe("ColorWheelsControl", () => {
  it("lays the three wheels out as a fitted grid so none is clipped", () => {
    render(
      <ColorWheelsControl
        values={{ shadows: zero, midtones: zero, highlights: zero, shadowsLift: 0, midtonesGamma: 1, highlightsGain: 1 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("color-wheels-row").className).toContain("grid-cols-3");
    expect(screen.getByText("Highlights")).toBeTruthy();
  });
});
