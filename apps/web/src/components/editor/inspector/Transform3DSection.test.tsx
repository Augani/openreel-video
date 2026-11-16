import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine, type TextClip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { Transform3DSection } from "./Transform3DSection";

vi.mock("../../../bridges/effects-bridge", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../bridges/effects-bridge")>()),
  getEffectsBridge: () => ({ isInitialized: () => false }),
}));
const state = () => useProjectStore.getState();
let original: TextClip;
const current = () => state().getTextClip(original.id)!;
const undo = () => act(async () => { expect((await state().undo()).success).toBe(true); });

beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  state().createNewProject("3D inspector");
  const track = state().project.timeline.tracks.find(t => t.type === "text")!;
  original = state().createTextClip(track.id, 0, "Golden Hour", 5, {
    fontSize: 96, shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ee55aa", speed: 0.4 } },
  })!;
  state().actionHistory.clear();
  state().actionHistory.setAutoGroupWindow(0);
});
afterEach(cleanup);

describe("direct shadcn 3D controls", () => {
  it("commits a numeric rotation without losing the title material and restores the control on Undo", async () => {
    render(<Transform3DSection clipId={original.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Rotation X value" }));
    const input = screen.getByRole("textbox", { name: "Rotation X value" });
    fireEvent.change(input, { target: { value: "-24" } });
    fireEvent.blur(input);
    await waitFor(() => expect(current().transform.rotate3d).toEqual({ x: -24, y: 0, z: 0 }));
    expect(state().project.textClips?.[0]).toEqual(current());
    expect(current().style).toEqual(original.style);
    expect(screen.getByRole("slider", { name: "Rotation X" })).toHaveAttribute("aria-valuenow", "-24");
    await undo();
    expect(current()).toEqual(original);
    expect(screen.getByRole("slider", { name: "Rotation X" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("groups held-key steps and keeps a subsequent perspective edit separate", async () => {
    render(<Transform3DSection clipId={original.id} />);
    const slider = screen.getByRole("slider", { name: "Rotation Y" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight", repeat: true });
    fireEvent.keyDown(slider, { key: "ArrowRight", repeat: true });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    await waitFor(() => expect(current().transform.rotate3d?.y).toBe(3));
    const rotated = structuredClone(current());
    const perspective = screen.getByRole("slider", { name: "Perspective" });
    fireEvent.keyDown(perspective, { key: "ArrowLeft" });
    fireEvent.keyUp(perspective, { key: "ArrowLeft" });
    await waitFor(() => expect(current().transform.perspective).toBe(990));
    await undo();
    expect(current()).toEqual(rotated);
    await undo();
    expect(current()).toEqual(original);
    expect(state().canUndo()).toBe(false);
  });

});
