import { describe, it, expect } from "vitest";
import { isAllowedNavigation } from "./nav-guard";

const APP_INDEX = "app://openreel/index.html";

describe("isAllowedNavigation", () => {
  it("allows same-origin app navigation", () => {
    expect(isAllowedNavigation("app://openreel/editor", APP_INDEX)).toBe(true);
    expect(isAllowedNavigation("app://openreel/index.html#x", APP_INDEX)).toBe(true);
  });

  it("denies external http(s) sites", () => {
    expect(isAllowedNavigation("https://evil.example.com", APP_INDEX)).toBe(false);
    expect(isAllowedNavigation("http://localhost:5173", APP_INDEX)).toBe(false);
  });

  it("denies other schemes and hosts", () => {
    expect(isAllowedNavigation("file:///etc/passwd", APP_INDEX)).toBe(false);
    expect(isAllowedNavigation("app://other/index.html", APP_INDEX)).toBe(false);
    expect(isAllowedNavigation("javascript:alert(1)", APP_INDEX)).toBe(false);
  });

  it("denies malformed URLs", () => {
    expect(isAllowedNavigation("not a url", APP_INDEX)).toBe(false);
    expect(isAllowedNavigation("", APP_INDEX)).toBe(false);
  });
});
