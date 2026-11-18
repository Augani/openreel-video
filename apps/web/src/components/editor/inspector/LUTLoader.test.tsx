import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LUTData } from "@openreel/core";
import { LUTLoader } from "./LUTLoader";

afterEach(cleanup);

const lut = (space?: LUTData["space"]): LUTData => ({ data: new Uint8Array(2 * 2 * 2 * 3), size: 2, intensity: 1, ...(space ? { space } : {}) });

describe("LUT colour space", () => {
  it("is offered once a LUT is loaded and defaults to the display (sRGB) space", () => {
    render(<LUTLoader lutData={lut()} onChange={() => undefined} />);
    expect(screen.getByRole("combobox", { name: "LUT colour space" })).toHaveValue("srgb");
  });

  it("is not shown before a LUT is loaded", () => {
    render(<LUTLoader lutData={null} onChange={() => undefined} />);
    expect(screen.queryByRole("combobox", { name: "LUT colour space" })).toBeNull();
  });

  it("changing it keeps the table and intensity and records the space", () => {
    const onChange = vi.fn();
    render(<LUTLoader lutData={lut("srgb")} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "LUT colour space" }), { target: { value: "pq" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ size: 2, intensity: 1, space: "pq" });
  });
});
