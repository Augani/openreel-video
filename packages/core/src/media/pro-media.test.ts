import { afterEach, describe, expect, it } from "vitest";
import { classifyProMedia, isCameraRawName, PRO_MEDIA_PROXY_PREFIX, proMediaProxyNotice, proMediaWebMessage } from "./pro-media";
import { isNativeContainerFile, isNativeContainerName, registerNativeFrameProvider } from "./native-frame-source";
import { MediaImportService } from "./media-import-service";

afterEach(() => registerNativeFrameProvider(null));

describe("pro media classification", () => {
  it("recognises an MXF by name or MIME type and nothing else", () => {
    expect(classifyProMedia("A001C002_220101_R1AB.MXF")).toEqual({ kind: "mxf", label: "MXF" });
    expect(classifyProMedia("clip", "application/mxf")).toEqual({ kind: "mxf", label: "MXF" });
    expect(classifyProMedia("clip.mp4", "video/mp4")).toBeNull();
    expect(isNativeContainerName("x.mxf")).toBe(true);
    expect(isNativeContainerName("x.mov")).toBe(false);
    expect(isNativeContainerFile(new File([new Uint8Array(1)], "cam.MXF"))).toBe(true);
    expect(isNativeContainerFile(new Blob([new Uint8Array(1)]))).toBe(false);
  });

  it("names camera RAW as unsupported with a way forward", () => {
    for (const name of ["A001.R3D", "shot.braw", "plate.ari", "frame.dng"]) expect(isCameraRawName(name)).toBe(true);
    expect(isCameraRawName("a.mxf")).toBe(false);
    expect(proMediaWebMessage({ name: "A001.R3D" })).toMatch(/RAW .* not supported.*ProRes or DNxHR/);
  });

  it("explains the web build's proxy path instead of a bare 'unsupported format'", () => {
    expect(proMediaWebMessage({ name: "clip.mxf", type: "" })).toMatch(/MXF cannot be opened in a browser.*desktop app/);
    expect(proMediaWebMessage({ name: "clip.mp4", type: "video/mp4" })).toBeNull();
    expect(proMediaProxyNotice("MXF").startsWith(PRO_MEDIA_PROXY_PREFIX)).toBe(true);
    expect(proMediaProxyNotice("MXF")).toMatch(/desktop app edits MXF directly and exports ProRes and DNxHR/);
  });
});

describe("importing an MXF", () => {
  const mxf = new File([new Uint8Array(8)], "cam.mxf", { type: "" });
  const info = { id: "/cards/cam.mxf", width: 1920, height: 1080, frameRate: 25, duration: 8, codec: "dnxhd", container: "mxf", audio: { trackCount: 2, channels: 1, sampleRate: 48000 } };

  it("desktop: reads the file through the native source (no mediabunny demuxer), with its audio tracks", async () => {
    registerNativeFrameProvider({ claim: async () => info, getFrame: async () => null });
    const engine = {
      initialize: async () => undefined,
      isAvailable: () => true,
      validateFormat: async () => {
        throw new Error("the MXF must not be sent to the mediabunny validator");
      },
      extractMetadata: async () => ({
        duration: 8, width: 1920, height: 1080, frameRate: 25, codec: "dnxhd", sampleRate: 48000, channels: 1, fileSize: 8, mimeType: "video/mxf",
        hasVideo: true, hasAudio: true, rotation: 0, canDecode: true, canDecodeVideo: true, audioTrackCount: 2,
      }),
      generateThumbnails: async () => [],
      generateWaveform: async () => ({ peaks: new Float32Array(0), rms: new Float32Array(0), sampleRate: 100, duration: 8, samplesPerSecond: 100 }),
    };
    const service = new MediaImportService(engine as never, {} as never);
    const result = await service.importMedia(mxf, { generateThumbnails: false, generateWaveform: false, useFallback: false });
    expect(result.success).toBe(true);
    expect(result.media).toMatchObject({ type: "video", name: "cam.mxf", metadata: { codec: "dnxhd", audioTrackCount: 2, canDecode: true } });
  });

  it("web: without a native provider the MXF is not failed outright; it goes to the in-browser converter, and a failure there says what to do", async () => {
    const engine = { initialize: async () => undefined, isAvailable: () => false, validateFormat: async () => ({ supported: false, format: null, error: "Unsupported format: unknown" }) };
    const failing = { transcodeToCompatible: async () => { throw new Error("no demuxer"); } };
    const service = new MediaImportService(engine as never, failing as never);
    const result = await service.importMedia(mxf, { useFallback: true });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MXF cannot be opened in a browser/);
    expect(result.error).toMatch(/desktop app/);
  });
});
