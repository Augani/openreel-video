import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { keyframeEngine, type Clip, type Keyframe } from "@openreel/core";
import { KeyframeEditorPanel } from "./KeyframeEditorPanel";
import { selectOption } from "../../test/select-option";

const keys: Keyframe[] = [
  { id: "a", property: "opacity", time: 0, value: 0, easing: "ease-out" },
  { id: "b", property: "opacity", time: 4, value: 1, easing: "linear" },
];
const clip = { id: "video", duration: 4, keyframes: keys } as Clip;
const callbacks = () => ({ onClose: vi.fn(), onUpdateKeyframes: vi.fn(), onDeleteKeyframes: vi.fn(),
  onCopyKeyframes: vi.fn(), onPasteKeyframes: vi.fn(), onSelectKeyframe: vi.fn() });
const context = { scale: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  fillText: vi.fn(), save: vi.fn(), translate: vi.fn(), rotate: vi.fn(), strokeRect: vi.fn(), restore: vi.fn() };
const originalResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {} disconnect() {}
  } as unknown as typeof ResizeObserver;
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId = 1; }); vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
});
afterEach(() => { cleanup(); globalThis.ResizeObserver = originalResizeObserver; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(options: Partial<React.ComponentProps<typeof KeyframeEditorPanel>> = {}) {
  const props = { clip, ...callbacks(), selectedKeyframeIds: [], copiedKeyframes: [], ...options };
  return { ...render(<KeyframeEditorPanel {...props}/>), props };
}

describe("keyframe graph editing", () => {
  it("shows the saved easing and samples the same ease-out curve as playback", () => {
    mount({ selectedKeyframeIds: ["a"] });
    expect(screen.getByRole("combobox", { name: "Easing" })).toHaveTextContent("Ease Out");
    // At half time, ease-out reveals 75%, not the linear 50%.
    expect(context.lineTo.mock.calls.some(([x, y]) => Math.abs(x - 300) < 0.01 && Math.abs(y - 75) < 0.01)).toBe(true);
  });
  it("uses saved custom Bézier handles for the curve without rewriting them", () => {
    const bezier = [{ ...keys[0], easing: "bezier" as const, bezierHandles: { out: { x: 0.2, y: 0.8 }, in: { x: 0.6, y: 1 } } }, keys[1]];
    const before = structuredClone(bezier);
    const value = keyframeEngine.getValueAtTime(bezier, 2).value as number;
    mount({ clip: { ...clip, keyframes: bezier }, selectedKeyframeIds: ["a"] });
    expect(screen.getByRole("combobox", { name: "Easing" })).toHaveTextContent("Custom Bézier");
    expect(context.lineTo.mock.calls.some(([x, y]) => Math.abs(x - 300) < 0.01 && Math.abs(y - (40 + (1.1 - value) * 100)) < 0.01)).toBe(true);
    expect(bezier).toEqual(before);
  });
  it("updates a complete selection once and ignores IDs belonging to another clip", async () => {
    const { props } = mount({ selectedKeyframeIds: ["a", "b", "stale"] });
    await selectOption(screen.getByRole("combobox", { name: "Easing" }), "Ease In Cubic");
    expect(props.onUpdateKeyframes).toHaveBeenCalledOnce();
    expect(props.onUpdateKeyframes).toHaveBeenCalledWith(["a", "b"], { easing: "easeInCubic" });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDeleteKeyframes).toHaveBeenCalledOnce();
    expect(props.onDeleteKeyframes).toHaveBeenCalledWith(["a", "b"]);
  });
  it("keeps copy/paste, keyboard selection and close available", () => {
    const { props } = mount({ selectedKeyframeIds: ["a"], copiedKeyframes: [keys[0]] });
    fireEvent.click(screen.getByRole("button", { name: /Keyframe at 0.000s/ }), { ctrlKey: true });
    expect(props.onSelectKeyframe).toHaveBeenCalledWith("a", true);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.click(screen.getByRole("button", { name: "Close keyframe editor" }));
    expect(props.onCopyKeyframes).toHaveBeenCalledWith(["a"]);
    expect(props.onPasteKeyframes).toHaveBeenCalledWith("video", 0);
    expect(props.onClose).toHaveBeenCalledOnce();
  });
  it("maps a scaled canvas drag correctly and commits one update on global release", () => {
    const { container, props } = mount();
    const canvas = container.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 100, top: 200, width: 300, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 120, clientY: 275 });
    for (let x = 130; x <= 250; x += 10) fireEvent.pointerMove(canvas, { clientX: x, clientY: 250 });
    expect(props.onUpdateKeyframes).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    expect(props.onUpdateKeyframes).toHaveBeenCalledOnce();
    expect(props.onUpdateKeyframes).toHaveBeenCalledWith(["a"], { time: 2, value: expect.closeTo(0.5) });
  });
  it("cancels a draft when the clip or canonical keyframes change", () => {
    const { container, props, rerender } = mount();
    const canvas = container.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 600, height: 200 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 150 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 100 });
    rerender(<KeyframeEditorPanel {...props} clip={{ ...clip, id: "other", keyframes: [{ ...keys[0], property: "rotation" }] }}/>);
    fireEvent.pointerUp(window);
    expect(props.onUpdateKeyframes).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Property" })).toHaveTextContent("rotation");
  });
  it.each(["Escape", "pointercancel"])("cancels a gesture through %s without adding history", action => {
    const { container, props } = mount(); const canvas = container.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 600, height: 200 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 150 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 100 });
    if (action === "Escape") fireEvent.keyDown(window, { key: "Escape" }); else fireEvent.pointerCancel(window);
    fireEvent.pointerUp(window); expect(props.onUpdateKeyframes).not.toHaveBeenCalled();
  });
  it("blocks mutations during an editing lock but retains copying and navigation", () => {
    mount({ disabled: true, selectedKeyframeIds: ["a"], copiedKeyframes: keys });
    expect(screen.getByRole("combobox", { name: "Easing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Paste" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Property" })).toBeEnabled();
  });
});

describe("graph editor: handles, presets, overlay, speed, paste", () => {
  const linearKeys: Keyframe[] = [
    { id: "a", property: "opacity", time: 0, value: 0, easing: "linear" },
    { id: "b", property: "opacity", time: 4, value: 1, easing: "linear" },
  ];
  const two = { id: "multi", duration: 4, keyframes: [...linearKeys,
    { id: "r1", property: "rotation", time: 0, value: 0, easing: "linear" },
    { id: "r2", property: "rotation", time: 4, value: 90, easing: "linear" }] } as Clip;

  it("drags a Bezier handle and commits one bezier update clamped to the time axis", () => {
    const { container, props } = mount({ clip: { ...clip, keyframes: linearKeys }, selectedKeyframeIds: ["a"] });
    const canvas = container.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 600, height: 200 } as DOMRect);
    // Outgoing handle of "a" starts at linear P1 = (1/3, 1/3) => x 213.3, y 116.7.
    fireEvent.pointerDown(canvas, { clientX: 213, clientY: 117 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 60 });
    expect(props.onUpdateKeyframes).not.toHaveBeenCalled();
    fireEvent.pointerMove(canvas, { clientX: 5000, clientY: 60 });
    fireEvent.pointerUp(window);
    expect(props.onUpdateKeyframes).toHaveBeenCalledOnce();
    const [ids, update] = vi.mocked(props.onUpdateKeyframes).mock.calls[0] as [string[], any];
    expect(ids).toEqual(["a"]);
    expect(update.easing).toBe("bezier");
    expect(update.bezierHandles.in.x).toBe(1); // clamped, never past the next keyframe
    expect(update.bezierHandles.in.y).toBeCloseTo(0.9, 1);
    expect(update.bezierHandles.out).toEqual({ x: 2 / 3, y: 2 / 3 });
  });
  it("applies an ease preset to the whole selection in one update and clears handles for hold", () => {
    const { props } = mount({ clip: { ...clip, keyframes: linearKeys }, selectedKeyframeIds: ["a", "b"] });
    fireEvent.click(screen.getByRole("button", { name: "Apply Ease in/out" }));
    expect(props.onUpdateKeyframes).toHaveBeenLastCalledWith(["a", "b"], { easing: "bezier", bezierHandles: { in: { x: 0.42, y: 0 }, out: { x: 0.58, y: 1 } } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Hold" }));
    expect(props.onUpdateKeyframes).toHaveBeenLastCalledWith(["a", "b"], { easing: "hold", bezierHandles: undefined });
    expect(props.onUpdateKeyframes).toHaveBeenCalledTimes(2);
  });
  it("overlays several properties with per-property toggles and a speed graph mode", () => {
    const { container } = mount({ clip: two });
    const chip = screen.getByRole("button", { name: "Show rotation curve" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    const before = context.stroke.mock.calls.length;
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(context.stroke.mock.calls.length).toBeGreaterThan(before);
    fireEvent.click(screen.getByRole("button", { name: "Speed graph" }));
    expect(container.querySelector("canvas")).toHaveAttribute("data-graph-mode", "speed");
    expect(screen.getByRole("button", { name: "Speed graph" })).toHaveAttribute("aria-pressed", "true");
  });
  it("pastes at the playhead, optionally into the active property", () => {
    const { props } = mount({ clip: two, playheadTime: 1.5, copiedKeyframes: [linearKeys[0]] });
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(props.onPasteKeyframes).toHaveBeenLastCalledWith("multi", 1.5);
    fireEvent.click(screen.getByRole("checkbox", { name: "Paste into active property" }));
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(props.onPasteKeyframes).toHaveBeenLastCalledWith("multi", 1.5, "opacity");
  });
  it("names each side of a key's interpolation and applies a type to the chosen side", async () => {
    const mixed: Keyframe[] = [
      { ...keys[0], easing: "linear", interpolationOut: "auto-bezier" },
      { ...keys[1], easing: "hold", interpolationIn: "auto-bezier" },
      { id: "c", property: "opacity", time: 6, value: 0.5, easing: "linear" },
    ];
    const onApplyInterpolation = vi.fn();
    mount({ clip: { ...clip, keyframes: mixed } as Clip, selectedKeyframeIds: ["a"], onApplyInterpolation });
    // First key shows only its outgoing side; the held segment reads Hold on both of its ends.
    expect(screen.getByRole("button", { name: /Keyframe at 0.000s.*Auto Bezier$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Keyframe at 4.000s.*In Hold · Out Hold$|Keyframe at 4.000s.*Hold$/ })).toBeTruthy();
    await selectOption(screen.getByRole("combobox", { name: "Interpolation side" }), "Out only");
    await selectOption(screen.getByRole("combobox", { name: "Interpolation" }), "Linear");
    expect(onApplyInterpolation).toHaveBeenCalledWith(["a"], "linear", "out");
  });
});
