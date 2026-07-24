import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeLayer,
} from "@openreel/core/motion/types";
import type {
  EditingHost,
  ExportMotionSceneOptions,
  ExportMotionSceneResult,
} from "./host";
import type { Project } from "@openreel/core/types/project";

const COMP_ID = "comp-export";
const SHAPE_ID = "layer-shape";

function shapeLayer(): MotionShapeLayer {
  return {
    id: SHAPE_ID,
    type: "shape",
    name: "Shape",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 200,
    height: 120,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 0.8 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}

function baseComposition(overrides: Partial<MotionComposition> = {}): MotionComposition {
  return {
    id: COMP_ID,
    name: "Export Scene",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 6,
    backgroundColor: "#101820",
    layers: [shapeLayer() as MotionLayer],
    assets: [],
    variables: [],
    markers: [],
    lights: [],
    createdAt: 1,
    modifiedAt: 1,
    ...overrides,
  };
}

function projectWith(composition: MotionComposition): Project {
  return {
    ...makeEmptyProject(),
    motionCompositions: [composition],
  } as unknown as Project;
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Expected data object");
  return value as Record<string, unknown>;
}

interface ExporterStubResult {
  readonly calls: ExportMotionSceneOptions[];
}

function hostWithExporter(
  composition: MotionComposition,
  impl: (options: ExportMotionSceneOptions) => Promise<ExportMotionSceneResult>,
): { host: EditingHost; stub: ExporterStubResult } {
  const base = new HeadlessHost(projectWith(composition));
  const stub: ExporterStubResult = { calls: [] };
  const host: EditingHost = Object.assign(base, {
    exportMotionScene: (options: ExportMotionSceneOptions) => {
      stub.calls.push(options);
      return impl(options);
    },
  });
  return { host, stub };
}

describe("export_motion_video (gap 1)", () => {
  it("is registered as an expensive export tool", () => {
    const tool = getTool("export_motion_video");
    expect(tool).toBeDefined();
    expect(tool?.expensive).toBe(true);
    expect(tool?.domain).toBe("export");
    expect(tool?.readOnly).toBe(false);
  });

  it("fails gracefully when the host cannot export motion scenes", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const result = await executeTool(
      "export_motion_video",
      { compositionId: COMP_ID },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.summary.toLowerCase()).toContain("export");
    expect(result.summary.toLowerCase()).toContain("not supported");
  });

  it("fails with NOT_FOUND when the composition does not exist", async () => {
    const { host } = hostWithExporter(baseComposition(), async () => {
      throw new Error("should not be called");
    });
    const result = await executeTool(
      "export_motion_video",
      { compositionId: "missing" },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("fails INVALID_PARAMS when compositionId is missing", async () => {
    const { host } = hostWithExporter(baseComposition(), async () => {
      throw new Error("should not be called");
    });
    const result = await executeTool("export_motion_video", {}, host);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects an unknown format with INVALID_PARAMS", async () => {
    const { host } = hostWithExporter(baseComposition(), async () => {
      throw new Error("should not be called");
    });
    const result = await executeTool(
      "export_motion_video",
      { compositionId: COMP_ID, format: "gif" },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("exports mp4 and reports the encoded format", async () => {
    const { host, stub } = hostWithExporter(baseComposition(), async (options) => ({
      filename: options.filename ?? "export-scene.mp4",
      width: 1280,
      height: 720,
      duration: 6,
      framesRendered: 180,
      requestedFormat: "mp4",
      encodedFormat: "mp4",
      normalizedToH264: false,
    }));
    const result = await executeTool(
      "export_motion_video",
      { compositionId: COMP_ID, format: "mp4" },
      host,
    );
    expect(result.ok).toBe(true);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].format).toBe("mp4");
    const data = dataRecord(result.data);
    expect(data.encodedFormat).toBe("mp4");
    expect(data.framesRendered).toBe(180);
    expect(data.filename).toBe("export-scene.mp4");
  });

  it("passes acknowledgeH264Fallback through for transparent formats", async () => {
    const { host, stub } = hostWithExporter(baseComposition(), async () => ({
      filename: "export-scene.mp4",
      width: 1280,
      height: 720,
      duration: 6,
      framesRendered: 180,
      requestedFormat: "mov-prores4444",
      encodedFormat: "mp4",
      normalizedToH264: true,
      note: "Encoded H.264 (ProRes unavailable on web)",
    }));
    const result = await executeTool(
      "export_motion_video",
      {
        compositionId: COMP_ID,
        format: "mov-prores4444",
        acknowledgeH264Fallback: true,
      },
      host,
    );
    expect(result.ok).toBe(true);
    expect(stub.calls[0].acknowledgeH264Fallback).toBe(true);
    const data = dataRecord(result.data);
    expect(data.normalizedToH264).toBe(true);
    expect(data.encodedFormat).toBe("mp4");
  });

  it("surfaces the guardrail error when the host requires acknowledgement", async () => {
    const { host } = hostWithExporter(baseComposition(), async () => {
      throw new Error(
        "Web export can't produce ProRes or alpha — encode H.264 without transparency by passing acknowledgeH264Fallback:true, or use the desktop app.",
      );
    });
    const result = await executeTool(
      "export_motion_video",
      { compositionId: COMP_ID, format: "webm-alpha" },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.summary.toLowerCase()).toContain("acknowledgeh264fallback");
  });

  it("passes a custom filename through to the exporter", async () => {
    const { host, stub } = hostWithExporter(baseComposition(), async (options) => ({
      filename: options.filename ?? "fallback.mp4",
      width: 1280,
      height: 720,
      duration: 6,
      framesRendered: 60,
      requestedFormat: "mp4",
      encodedFormat: "mp4",
      normalizedToH264: false,
    }));
    const result = await executeTool(
      "export_motion_video",
      { compositionId: COMP_ID, filename: "hero-shot.mp4" },
      host,
    );
    expect(result.ok).toBe(true);
    expect(stub.calls[0].filename).toBe("hero-shot.mp4");
  });
});
