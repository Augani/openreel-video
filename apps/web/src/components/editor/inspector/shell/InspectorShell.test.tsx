import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectorClipHeader } from "./InspectorClipHeader";
import { InspectorTabPanel } from "./InspectorTabPanel";

describe("InspectorClipHeader", () => {
  it("renders name, duration and type", () => {
    render(<InspectorClipHeader name="Scenic Clip" durationSeconds={15} typeLabel="video" />);
    expect(screen.getByText("Scenic Clip")).toBeInTheDocument();
    expect(screen.getByText("15.00s")).toBeInTheDocument();
    expect(screen.getByText("video")).toBeInTheDocument();
  });
});

describe("InspectorTabPanel", () => {
  it("renders children only when active matches tab", () => {
    const { rerender } = render(
      <InspectorTabPanel tab="color" active="transform">body</InspectorTabPanel>,
    );
    expect(screen.queryByText("body")).toBeNull();
    rerender(<InspectorTabPanel tab="color" active="color">body</InspectorTabPanel>);
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
