import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getMorphCutRegistry } from "@openreel/core/video/morph-cut/registry";
import { MorphCutControls, morphCutStatusLine } from "./MorphCutControls";

afterEach(() => getMorphCutRegistry().clear());

describe("MorphCutControls", () => {
  it("shows 'Analysing in background' with progress, then the finished analysis", () => {
    const registry = getMorphCutRegistry();
    render(<MorphCutControls transitionId="t1" params={{ quality: "medium" }} onChange={() => undefined} />);
    expect(screen.getByTestId("morph-cut-status")).toHaveAttribute("data-status", "idle");
    expect(screen.getByTestId("morph-cut-status")).toHaveTextContent("Not analysed yet");
    act(() => registry.setState("t1", { status: "analysing", progress: 0.4, message: "Analysing in background" }));
    expect(screen.getByTestId("morph-cut-status")).toHaveAttribute("data-status", "analysing");
    expect(screen.getByTestId("morph-cut-status")).toHaveTextContent("Analysing in background (40%)");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    act(() => registry.setState("t1", { status: "ready", progress: 1, message: "", analysisMs: 2400, backend: "gpu", confidence: 0.92 }));
    expect(screen.getByTestId("morph-cut-status")).toHaveTextContent("Analysed on the GPU in 2.4 s, confidence 92%");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("reports a failed analysis in the words the transition uses and says it renders as a cross dissolve", () => {
    const registry = getMorphCutRegistry();
    render(<MorphCutControls transitionId="t2" params={{}} onChange={() => undefined} />);
    act(() => registry.setState("t2", { status: "failed", progress: 1, message: "Morph Cut could not align these shots" }));
    expect(screen.getByTestId("morph-cut-status")).toHaveTextContent("Morph Cut could not align these shots. Rendering as a cross dissolve.");
  });

  it("before the transition exists it tells the user the analysis starts once it is added", () => {
    render(<MorphCutControls params={{}} onChange={() => undefined} />);
    expect(screen.getByTestId("morph-cut-status")).toHaveTextContent("Add the transition");
  });

  it("status wording for every state", () => {
    expect(morphCutStatusLine({ status: "idle", progress: 0, message: "" })).toMatch(/cross dissolve/);
    expect(morphCutStatusLine({ status: "ready", progress: 1, message: "", backend: "cpu", analysisMs: 12000, confidence: 0.5 })).toBe("Analysed on the CPU in 12.0 s, confidence 50%.");
  });
});
