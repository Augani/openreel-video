import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TitleEngine, type TextClip } from "@openreel/core";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { TextSection } from "./TextSection";

let original: TextClip;
function load(clips: TextClip[]) {
  const project = useProjectStore.getState().project;
  useProjectStore.getState().loadProject({
    ...project,
    textClips: clips,
    timeline: {
      ...project.timeline, duration: 5,
      tracks: [{
        id: "titles", name: "Titles", type: "text", clips: [], transitions: [],
        hidden: false, locked: false, muted: false, solo: false,
      }],
    },
  });
}
const current = (id = original.id) => useEngineStore.getState().getTitleEngine()!.getTextClip(id)!;

beforeEach(() => {
  useProjectStore.getState().createNewProject("3D title history");
  original = new TitleEngine().createTextClip({ trackId: "titles", text: "Original", startTime: 0, duration: 5 });
  load([original]);
});
afterEach(() => {
  cleanup();
  useEngineStore.getState().getTitleEngine()?.clear();
});

describe("Advanced text properties and history", () => {

  it("bounds a live font-size edit before saving it and restores the original in one Undo", async () => {
    await act(async () => { render(<TextSection clipId={original.id} />); });
    const size = screen.getByRole("spinbutton", { name: "Size" });
    fireEvent.focus(size);
    for (const value of ["5", "50", "5000"]) {
      await act(async () => { fireEvent.change(size, { target: { value } }); });
    }
    expect(current().style.fontSize).toBe(500);
    fireEvent.blur(size);
    expect(useProjectStore.getState().project.textClips?.[0].style.fontSize).toBe(500);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(current().style.fontSize).toBe(500);
  });

  it("closes a numeric edit on unmount before an unrelated property change", async () => {
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TextSection clipId={original.id} />); });
    const size = screen.getByRole("spinbutton", { name: "Size" });
    fireEvent.focus(size);
    await act(async () => { fireEvent.change(size, { target: { value: "80" } }); });
    await act(async () => { view!.unmount(); });
    await act(async () => { useProjectStore.getState().updateTextStyle(original.id, { letterSpacing: 5 }); });
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current().style.fontSize).toBe(80);
    expect(current().style.letterSpacing).toBe(original.style.letterSpacing);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(original);
  });

  it("keeps numeric drafts and Undo separate when changing the inspected title", async () => {
    const second = { ...original, id: "second", text: "Second", style: { ...original.style, fontSize: 111 } };
    load([original, second]);
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TextSection clipId={original.id} />); });
    fireEvent.focus(screen.getByRole("spinbutton", { name: "Size" }));
    await act(async () => { fireEvent.change(screen.getByRole("spinbutton", { name: "Size" }), { target: { value: "80" } }); });
    await act(async () => { view!.rerender(<TextSection clipId={second.id} />); });
    const size = screen.getByRole("spinbutton", { name: "Size" });
    expect(size).toHaveValue(111);
    fireEvent.focus(size);
    await act(async () => { fireEvent.change(size, { target: { value: "120" } }); });
    fireEvent.blur(size);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current(second.id)).toEqual(second);
    expect(current().style.fontSize).toBe(80);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(original);
  });

  it("keeps decimal keyboard steps exact in saved title properties", async () => {
    load([{ ...original, style: { ...original.style, lineHeight: 0.7 } }]);
    await act(async () => { render(<TextSection clipId={original.id} />); });
    const height = screen.getByRole("spinbutton", { name: "Line Height" });
    fireEvent.focus(height);
    await act(async () => { fireEvent.keyDown(height, { key: "ArrowUp" }); });
    expect(current().style.lineHeight).toBe(0.8);
    fireEvent.blur(height);
    expect(useProjectStore.getState().project.textClips?.[0].style.lineHeight).toBe(0.8);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current().style.lineHeight).toBe(0.7);
  });

  it("restores the original absent settings and rotation in one Undo, then Redo restores both", async () => {
    await act(async () => { render(<TextSection clipId={original.id} />); });
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "3D Text" })); });
    expect(current().text3d?.enabled).toBe(true);
    expect(current().transform.rotate3d).toEqual({ x: -10, y: 18, z: 0 });
    const enabled = structuredClone(current());
    expect(useProjectStore.getState().project.textClips?.[0]).toEqual(enabled);
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(current()).toEqual(original);
    expect(current()).not.toHaveProperty("text3d");
    expect(useProjectStore.getState().project.textClips?.[0]).toEqual(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
    await act(async () => { expect((await useProjectStore.getState().redo()).success).toBe(true); });
    expect(current()).toEqual(enabled);
    expect(useProjectStore.getState().project.textClips?.[0]).toEqual(enabled);
  });

  it("groups all selected titles and keeps an existing custom rotation", async () => {
    const second = {
      ...original, id: "second", text: "Second",
      transform: { ...original.transform, rotate3d: { x: 25, y: -40, z: 12 } },
    };
    load([original, second]);
    await act(async () => { render(<TextSection clipId={original.id} clipIds={[original.id, second.id]} />); });
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "3D Text" })); });
    expect(current(second.id).text3d?.enabled).toBe(true);
    expect(current(second.id).transform.rotate3d).toEqual(second.transform.rotate3d);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(original);
    expect(current(second.id)).toEqual(second);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

});
