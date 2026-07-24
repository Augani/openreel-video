import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { MotionComposition } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { RenderQueuePanel } from "./RenderQueuePanel";

const COMP_ID = "comp-guardrail";

function composition(): MotionComposition {
  return {
    id: COMP_ID,
    name: "Guardrail Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function setDesktop(enabled: boolean): void {
  if (enabled) {
    (window as { openreel?: { platform: "desktop" } }).openreel = {
      platform: "desktop",
    };
  } else {
    delete (window as { openreel?: unknown }).openreel;
  }
}

function seedQueuedJob(format: "mp4" | "webm-alpha" | "mov-prores4444"): void {
  useMotionStore.setState({
    renderQueue: [
      {
        id: "job-queued",
        compositionId: COMP_ID,
        name: "Guardrail Comp",
        width: 1280,
        height: 720,
        frameRate: 30,
        duration: 4,
        format,
        status: "queued",
        progress: 0,
        createdAt: 1,
      },
    ],
  });
}

function startButton(): HTMLButtonElement {
  const buttons = screen.getAllByRole("button", { name: /start render queue/i });
  const full = buttons.find(
    (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
  );
  if (!full) throw new Error("start button not found");
  return full;
}

describe("RenderQueuePanel ProRes/alpha guardrail", () => {
  beforeEach(() => {
    const project = {
      ...createEmptyProject("Guardrail test"),
      motionCompositions: [composition()],
    };
    useProjectStore.setState({ hasOpenProject: true, project });
    useMotionStore.setState({ renderQueue: [] });
  });

  afterEach(() => {
    cleanup();
    setDesktop(false);
    useProjectStore.setState({ hasOpenProject: false });
    useMotionStore.setState({ renderQueue: [] });
  });

  it("blocks ProRes on the web build until acknowledged", () => {
    setDesktop(false);
    seedQueuedJob("mp4");
    render(<RenderQueuePanel composition={composition()} embedded />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "mov-prores4444" } });

    expect(
      screen.getByText(/Web export can't produce ProRes or alpha/i),
    ).toBeInTheDocument();
    expect(startButton()).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: /export as h\.264 anyway/i }),
    );

    expect(startButton()).not.toBeDisabled();
  });

  it("blocks transparent/alpha output until acknowledged", () => {
    setDesktop(false);
    render(<RenderQueuePanel composition={composition()} embedded />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "webm-alpha" } });

    expect(
      screen.getByText(/Web export can't produce ProRes or alpha/i),
    ).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it("does not warn for mp4", () => {
    setDesktop(false);
    render(<RenderQueuePanel composition={composition()} embedded />);

    expect(
      screen.queryByText(/Web export can't produce ProRes or alpha/i),
    ).not.toBeInTheDocument();
  });

  it("does not warn when the native desktop backend is available", () => {
    setDesktop(true);
    seedQueuedJob("mp4");
    render(<RenderQueuePanel composition={composition()} embedded />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "mov-prores4444" } });

    expect(
      screen.queryByText(/Web export can't produce ProRes or alpha/i),
    ).not.toBeInTheDocument();
    expect(startButton()).not.toBeDisabled();
  });

  it("states the encoded format on a completed web ProRes job", () => {
    setDesktop(false);
    useMotionStore.setState({
      renderQueue: [
        {
          id: "job-1",
          compositionId: COMP_ID,
          name: "Guardrail Comp",
          width: 1280,
          height: 720,
          frameRate: 30,
          duration: 4,
          format: "mov-prores4444",
          status: "complete",
          progress: 100,
          createdAt: 1,
          completedAt: 2,
          outputFilename: "guardrail.mov",
        },
      ],
    });
    render(<RenderQueuePanel composition={composition()} embedded />);

    const jobRow = screen.getByText("Guardrail Comp").closest("div");
    expect(jobRow).not.toBeNull();
    expect(
      within(jobRow!.parentElement as HTMLElement).getByText(
        /Encoded H\.264 \(ProRes unavailable on web\)/i,
      ),
    ).toBeInTheDocument();
  });
});
