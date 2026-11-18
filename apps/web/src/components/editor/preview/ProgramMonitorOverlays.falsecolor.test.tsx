import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProgramMonitorOverlays } from "./ProgramMonitorOverlays";
import { useColorMonitorStore } from "../../../stores/color-monitor-store";

afterEach(() => {
  cleanup();
  useColorMonitorStore.setState({ falseColor: false });
});

describe("Program monitor false colour", () => {
  it("shows the IRE band overlay and legend only while toggled on", () => {
    render(<ProgramMonitorOverlays />);
    expect(screen.queryByTestId("false-color-overlay")).toBeNull();
    fireEvent.click(screen.getByLabelText("Toggle false colour"));
    expect(screen.getByTestId("false-color-overlay")).toBeTruthy();
    expect(screen.getByText("Skin")).toBeTruthy();
    expect(screen.getByText("Clipped")).toBeTruthy();
    // driven from the store too (scopes panel, agent tools)
    act(() => useColorMonitorStore.getState().setFalseColor(false));
    expect(screen.queryByTestId("false-color-overlay")).toBeNull();
  });
});
