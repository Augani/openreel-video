import "../../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TitleEngine, type TextClip } from "@openreel/core";
import { useProjectStore } from "../../../../stores/project-store";
import { useEngineStore } from "../../../../stores/engine-store";
import { useUIStore } from "../../../../stores/ui-store";
import { TextSection } from "../TextSection";
import { TransformTab } from "../tabs/TransformTab";

let original: TextClip;
const current = () => useProjectStore.getState().getTextClip(original.id)!;
const undo = () => act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });

function TransformHarness() {
  useProjectStore(state => state.project);
  return <TransformTab clipId={original.id} clipType="text" selectedClip={{ id: original.id, mediaId: "text" }}
    showTransformControls showVideoControls={false} transform={current().transform} canvasWidth={1920} canvasHeight={1080}
    handleTransformChange={changes => { useProjectStore.getState().updateTextTransform(original.id, changes); }}/>
}

beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine() });
  useProjectStore.getState().createNewProject("Shared inspector controls");
  const track = useProjectStore.getState().project.timeline.tracks.find(item => item.type === "text")!;
  original = useProjectStore.getState().createTextClip(track.id, 0, "Golden Hour", 5, {
    shader: { shaderId: "watercolor", progress: 0.5, params: { scale: 5, bleed: 0.5 } },
  })!;
  useUIStore.setState({ selectedItems: [{ id: original.id, type: "text-clip" }] });
  useProjectStore.getState().actionHistory.clear();
});
afterEach(cleanup);

describe("shared inspector authoring history", { timeout: 30000 }, () => {
  it("undoes a held shader-slider key gesture as one edit", async () => {
    await act(async () => { render(<TextSection clipId={original.id}/>); });
    const slider = screen.getByRole("slider", { name: "Bleed" });
    for (let index = 0; index < 3; index++) {
      await act(async () => { fireEvent.keyDown(slider, { key: "ArrowRight", repeat: index > 0 }); });
    }
    await act(async () => { fireEvent.keyUp(slider, { key: "ArrowRight" }); });
    expect(current().style.shader?.params.bleed).toBe(0.65);
    await undo();
    expect(current()).toEqual(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("does not quantize a precise shader value just by opening and leaving its editor", async () => {
    useProjectStore.getState().updateTextStyle(original.id, {
      shader: { ...original.style.shader!, params: { scale: 5, bleed: 0.543210 } },
    });
    useProjectStore.getState().actionHistory.clear();
    await act(async () => { render(<TextSection clipId={original.id}/>); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Edit Bleed value" })); });
    await act(async () => { fireEvent.blur(screen.getByRole("textbox", { name: "Bleed value" })); });
    expect(current().style.shader?.params.bleed).toBe(0.543210);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("keeps the minus sign and fractional canvas position while typing, then undoes it once", async () => {
    render(<TransformHarness/>);
    const input = screen.getByRole("textbox", { name: "Position X" });
    await act(async () => { fireEvent.focus(input); fireEvent.change(input, { target: { value: "-" } }); });
    expect(input).toHaveValue("-");
    expect(current()).toEqual(original);
    for (const value of ["-1", "-12", "-12.75"]) await act(async () => { fireEvent.change(input, { target: { value } }); });
    expect(input).toHaveValue("-12.75");
    expect(current().transform.position.x).toBe(-12.75 / 1920);
    await act(async () => { fireEvent.blur(input); });
    await undo();
    expect(current()).toEqual(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
});
