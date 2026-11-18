import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
import { ColorGradingSection } from "./ColorGradingSection";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";

vi.mock("../../../bridges/effects-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../bridges/effects-bridge")>()),
  getEffectsBridge: () => ({ isInitialized: () => false }),
}));
const measureAutoTone = vi.fn();
vi.mock("../../../services/color-sampling", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/color-sampling")>()),
  measureAutoTone: (...args: unknown[]) => measureAutoTone(...args),
}));

const original: Clip = {
  id: "video", trackId: "main", mediaId: "media", startTime: 10, duration: 10,
  inPoint: 0, outPoint: 10, volume: 1, effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
};
const current = () => useProjectStore.getState().getClip(original.id)!;
const setSlider = (label: string, value: string): void => {
  fireEvent.click(screen.getByRole("button", { name: `Edit ${label} value` }));
  const input = screen.getByRole("textbox", { name: `${label} value` });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

beforeEach(() => {
  measureAutoTone.mockReset();
  useProjectStore.getState().createNewProject("Lumetri inspector");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        duration: 20,
        tracks: [{ id: "main", name: "Main", type: "video", clips: [structuredClone(original)], transitions: [], locked: false, hidden: false, muted: false, solo: false }],
      },
    },
  });
  useTimelineStore.setState({ playheadPosition: 12, playbackState: "stopped" });
});
afterEach(cleanup);

describe("Basic Correction in the Color tab", () => {
  it("lists six tone sliders above White Balance", () => {
    render(<ColorGradingSection clipId={original.id} />);
    const headings = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(headings.indexOf("Basic Correction")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("Basic Correction")).toBeLessThan(headings.indexOf("White Balance"));
    for (const label of ["Exposure", "Contrast", "Highlights", "Shadows", "Whites", "Blacks"]) {
      expect(screen.getByRole("slider", { name: label })).toBeTruthy();
    }
  });

  it("writes an edited slider to the clip grade and undoes it", async () => {
    render(<ColorGradingSection clipId={original.id} />);
    setSlider("Shadows", "0.5");
    await waitFor(() => expect(current().colorGrading?.tone?.shadows).toBe(0.5));
    expect(current().colorGrading?.tone?.highlights).toBe(0);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current().colorGrading).toBeUndefined();
  });

  it("resets a slider to zero by editing back to the default", async () => {
    render(<ColorGradingSection clipId={original.id} />);
    setSlider("Blacks", "-0.4");
    await waitFor(() => expect(current().colorGrading?.tone?.blacks).toBe(-0.4));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Edit Blacks value" }));
    await waitFor(() => expect(current().colorGrading?.tone?.blacks).toBe(0));
  });

  it("Auto applies the measured tone", async () => {
    measureAutoTone.mockResolvedValue({
      tone: { exposure: 0.3, contrast: 0.2, highlights: 0, shadows: 0.1, whites: 0, blacks: -0.1 },
      temperature: 0, tint: 0, measured: { black: 0, median: 0.2, white: 0.4, whiteClipShare: 0 },
    });
    render(<ColorGradingSection clipId={original.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    await waitFor(() => expect(current().colorGrading?.tone?.exposure).toBe(0.3));
    expect(current().colorGrading?.tone?.blacks).toBe(-0.1);
  });

  it("keyframes a slider in clip-local time and then edits the keyframe, not the stored grade", async () => {
    render(<ColorGradingSection clipId={original.id} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Add colorGrade.tone.exposure keyframe" })[0]);
    expect(current().keyframes).toEqual([
      expect.objectContaining({ property: "colorGrade.tone.exposure", time: 2, value: 0 }),
    ]);
    setSlider("Exposure", "0.4");
    await waitFor(() => expect(current().keyframes[0].value).toBe(0.4));
    expect(current().colorGrading).toBeUndefined();
  });

  it("offers the vignette controls", () => {
    render(<ColorGradingSection clipId={original.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Vignette" }));
    for (const label of ["Vignette Amount", "Vignette Midpoint", "Vignette Roundness", "Vignette Feather"]) {
      expect(screen.getByRole("slider", { name: label })).toBeTruthy();
    }
  });

  it("opens Match Color with a reference picker", () => {
    render(<ColorGradingSection clipId={original.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Match Color…" }));
    expect(screen.getByRole("combobox", { name: "Reference clip" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply match" })).toBeDisabled();
  });
});
