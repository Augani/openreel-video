import { describe, it, expect } from "vitest";
import { isFfmpegCoreAsset, stripFfmpegPlugin } from "./strip-ffmpeg";

describe("strip-ffmpeg", () => {
  it("matches the @ffmpeg/core(-mt) asset url imports", () => {
    expect(isFfmpegCoreAsset("/x/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url")).toBe(true);
    expect(isFfmpegCoreAsset("/x/node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js?url")).toBe(true);
    expect(isFfmpegCoreAsset("/x/node_modules/@ffmpeg/util/dist/esm/index.js")).toBe(false);
    expect(isFfmpegCoreAsset("/x/src/app.ts")).toBe(false);
  });
  it("plugin is inert when not desktop (load returns undefined)", () => {
    const p = stripFfmpegPlugin(false);
    expect((p.load as (id: string) => string | undefined)("/n/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url")).toBeUndefined();
  });
  it("plugin stubs the asset to an empty url string when desktop", () => {
    const p = stripFfmpegPlugin(true);
    const load = p.load as (id: string) => string | undefined;
    expect(load("/n/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url")).toBe('export default "";');
    expect(load("/n/src/app.ts")).toBeUndefined();
  });
});
