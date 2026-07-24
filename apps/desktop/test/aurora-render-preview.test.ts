import { describe, expect, it } from "vitest";
import { renderAuroraPreview } from "../src/aurora-host/render-preview";
import { findNativeAuroraRendererPath } from "../src/aurora-host/native-renderer";
import {
  createAuroraFixtureAsset,
  createAuroraFixtureScene,
} from "./aurora-fixture";

describe("Aurora preview renderer", () => {
  it("renders a creation scene to a PNG data URI", async () => {
    const asset = createAuroraFixtureAsset();
    const populatedScene = createAuroraFixtureScene(asset);

    const result = await renderAuroraPreview({
      scene: populatedScene,
      assets: [asset],
      width: 96,
      height: 96,
      background: "#0f172a",
      quality: "preview",
    });

    expect(result.dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(result.coveredPixels).toBeGreaterThan(0);
    expect(result.width).toBe(96);
    expect(result.height).toBe(96);
    if (findNativeAuroraRendererPath()) {
      expect(result.backend).toBe("native");
    }
  });
});
