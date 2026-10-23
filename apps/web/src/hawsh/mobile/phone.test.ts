import { afterEach, describe, expect, it } from "vitest";
import { mobileUiEnabled } from "./phone";

afterEach(() => localStorage.removeItem("hawsh-mobile-ui"));

describe("mobileUiEnabled", () => {
  it("is off by default", () => {
    expect(mobileUiEnabled("")).toBe(false);
  });
  it("turns on with ?m=1, stays on, and turns off with ?m=0", () => {
    expect(mobileUiEnabled("?m=1")).toBe(true);
    expect(mobileUiEnabled("")).toBe(true);
    expect(mobileUiEnabled("?hk=x&m=0")).toBe(false);
    expect(mobileUiEnabled("")).toBe(false);
  });
});
