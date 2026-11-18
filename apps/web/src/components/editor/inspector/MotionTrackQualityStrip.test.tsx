import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TrackingData } from "@openreel/core";
import { MotionTrackQualityStrip } from "./MotionTrackQualityStrip";

const data: TrackingData = {
  trackId: "t", clipId: "c", frameRate: 30, region: { x: 0, y: 0, width: 10, height: 10 },
  keyframes: Array.from({ length: 10 }, (_, frame) => ({ frame, position: { x: frame, y: 0 } })),
  confidence: [1, 1, 0.1, 0.1, 0.5, 1, 1, 1, 1, 1], lostFrames: [2, 3], states: ["tracked", "tracked", "predicted", "predicted", "tracked", "tracked", "tracked", "tracked", "tracked", "tracked"],
  manualFrames: [7],
};

describe("MotionTrackQualityStrip", () => {
  it("marks hidden and weak runs and the hand-set frame, and says how many frames are low confidence", () => {
    const { container } = render(<MotionTrackQualityStrip data={data} frameCount={10} selectedFrame={2} onSelect={() => undefined} />);
    expect(screen.getByTestId("motion-track-low-count").textContent).toBe("2 low-confidence frames");
    expect(container.querySelectorAll('[data-run="lost"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-run="weak"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-manual="true"]')).toHaveLength(1);
  });

  it("selects a frame from the keyboard", () => {
    const onSelect = vi.fn();
    render(<MotionTrackQualityStrip data={data} frameCount={10} selectedFrame={4} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Tracking quality by frame" }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith(5);
  });

  it("reports a clean path", () => {
    render(<MotionTrackQualityStrip data={{ ...data, lostFrames: [], confidence: data.confidence.map(() => 1), manualFrames: [] }} frameCount={10} selectedFrame={0} onSelect={() => undefined} />);
    expect(screen.getByTestId("motion-track-low-count").textContent).toBe("All frames confident");
  });
});
