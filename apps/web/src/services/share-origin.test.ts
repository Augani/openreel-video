import { describe, it, expect, afterEach } from "vitest";
import { shareBaseOrigin } from "./share-origin";
import { generateShareableLink } from "../hooks/use-router";
import { getSharePageUrl } from "./share-service";

afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("shareBaseOrigin", () => {
  it("uses publicOrigin on desktop for share + deep links", () => {
    (window as unknown as { openreel: unknown }).openreel = {
      platform: "desktop",
      publicOrigin: "https://app.openreel.video",
    };
    expect(shareBaseOrigin()).toBe("https://app.openreel.video");
    expect(generateShareableLink("share")).toMatch(/^https:\/\/app\.openreel\.video#\//);
    expect(getSharePageUrl("x")).toBe("https://app.openreel.video#/share/x");
  });

  it("uses window.location origin+pathname on web", () => {
    const expected = `${window.location.origin}${window.location.pathname}`;
    expect(shareBaseOrigin()).toBe(expected);
    expect(getSharePageUrl("x")).toBe(`${expected}#/share/x`);
  });
});
