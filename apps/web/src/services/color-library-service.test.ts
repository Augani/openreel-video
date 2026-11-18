import "../test/install-local-storage-mock";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseCubeLut,
  parseCubeToLutData,
  lutToJson,
  createLutEntry,
  type Clip,
  type ClipColorGrading,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useColorLibraryStore } from "../stores/color-library-store";
import {
  applyLookToClips,
  applyLutEntryToClips,
  cubeTextFor,
  saveLookFromClip,
} from "./color-library-service";

vi.mock("../bridges/effects-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bridges/effects-bridge")>()),
  getEffectsBridge: () => ({ isInitialized: () => false }),
}));

const CUBE = `LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

const baseClip = (id: string, grade?: ClipColorGrading): Clip => ({
  id,
  mediaId: "media",
  trackId: "main",
  startTime: id === "a" ? 0 : 5,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  ...(grade ? { colorGrading: grade } : {}),
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
    rotation: 0,
  },
});
const grade = (id: string) => useProjectStore.getState().getClip(id)?.colorGrading;

beforeEach(async () => {
  useProjectStore.getState().createNewProject("Colour library");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        duration: 10,
        tracks: [
          {
            id: "main",
            name: "Main",
            type: "video",
            clips: [baseClip("a", { temperature: 30, pipelineVersion: 2 }), baseClip("b"), baseClip("c")],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
      },
    },
  });
  for (const l of useColorLibraryStore.getState().looks) await useColorLibraryStore.getState().removeLook(l.id);
  for (const l of useColorLibraryStore.getState().luts) await useColorLibraryStore.getState().removeLut(l.id);
});

describe("colour library persistence", () => {
  it("keeps LUTs and looks in IndexedDB across store reloads", async () => {
    const entry = createLutEntry("Rec709", lutToJson(parseCubeToLutData(CUBE)), { now: 1 });
    await useColorLibraryStore.getState().addLut(entry);
    const look = await saveLookFromClip("a", "Warm");
    await useColorLibraryStore.getState().addLook(look);
    useColorLibraryStore.setState({ luts: [], looks: [], loaded: false });
    await useColorLibraryStore.getState().refresh();
    expect(useColorLibraryStore.getState().luts.map((l) => l.name)).toEqual(["Rec709"]);
    expect(useColorLibraryStore.getState().looks[0].grading.temperature).toBe(30);
    expect(await useColorLibraryStore.getState().removeLut(entry.id)).toBe(true);
    expect(useColorLibraryStore.getState().luts).toEqual([]);
  });

  it("refuses to save a look from an ungraded clip", async () => {
    await expect(saveLookFromClip("b", "Nothing")).rejects.toThrow(/no grade/);
    await expect(saveLookFromClip("a", " ")).rejects.toThrow(/name/);
  });
});

describe("applying looks and LUTs", () => {
  it("applies a look to several clips as one undo step", async () => {
    const look = await saveLookFromClip("a", "Warm");
    const changed = await applyLookToClips(look, ["b", "c"]);
    expect(changed).toEqual(["b", "c"]);
    expect(grade("b")?.temperature).toBe(30);
    expect(grade("c")?.temperature).toBe(30);
    await useProjectStore.getState().undo();
    expect(grade("b")).toBeUndefined();
    expect(grade("c")).toBeUndefined();
    await useProjectStore.getState().redo();
    expect(grade("c")?.temperature).toBe(30);
  });

  it("skips unknown clips instead of failing", async () => {
    const look = await saveLookFromClip("a", "Warm");
    expect(await applyLookToClips(look, ["ghost", "b"])).toEqual(["b"]);
  });

  it("does not write a grade onto audio clips", async () => {
    const st = useProjectStore.getState();
    useProjectStore.setState({
      project: {
        ...st.project,
        timeline: {
          ...st.project.timeline,
          tracks: [
            ...st.project.timeline.tracks,
            { ...st.project.timeline.tracks[0], id: "aud", type: "audio", clips: [baseClip("snd")] },
          ],
        },
      },
    });
    const look = await saveLookFromClip("a", "Warm");
    expect(await applyLookToClips(look, ["snd", "b"])).toEqual(["b"]);
    expect(grade("snd")).toBeUndefined();
  });

  it("applies a library LUT to the input slot without touching the creative LUT", async () => {
    const entry = createLutEntry("Log2Rec", lutToJson(parseCubeToLutData(CUBE)));
    await applyLutEntryToClips(entry, ["a", "b"], "input", 0.5);
    expect(grade("a")?.inputLut?.intensity).toBe(0.5);
    expect(grade("a")?.lut).toBeUndefined();
    expect(grade("a")?.temperature).toBe(30);
    expect(grade("b")?.pipelineVersion).toBe(2);
    await applyLutEntryToClips(entry, ["a"], "creative");
    expect(grade("a")?.lut).toBeDefined();
    expect(grade("a")?.inputLut?.intensity).toBe(0.5);
    await useProjectStore.getState().undo();
    expect(grade("a")?.lut).toBeUndefined();
  });

  it("round trips the input LUT through updateColorGrading / getColorGrading", async () => {
    const lut = parseCubeToLutData(CUBE);
    await useProjectStore.getState().updateColorGrading("b", { inputLut: lut });
    expect(grade("b")?.inputLut?.data).toBeInstanceOf(Array);
    const back = useProjectStore.getState().getColorGrading("b");
    expect(back.inputLut?.data).toBeInstanceOf(Uint8Array);
    await useProjectStore.getState().updateColorGrading("b", { inputLut: undefined });
    expect(grade("b")).not.toHaveProperty("inputLut");
  });
});

describe(".cube export of a clip LUT", () => {
  it("writes a parseable file with the intensity baked in", async () => {
    // Table whose first entry (black) maps to white, so intensity 0.5 must land on mid grey.
    const lifted = CUBE.replace("LUT_3D_SIZE 2\n0 0 0\n", "LUT_3D_SIZE 2\n1 1 1\n");
    const lut = { ...lutToJson(parseCubeToLutData(lifted)), intensity: 0.5 };
    const parsed = parseCubeLut(cubeTextFor(lut, "grade"));
    expect(parsed.title).toBe("grade");
    expect(parsed.size).toBe(2);
    expect(parsed.data).toHaveLength(2 * 2 * 2 * 3);
    expect(parsed.data[0]).toBeCloseTo(0.5, 2);
    expect(parsed.data[1]).toBeCloseTo(0.5, 2);
    expect(parsed.data[2]).toBeCloseTo(0.5, 2);
    // an entry that was already identity is unchanged
    expect(parsed.data[3]).toBeCloseTo(1, 2);
    expect(parsed.data[4]).toBeCloseTo(0, 2);
  });
});
