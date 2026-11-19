import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { EncoderPicker } from "./EncoderPicker";

type Config = { hardwareAcceleration: string };
let supportsHardware = true;
let resolvers: Array<() => void> = [];

beforeEach(() => {
  supportsHardware = true;
  resolvers = [];
  vi.stubGlobal("VideoEncoder", {
    isConfigSupported: (config: Config) =>
      new Promise((resolve) => {
        resolvers.push(() => resolve({ supported: config.hardwareAcceleration === "prefer-software" ? true : supportsHardware }));
      }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = async () => {
  await act(async () => {
    resolvers.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
  });
};

describe("EncoderPicker", () => {
  it("never changes the chosen encoder while a probe is running or after settings change", async () => {
    const onChange = vi.fn();
    const props = { codec: "h264", width: 1920, height: 1080, value: "hardware" as const, onChange };
    const { rerender } = render(<EncoderPicker {...props} frameRate={30} />);
    await flush();
    await flush();
    expect(screen.getByTestId("encoder-hardware").getAttribute("data-available")).toBe("true");
    rerender(<EncoderPicker {...props} frameRate={24} />);
    // Probe pending for the new frame rate: the choice stays Hardware and stays available.
    expect(screen.getByTestId("encoder-hardware").getAttribute("data-selected")).toBe("true");
    await flush();
    await flush();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows an unavailable saved choice honestly and blocks export instead of switching silently", async () => {
    supportsHardware = false;
    const onChange = vi.fn();
    const onBlockedChange = vi.fn();
    render(<EncoderPicker codec="h264" width={1920} height={1080} frameRate={30} value="hardware" onChange={onChange} onBlockedChange={onBlockedChange} />);
    await flush();
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("encoder-unavailable-note").textContent).toMatch(/not available here/i);
    expect(onBlockedChange).toHaveBeenLastCalledWith(true);
  });
});
