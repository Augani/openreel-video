import { describe, it, expect } from "vitest";
import {
  CHANNELS,
  auroraPreviewSessionEventSchema,
  auroraPreviewSessionStartArgsSchema,
  auroraPreviewSessionStartResultSchema,
  auroraRenderPreviewArgsSchema,
  auroraRenderPreviewResultSchema,
  auroraSequenceFrameResultSchema,
  auroraSequenceSessionEventSchema,
  auroraSequenceSessionStartArgsSchema,
  auroraSequenceSessionStartResultSchema,
  hardwareInfoSchema,
  riggingBackendProbeSchema,
  rigHumanoidModelArgsSchema,
  rigHumanoidModelResultSchema,
} from "../src/shared/ipc-contract";
import { resolveExportArgs } from "../src/main/ipc/export";

describe("ipc-contract", () => {
  it("exposes the probeHardware channel name", () => {
    expect(CHANNELS.probeHardware).toBe("openreel:probeHardware");
  });

  it("exposes the rigging backend probe channel name", () => {
    expect(CHANNELS.riggingProbeBackend).toBe("openreel:rigging:probeBackend");
  });

  it("exposes the humanoid rigging job channel name", () => {
    expect(CHANNELS.riggingRigHumanoidModel).toBe("openreel:rigging:rigHumanoidModel");
  });

  it("exposes the Aurora preview channel name", () => {
    expect(CHANNELS.auroraRenderPreview).toBe("openreel:aurora:renderPreview");
  });

  it("exposes the Aurora preview-session channel names", () => {
    expect(CHANNELS.auroraStartPreviewSession).toBe(
      "openreel:aurora:startPreviewSession",
    );
    expect(CHANNELS.auroraCancelPreviewSession).toBe(
      "openreel:aurora:cancelPreviewSession",
    );
    expect(CHANNELS.auroraPreviewEvent).toBe("openreel:aurora:previewEvent");
  });

  it("exposes the Aurora sequence-session channel names", () => {
    expect(CHANNELS.auroraStartSequenceSession).toBe(
      "openreel:aurora:startSequenceSession",
    );
    expect(CHANNELS.auroraCancelSequenceSession).toBe(
      "openreel:aurora:cancelSequenceSession",
    );
    expect(CHANNELS.auroraSequenceEvent).toBe("openreel:aurora:sequenceEvent");
  });

  it("validates a well-formed hardware info object", () => {
    const ok = hardwareInfoSchema.safeParse({
      cpu: { model: "M3", physicalCores: 8, logicalCores: 8 },
      memory: { totalBytes: 1, freeBytes: 1 },
      gpus: ["Apple M3"],
      encoders: ["h264_videotoolbox"],
      platform: "darwin",
      arch: "arm64",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a malformed hardware info object", () => {
    const bad = hardwareInfoSchema.safeParse({ cpu: { model: 1 } });
    expect(bad.success).toBe(false);
  });

  it("validates a rigging backend probe result", () => {
    const ok = riggingBackendProbeSchema.safeParse({
      available: true,
      provider: "blender",
      mode: "system",
      path: "/Applications/Blender.app/Contents/MacOS/Blender",
      version: "4.3.2",
    });
    expect(ok.success).toBe(true);
  });

  it("validates humanoid rigging job args and result", () => {
    const args = rigHumanoidModelArgsSchema.safeParse({
      modelUrl: "file:///tmp/astronaut.glb",
      outputPath: "/tmp/astronaut-rigged.glb",
      name: "Astronaut",
      overwriteExisting: true,
    });
    expect(args.success).toBe(true);

    const result = rigHumanoidModelResultSchema.safeParse({
      ok: true,
      provider: "blender",
      inputUrl: "file:///tmp/astronaut.glb",
      outputUrl: "file:///tmp/astronaut-rigged.glb",
      outputPath: "/tmp/astronaut-rigged.glb",
      armatureName: "Astronaut Armature",
      createdArmature: true,
      preservedExistingArmature: false,
      skinnedMeshCount: 1,
      meshCount: 1,
      boneCount: 16,
      warnings: [],
    });
    expect(result.success).toBe(true);
  });

  it("validates the Aurora preview request/response payloads", () => {
    const args = auroraRenderPreviewArgsSchema.safeParse({
      scene: { id: "scene-1" },
      assets: [{ id: "asset-1" }],
      width: 640,
      height: 360,
      timeSeconds: 1.25,
      quality: "preview",
    });
    expect(args.success).toBe(true);

    const result = auroraRenderPreviewResultSchema.safeParse({
      backend: "cpu",
      pngBase64: "iVBORw0KGgoAAAANSUhEUg==",
      dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      width: 640,
      height: 360,
      coveredPixels: 128,
      shadowedPixels: 12,
      renderMs: 4.2,
    });
    expect(result.success).toBe(true);
  });

  it("validates Aurora preview-session payloads", () => {
    const startArgs = auroraPreviewSessionStartArgsSchema.safeParse({
      sessionId: "aurora-session-1",
      scene: { id: "scene-1" },
      assets: [{ id: "asset-1" }],
      width: 640,
      height: 360,
      quality: "preview",
    });
    expect(startArgs.success).toBe(true);

    const startResult = auroraPreviewSessionStartResultSchema.safeParse({
      sessionId: "aurora-session-1",
    });
    expect(startResult.success).toBe(true);

    const event = auroraPreviewSessionEventSchema.safeParse({
      kind: "update",
      sessionId: "aurora-session-1",
      stage: "refine",
      progress: 0.66,
      done: false,
      targetWidth: 640,
      targetHeight: 360,
      result: {
        backend: "native",
        pngBase64: "iVBORw0KGgoAAAANSUhEUg==",
        dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        width: 320,
        height: 180,
        coveredPixels: 96,
        shadowedPixels: 11,
        renderMs: 3.1,
      },
    });
    expect(event.success).toBe(true);
  });

  it("validates Aurora sequence-session payloads", () => {
    const startArgs = auroraSequenceSessionStartArgsSchema.safeParse({
      sessionId: "aurora-sequence-1",
      scene: { id: "scene-1" },
      assets: [{ id: "asset-1" }],
      width: 640,
      height: 360,
      frameRate: 24,
      durationSeconds: 2,
      quality: "final",
    });
    expect(startArgs.success).toBe(true);

    const startResult = auroraSequenceSessionStartResultSchema.safeParse({
      sessionId: "aurora-sequence-1",
    });
    expect(startResult.success).toBe(true);

    const frameResult = auroraSequenceFrameResultSchema.safeParse({
      backend: "native",
      rgba: new Uint8Array(16),
      width: 2,
      height: 2,
      coveredPixels: 4,
      shadowedPixels: 1,
      renderMs: 2.4,
    });
    expect(frameResult.success).toBe(true);

    const event = auroraSequenceSessionEventSchema.safeParse({
      kind: "frame",
      sessionId: "aurora-sequence-1",
      frameIndex: 1,
      totalFrames: 48,
      timeSeconds: 1 / 24,
      progress: 2 / 48,
      done: false,
      result: {
        backend: "native",
        rgba: new Uint8Array(16),
        width: 2,
        height: 2,
        coveredPixels: 4,
        shadowedPixels: 1,
        renderMs: 2.4,
      },
    });
    expect(event.success).toBe(true);
  });
});

describe("resolveExportArgs", () => {
  it("carries mode/quality/encoder/proresProfile into ExportArgs", () => {
    const out = resolveExportArgs(
      {
        width: 1920, height: 1080, frameRate: 30, codec: "h265", format: "mp4",
        bitrateKbps: 15000, outputPath: "/tmp/o.mp4", totalFrames: 100,
        audioSampleRate: 48000, audioChannels: 2,
        encodeMode: "smallest", quality: 90,
      },
      "darwin",
      ["libx265", "hevc_videotoolbox"],
      "/tmp/a.wav",
    );
    expect(out.mode).toBe("smallest");
    expect(out.quality).toBe(90);
    expect(out.encoder).toBe("libx265");
    expect(out.codec).toBe("hevc");
  });
});
