import "../../../test/install-local-storage-mock";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Clip } from "@openreel/core";
import { createLutEntry, lutToJson, parseCubeToLutData } from "@openreel/core";
import { ColorLibrarySection } from "./ColorLibrarySection";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useColorLibraryStore } from "../../../stores/color-library-store";

vi.mock("../../../bridges/effects-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../bridges/effects-bridge")>()),
  getEffectsBridge: () => ({ isInitialized: () => false }),
}));

const CUBE = "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";

const clip = (id: string, grade?: Clip["colorGrading"]): Clip => ({
  id,
  mediaId: "m",
  trackId: "main",
  startTime: 0,
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
  useProjectStore.getState().createNewProject("UI");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: [
          {
            id: "main",
            name: "Main",
            type: "video",
            clips: [clip("a", { temperature: 12, pipelineVersion: 2 }), clip("b")],
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
  useUIStore.setState({ selectedItems: [{ type: "clip", id: "b" }] });
  for (const l of useColorLibraryStore.getState().looks) await useColorLibraryStore.getState().removeLook(l.id);
  for (const l of useColorLibraryStore.getState().luts) await useColorLibraryStore.getState().removeLut(l.id);
});
afterEach(cleanup);

describe("ColorLibrarySection", () => {
  it("saves the inspected clip's grade as a look and applies it to the selected clip", async () => {
    render(<ColorLibrarySection clipId="a" />);
    fireEvent.change(await screen.findByLabelText("Look name"), { target: { value: "Sunset" } });
    fireEvent.click(screen.getByLabelText("Save grade as look"));
    const apply = await screen.findByLabelText("Apply look Sunset to selected clips");
    fireEvent.click(apply);
    await waitFor(() => expect(grade("b")?.temperature).toBe(12));
    await useProjectStore.getState().undo();
    expect(grade("b")).toBeUndefined();
  });

  it("lists library LUTs and applies one to the Input slot", async () => {
    await useColorLibraryStore.getState().addLut(createLutEntry("LogC", lutToJson(parseCubeToLutData(CUBE))));
    render(<ColorLibrarySection clipId="a" />);
    fireEvent.click(await screen.findByLabelText("Apply LogC as input LUT"));
    await waitFor(() => expect(grade("b")?.inputLut).toBeDefined());
    expect(grade("b")?.lut).toBeUndefined();
    expect(screen.getByLabelText("Export input LUT as .cube")).toBeTruthy();
  });
});
