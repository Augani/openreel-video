import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MixerLevelMeters } from "./MixerLevelMeters";

afterEach(cleanup);

const level = (peak: number) => ({ peak, rms: peak / 2 });

describe("MixerLevelMeters", () => {
  it("keeps two left / right meters for a stereo mix", () => {
    render(<MixerLevelMeters levels={[level(0.5), level(0)]} label="Dialogue" />);
    expect(screen.getAllByRole("meter")).toHaveLength(2);
    expect(screen.getByRole("meter", { name: "Dialogue left level" })).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Dialogue right level" })).toBeTruthy();
    expect(screen.queryByTestId("surround-meters")).toBeNull();
  });

  it("shows six meters labelled L R C LFE Ls Rs for a 5.1 mix, each reading its own channel", () => {
    render(<MixerLevelMeters levels={[level(0), level(0), level(0), level(0), level(0), level(0.9)]} label="Master" />);
    const meters = screen.getAllByRole("meter");
    expect(meters).toHaveLength(6);
    const names = ["L", "R", "C", "LFE", "Ls", "Rs"];
    names.forEach((name, i) => expect(meters[i].getAttribute("aria-label")).toBe(`Master ${name} level`));
    const group = screen.getByTestId("surround-meters");
    expect(Array.from(group.querySelectorAll("[data-meter-channel]")).map((el) => el.getAttribute("data-meter-channel"))).toEqual(names);
    // Only Rs has signal.
    expect(meters.map((m) => m.getAttribute("aria-valuetext"))).toEqual(["−∞ dBFS", "−∞ dBFS", "−∞ dBFS", "−∞ dBFS", "−∞ dBFS", expect.stringMatching(/dBFS$/)]);
    expect(meters[5].getAttribute("aria-valuetext")).not.toBe("−∞ dBFS");
    // Visible speaker labels sit under the bars.
    const labelRow = group.parentElement!;
    for (const name of names) expect(within(labelRow).getAllByText(name).length).toBeGreaterThan(0);
  });
});
