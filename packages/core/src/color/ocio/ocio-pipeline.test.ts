import { describe, expect, it } from "vitest";
import {
  CpuHdrCompositor,
  computeLayerGeometry,
  decodeSourceToLinear,
  hdrFrameToSdrRgba,
  hdrPipelineFor,
  isHdrWorkingMode,
  ocioPipeline,
  ocioSourceDecode,
  overlayDecodeFor,
  prepareHdrGrade,
  encodeHdrFrameRgb,
  acesPipeline,
  registerAcesOutputTransform,
} from "../hdr-working";
import { acesOutputTransform } from "../aces-output";
import { buildOcioPipeline } from "./runtime";
import { loadFixtureConfig } from "./test-support";
import type { OcioProjectSettings } from "./settings";
import { ActionExecutor } from "../../actions/action-executor";
import { ActionHistory } from "../../actions/action-history";
import { ActionValidator } from "../../actions/action-validator";
import { buildPixelModel } from "../../render-cache/pixel-entities";
import { outputColorForExport } from "../../export/color-output";
import type { Project } from "../../types/project";

registerAcesOutputTransform(acesOutputTransform);

const handmade = loadFixtureConfig("handmade");
const settings: OcioProjectSettings = {
  configName: "config.ocio",
  configText: handmade.text,
  files: handmade.files,
  workingSpace: "Linear",
  defaultInputSpace: "sRGB Curve",
  display: "Test Display",
  view: "Film",
};

function pipeline() {
  const built = buildOcioPipeline(settings);
  if (!built.ok) throw new Error(built.error);
  return { parts: built.parts, pipeline: ocioPipeline(built.parts.key, built.parts.output, built.parts.overlay) };
}

const IDENT_T = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "stretch" as const };

describe("OCIO in the compositors (CPU reference)", () => {
  it("selects the OCIO pipeline when it is built and the ACES one while it is not", () => {
    const { pipeline: p } = pipeline();
    const project = { colorManagement: "ocio" as const };
    expect(hdrPipelineFor(project, p).kind).toBe("ocio");
    expect(hdrPipelineFor(project, null).kind).toBe("aces");
    expect(hdrPipelineFor({ colorManagement: "aces" }, p).kind).toBe("aces");
    expect(hdrPipelineFor({}, p).kind).toBe("scene-hdr");
    expect(isHdrWorkingMode({ colorManagement: "ocio" }, undefined)).toBe(true);
    expect(isHdrWorkingMode({}, undefined)).toBe(false);
  });

  it("decodes 8-bit and 16-bit codes through the clip's OCIO input transform", () => {
    const { parts } = pipeline();
    const decode = ocioSourceDecode(parts.input("Gamma 1.8 Mirror"));
    const codes = new Uint8ClampedArray([0, 128, 255, 255, 64, 64, 64, 128]);
    const layer = decodeSourceToLinear({ depth: 8, width: 2, height: 1, data: codes }, decode);
    const rgb = [0, 0, 0];
    parts.input("Gamma 1.8 Mirror").apply(0, 128 / 255, 1, rgb);
    expect(layer.data[0]).toBeCloseTo(rgb[0], 6);
    expect(layer.data[1]).toBeCloseTo(rgb[1], 6);
    expect(layer.data[2]).toBeCloseTo(rgb[2], 6);
    expect(layer.data[3]).toBe(1);
    expect(layer.data[7]).toBeCloseTo(128 / 255, 6);
    const wide = decodeSourceToLinear({ depth: 16, width: 1, height: 1, data: new Uint16Array([65535, 32768, 0, 65535]) }, decode);
    parts.input("Gamma 1.8 Mirror").apply(1, 32768 / 65535, 0, rgb);
    expect(wide.data[1]).toBeCloseTo(rgb[1], 6);
    // different spaces, different keys: the GPU keeps one shader per key
    expect(ocioSourceDecode(parts.input("Log Camera")).key).not.toBe(decode.key);
    const shared = pipeline();
    expect(overlayDecodeFor(shared.pipeline).ocio).toBe(shared.parts.overlay);
  });

  it("composites a layer and an overlay in the working space and shows the view", () => {
    const { parts, pipeline: p } = pipeline();
    const comp = new CpuHdrCompositor();
    comp.setColorPipeline(p);
    comp.setGraphicsWhite(203);
    comp.begin(4, 2);
    const src = new Uint8ClampedArray(4 * 2 * 4);
    for (let i = 0; i < 8; i++) src.set([i * 30, 255 - i * 20, 100, 255], i * 4);
    comp.drawCodes({ depth: 8, width: 4, height: 2, data: src }, ocioSourceDecode(parts.input("sRGB Curve")), {
      geometry: computeLayerGeometry(IDENT_T, 4, 2, 4, 2),
      opacity: 1,
      grade: null,
    });
    const overlay = new Uint8ClampedArray(4 * 2 * 4);
    overlay.set([255, 255, 255, 255], 0);
    comp.drawOverlay({ width: 4, height: 2, data: overlay });
    const view = comp.readSdrView();
    const expectPx = (pixel: number, codes: [number, number, number]) => {
      const mid = [0, 0, 0];
      const out = [0, 0, 0];
      parts.input("sRGB Curve").apply(codes[0] / 255, codes[1] / 255, codes[2] / 255, mid);
      parts.output.apply(mid[0], mid[1], mid[2], out);
      for (let c = 0; c < 3; c++) expect(view[pixel * 4 + c]).toBe(Math.round(Math.min(1, Math.max(0, out[c])) * 255));
    };
    expectPx(3, [90, 195, 100]);
    expectPx(7, [210, 115, 100]);
    // the opaque white overlay replaced pixel 0 with graphics white pushed through the same view
    const white = [0, 0, 0];
    parts.overlay.apply(1, 1, 1, white);
    parts.output.apply(white[0], white[1], white[2], white);
    expect(view[0]).toBe(Math.round(Math.min(1, Math.max(0, white[0])) * 255));
    expect(view[3]).toBe(255);
    expect(hdrFrameToSdrRgba(comp.readFrame(), p)).toEqual(view);
    const enc = comp.readEncodedRgb({ primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false, bitDepth: 8 });
    expect(enc.length).toBe(4 * 2 * 3);
    expect(encodeHdrFrameRgb(comp.readFrame(), { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false, bitDepth: 8 }, p)).toEqual(enc);
    // the same frame through the ACES pipeline differs: the OCIO view is really what runs
    const aces = hdrFrameToSdrRgba(comp.readFrame(), acesPipeline("srgb"));
    expect(Array.from(aces)).not.toEqual(Array.from(view));
  });

  it("grades in ACEScct like the ACES pipeline", () => {
    const { pipeline: p } = pipeline();
    expect(prepareHdrGrade({ temperature: 20 }, p)?.acescct).toBe(true);
  });
});

function makeProject(extra: Partial<Project["settings"]> = {}): Project {
  return {
    id: "ocio-project",
    name: "OCIO",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2, ...extra },
    mediaLibrary: { items: [] },
    timeline: {
      duration: 5,
      subtitles: [],
      markers: [],
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          clips: [
            {
              id: "c1",
              mediaId: "m1",
              trackId: "t1",
              startTime: 0,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [],
              audioEffects: [],
              transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
              volume: 1,
              keyframes: [],
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  } as unknown as Project;
}

describe("OCIO settings are undoable actions", () => {
  it("project/updateSettings stores the config and LUTs, one undo step each, and validates them", async () => {
    const history = new ActionHistory();
    const executor = new ActionExecutor(history);
    const project = makeProject();
    const act = (type: string, params: unknown) => ({ type, id: `a-${Math.random()}`, timestamp: Date.now(), params }) as never;
    const first = await executor.execute(act("project/updateSettings", { colorManagement: "ocio", ocio: settings }), project);
    expect(first.success).toBe(true);
    expect(project.settings.colorManagement).toBe("ocio");
    expect(project.settings.ocio?.files["film_twist.cube"]).toBe(handmade.files["film_twist.cube"]);
    const second = await executor.execute(act("project/updateSettings", { ocio: { ...settings, looks: ["Film Print"] } }), project);
    expect(second.success).toBe(true);
    expect(project.settings.ocio?.looks).toEqual(["Film Print"]);
    await executor.undo(project);
    expect(project.settings.ocio?.looks).toBeUndefined();
    expect(project.settings.colorManagement).toBe("ocio");
    await executor.redo(project);
    expect(project.settings.ocio?.looks).toEqual(["Film Print"]);
    await executor.undo(project);
    await executor.undo(project);
    expect(project.settings.colorManagement).toBeUndefined();
    expect(project.settings.ocio).toBeUndefined();
    const bad = await executor.execute(act("project/updateSettings", { colorManagement: "ocio", ocio: { ...settings, files: { "../x.cube": "x" } } }), project);
    expect(bad.success).toBe(false);
    const unknownMode = await executor.execute(act("project/updateSettings", { colorManagement: "nonsense" }), project);
    expect(unknownMode.success).toBe(false);
    expect(new ActionValidator().validate(act("project/updateSettings", { colorManagement: "ocio" }), project).valid).toBe(true);
  });

  it("clip/setOcioInputSpace sets, clears and undoes a per-clip input colour space", async () => {
    const executor = new ActionExecutor();
    const project = makeProject({ colorManagement: "ocio", ocio: settings });
    const act = (params: unknown) => ({ type: "clip/setOcioInputSpace", id: `a-${Math.random()}`, timestamp: Date.now(), params }) as never;
    const clip = () => project.timeline.tracks[0].clips[0] as { ocioInputSpace?: string };
    expect((await executor.execute(act({ clipId: "c1", ocioInputSpace: "Log Camera" }), project)).success).toBe(true);
    expect(clip().ocioInputSpace).toBe("Log Camera");
    expect((await executor.execute(act({ clipId: "c1", ocioInputSpace: null }), project)).success).toBe(true);
    expect(clip().ocioInputSpace).toBeUndefined();
    await executor.undo(project);
    expect(clip().ocioInputSpace).toBe("Log Camera");
    await executor.undo(project);
    expect(clip().ocioInputSpace).toBeUndefined();
    expect((await executor.execute(act({ clipId: "c1", ocioInputSpace: "" }), project)).success).toBe(false);
    expect((await executor.execute(act({ clipId: "nope", ocioInputSpace: "x" }), project)).success).toBe(false);
  });

  it("the render cache sees OCIO changes, and SDR exports of an OCIO project use the display encoding", () => {
    const plain = buildPixelModel(makeProject());
    const ocio = buildPixelModel(makeProject({ colorManagement: "ocio", ocio: settings }));
    const looked = buildPixelModel(makeProject({ colorManagement: "ocio", ocio: { ...settings, looks: ["Warm CDL"] } }));
    const g = (m: ReturnType<typeof buildPixelModel>) => JSON.stringify(m);
    expect(g(ocio)).not.toBe(g(plain));
    expect(g(looked)).not.toBe(g(ocio));
    expect(outputColorForExport({ settings: { colorManagement: "ocio" } }, undefined)).toBeNull();
    expect(outputColorForExport({ settings: { colorManagement: "ocio" } }, "pq")).not.toBeNull();
  });
});
