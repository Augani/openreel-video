import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine, type Track } from "@openreel/core";
import { TextClipComponent } from "./TextClipComponent";
import { ShapeClipComponent } from "./ShapeClipComponent";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";

const track: Track = { id: "titles", name: "Titles", type: "text", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false };
beforeEach(() => {
  useProjectStore.getState().createNewProject("Overlay selection QA");
  useUIStore.setState({ snapSettings: { ...useUIStore.getState().snapSettings, enabled: false } });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return new DOMRect(this.hasAttribute("data-timeline-clip") ? 150 : 0, 0, 300, 100);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe.each(["text", "shape"] as const)("%s clip selection and dragging", (kind) => {
  const mount = () => {
    const move = vi.fn(async () => {}), select = vi.fn();
    const props = { pixelsPerSecond: 50, isSelected: false, onSelect: select, onTrim: vi.fn(), onMoveClip: move, allTracks: [track], trackHeights: new Map([[track.id, 34]]), timelineRef: { current: null } };
    render(<div>{kind === "text" ? <TextClipComponent {...props} textClip={new TitleEngine().createTextClip({ trackId: track.id, text: "Overlay", startTime: 3, duration: 3 })}/> : <ShapeClipComponent {...props} shapeClip={new GraphicsEngine().createRectangle(track.id, 3, 3, 100, 100)}/>}</div>);
    return { move, select, button: screen.getByRole("button", { name: /Select .*clip/ }) };
  };
  it("selects on a click without executing a move or placing the overlay on another track", async () => {
    const { move, select, button } = mount();
    fireEvent.mouseDown(button, { button: 0, clientX: 170, clientY: 15 });
    fireEvent.mouseMove(window, { clientX: 171, clientY: 15 });
    await act(async () => { fireEvent.mouseUp(window); });
    expect(select).toHaveBeenCalledOnce(); expect(move).not.toHaveBeenCalled();
  });
  it("still commits a drag after the pointer crosses the movement threshold", async () => {
    const { move, button } = mount();
    fireEvent.mouseDown(button, { button: 0, clientX: 170, clientY: 15 });
    fireEvent.mouseMove(window, { clientX: 220, clientY: 15 });
    await act(async () => { fireEvent.mouseUp(window); });
    expect(move).toHaveBeenLastCalledWith(expect.any(String), 4, track.id);
  });
});
