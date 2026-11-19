import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { VoiceOverMeter } from "./VoiceOverPanel";

const segments = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-testid="voiceover-meter"] > span'));

describe("VoiceOverMeter", () => {
  it("lights segments in proportion to the level and goes dark when inactive", () => {
    const half = render(<VoiceOverMeter level={0.5} active />);
    const lit = (el: Element) => el.className.includes("bg-accent") || el.className.includes("bg-status");
    expect(segments(half.container).filter(lit)).toHaveLength(12);
    half.unmount();
    const idle = render(<VoiceOverMeter level={0.9} active={false} />);
    expect(segments(idle.container).filter(lit)).toHaveLength(0);
  });

  it("turns the top segments red as the level clips, and exposes the level to assistive tech", () => {
    const { container, getByRole } = render(<VoiceOverMeter level={1} active />);
    const bars = segments(container);
    expect(bars.at(-1)?.className).toContain("bg-status-error");
    expect(bars.at(-5)?.className).toContain("bg-status-warning");
    expect(getByRole("meter").getAttribute("aria-valuenow")).toBe("1");
  });
});
