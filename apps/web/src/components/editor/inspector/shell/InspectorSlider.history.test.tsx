import "../../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TitleEngine, type TextClip } from "@openreel/core";
import { useEngineStore } from "../../../../stores/engine-store";
import { useProjectStore } from "../../../../stores/project-store";
import { PrimaryTextProperties } from "../PrimaryTextProperties";

let original: TextClip;
const current = () => useProjectStore.getState().getTextClip(original.id)!;
const undo = () => act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });

beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine() });
  useProjectStore.getState().createNewProject("Inspector gesture history");
  const track = useProjectStore.getState().project.timeline.tracks.find(item => item.type === "text")!;
  original = useProjectStore.getState().createTextClip(track.id, 0, "Golden Hour", 4, {
    fontSize: 96, lineHeight: 1.05, letterSpacing: -1.92,
    shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ee55aa", speed: 0.4 } },
  })!;
  useProjectStore.getState().actionHistory.clear();
});
afterEach(cleanup);

describe("inspector slider gesture history", () => {
  it("undoes a held-key adjustment together and keeps the next style edit separate", async () => {
    render(<PrimaryTextProperties clipId={original.id} />);
    const slider = screen.getByRole("slider", { name: "Line height" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight", repeat: true });
    fireEvent.keyDown(slider, { key: "ArrowRight", repeat: true });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(current().style.lineHeight).toBe(1.08);
    const adjusted = structuredClone(current());
    fireEvent.click(screen.getByRole("switch", { name: "Outline" }));
    await undo();
    expect(current()).toEqual(adjusted);
    await undo();
    expect(current()).toEqual(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(current()).toEqual(adjusted);
  });

  it("keeps separate key presses as separate adjustments", async () => {
    render(<PrimaryTextProperties clipId={original.id} />);
    const slider = screen.getByRole("slider", { name: "Letter spacing" });
    for (let index = 0; index < 2; index++) {
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      fireEvent.keyUp(slider, { key: "ArrowRight" });
    }
    expect(current().style.letterSpacing).toBeCloseTo(-1.728);
    await undo();
    expect(current().style.letterSpacing).toBeCloseTo(-1.824);
    await undo();
    expect(current()).toEqual(original);
  });

  it("closes an unfinished gesture when the inspector unmounts", async () => {
    const view = render(<PrimaryTextProperties clipId={original.id} />);
    const slider = screen.getByRole("slider", { name: "Line height" });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    fireEvent.keyDown(slider, { key: "ArrowUp", repeat: true });
    view.unmount();
    useProjectStore.getState().updateTextStyle(original.id, { color: "#11aabb" });
    await undo();
    expect(current().style.lineHeight).toBe(1.07);
    expect(current().style.color).toBe(original.style.color);
    await undo();
    expect(current()).toEqual(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
});
