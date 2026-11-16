import { describe, expect, it, vi } from "vitest";
import type { EditingTemplate, MediaItem, Project } from "@openreel/core";
import { useProjectStore } from "./project-store";
import { useEngineStore } from "./engine-store";

const PATH_TEMPLATE_ID = "test-path-shape-template";
const PATH_DATA = "M 0 0 L 1 0 L 0.5 1 Z";
const POINTS = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }];
const transform = {
  position: { x: 0.5, y: 0.5 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

const pathTemplate = {
  id: PATH_TEMPLATE_ID,
  name: "Path",
  description: "",
  category: "test",
  tags: [],
  supportedTargets: ["video"],
  controls: [],
  recipe: {
    effects: [],
    audioEffects: [],
    overlays: [
      {
        type: "shape",
        trackType: "graphics",
        timing: "full",
        transform,
        keyframes: [],
        content: {
          shapeType: "path",
          width: 200,
          height: 200,
          style: { fillColor: "#ff0000", strokeColor: "#000000", strokeWidth: 1, opacity: 1 },
          pathData: PATH_DATA,
          points: POINTS,
          closed: true,
        },
      },
    ],
  },
} as unknown as EditingTemplate;

vi.mock("../services/lazy-engines", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/lazy-engines")>();
  return {
    ...original,
    getLoadedEngineModules: () => {
      const modules = original.getLoadedEngineModules();
      if (!modules) return modules;
      return {
        ...modules,
        getBuiltInEditingTemplate: (id: string) =>
          id === PATH_TEMPLATE_ID ? pathTemplate : modules.getBuiltInEditingTemplate(id),
      };
    },
  };
});

const project = (): Project => {
  const mediaItem: MediaItem = {
    id: "m1", name: "a.mp4", type: "video", fileHandle: null, blob: null,
    metadata: { duration: 10, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
    thumbnailUrl: null, waveformData: null,
  };
  return {
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [mediaItem] },
    timeline: {
      tracks: [{
        id: "t1", type: "video", name: "V", transitions: [], locked: false, hidden: false, muted: false, solo: false,
        clips: [{
          id: "c1", mediaId: "m1", trackId: "t1", startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
          effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
        }],
      }],
      subtitles: [], duration: 10, markers: [],
    },
  } as unknown as Project;
};

describe("applyEditingTemplate with a path shape", () => {
  it("creates a shape clip that keeps pathData, points and closed", async () => {
    const { loadEngineModules } = await import("../services/lazy-engines");
    await loadEngineModules();
    useEngineStore.getState().getGraphicsEngine()?.loadShapeClips([]);
    useProjectStore.getState().loadProject(project());

    const applicationId = useProjectStore.getState().applyEditingTemplate(PATH_TEMPLATE_ID, "c1");
    expect(applicationId).toBeTruthy();

    const shapes = useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips() ?? [];
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ shapeType: "path", pathData: PATH_DATA, points: POINTS, closed: true });
  });
});
