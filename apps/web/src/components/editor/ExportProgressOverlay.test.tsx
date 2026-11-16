import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportProgressOverlay } from "./ExportProgressOverlay";

describe("ExportProgressOverlay ETA", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const eta = (container: HTMLElement) => container.querySelector("[data-export-eta]")!.getAttribute("data-export-eta");

  it("says estimating first, then converges to the real remaining time and ends at zero (fake clock)", () => {
    vi.setSystemTime(2_000_000);
    const now = () => Date.now();
    const props = { phase: "rendering...", width: 800, height: 450, now } as const;
    const { container, rerender } = render(<ExportProgressOverlay progress={0} {...props} />);
    expect(container.textContent).toContain("estimating");
    // A 100 s export reporting every 2 s.
    for (let s = 2; s <= 100; s += 2) {
      act(() => {
        vi.setSystemTime(2_000_000 + s * 1000);
        rerender(<ExportProgressOverlay progress={s} {...props} />);
      });
      if (s === 50) expect(Math.abs(Number(eta(container)) - 50)).toBeLessThanOrEqual(3);
      if (s === 80) expect(Math.abs(Number(eta(container)) - 20)).toBeLessThanOrEqual(2);
    }
    expect(eta(container)).toBe("0");
    expect(container.textContent).toContain("a few seconds left");
  });

  it("keeps counting down between progress reports", () => {
    vi.setSystemTime(5_000_000);
    const now = () => Date.now();
    const { container, rerender } = render(<ExportProgressOverlay progress={0} phase="rendering" width={800} height={450} now={now} />);
    for (let s = 2; s <= 20; s += 2) {
      act(() => {
        vi.setSystemTime(5_000_000 + s * 1000);
        rerender(<ExportProgressOverlay progress={s} phase="rendering" width={800} height={450} now={now} />);
      });
    }
    const before = Number(eta(container));
    act(() => {
      vi.setSystemTime(5_000_000 + 24_000);
      vi.advanceTimersByTime(4000);
    });
    expect(Number(eta(container))).toBeLessThan(before);
  });
});
