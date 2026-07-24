import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  DEFAULT_SHAPE_STYLE,
  type EasingType,
  type Keyframe,
  type MotionComposition,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { GraphEditorPanel } from "./GraphEditorPanel";

const PROPERTY = "transform.position.x";

function keyframe(
  id: string,
  time: number,
  value: number,
  easing: EasingType,
  bezierHandles?: Keyframe["bezierHandles"],
): Keyframe {
  return { id, time, value, property: PROPERTY, easing, bezierHandles };
}

function shapeLayer(keyframes: readonly Keyframe[]): MotionShapeLayer {
  return {
    id: "layer-1",
    type: "shape",
    name: "Box",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: 0, y: 0 },
    },
    keyframes: [...keyframes],
    shapeType: "rectangle",
    width: 100,
    height: 100,
    style: DEFAULT_SHAPE_STYLE,
  };
}

function composition(layer: MotionShapeLayer): MotionComposition {
  return {
    id: "comp-1",
    name: "Comp",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 4,
    backgroundColor: "transparent",
    layers: [layer],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  } as MotionComposition;
}

async function seedComposition(comp: MotionComposition): Promise<void> {
  useProjectStore.setState({ project: createEmptyProject("Graph Handles") });
  useProjectStore.getState().actionExecutor.getHistory().clear();
  await useProjectStore.getState().upsertMotionComposition(comp);
}

function storedComposition(): MotionComposition {
  const found = (
    useProjectStore.getState().project.motionCompositions ?? []
  ).find((candidate) => candidate.id === "comp-1");
  if (!found) throw new Error("composition not found");
  return found;
}

function storedKeyframes(): Keyframe[] {
  return storedComposition().layers[0]!.keyframes.filter(
    (candidate) => candidate.property === PROPERTY,
  );
}

function undoStackSize(): number {
  return useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
}

function graphSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>(
    'svg[role="img"][aria-label*="keyframe graph"]',
  );
  if (!svg) throw new Error("graph svg not found");
  return svg;
}

function svgPoint(x: number, y: number): { clientX: number; clientY: number } {
  return { clientX: x, clientY: y };
}

function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
    button: { value: 0 },
  });
  fireEvent(target, event);
}

describe("GraphEditorPanel bezier handles", () => {
  beforeEach(() => {
    useMotionStore.setState({
      selectedLayerId: "layer-1",
      selectedLayerIds: ["layer-1"],
      selectedLightId: null,
      selectedProperty: PROPERTY,
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("renders P1/P2 grips for a bezier segment", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "bezier", {
            in: { x: 1 / 3, y: 1 / 3 },
            out: { x: 2 / 3, y: 2 / 3 },
          }),
          keyframe("kf-1", 2, 400, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    expect(
      container.querySelector('[data-testid="bezier-grip-out-kf-0"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="bezier-grip-in-kf-0"]'),
    ).not.toBeNull();
  });

  it("dragging a grip writes easing:bezier + changed handles as one undo entry", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "linear"),
          keyframe("kf-1", 2, 400, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    const startSize = undoStackSize();
    const grip = container.querySelector(
      '[data-testid="bezier-grip-out-kf-0"]',
    );
    expect(grip).not.toBeNull();
    const svg = graphSvg(container);

    fireEvent.pointerDown(grip!, { pointerId: 7, ...svgPoint(160, 20) });
    fireEvent.pointerMove(svg, { pointerId: 7, ...svgPoint(200, 20) });
    fireEvent.pointerUp(svg, { pointerId: 7, ...svgPoint(200, 20) });

    await waitFor(() => expect(undoStackSize()).toBe(startSize + 1));
    const kf0 = storedKeyframes().find((candidate) => candidate.id === "kf-0");
    expect(kf0?.easing).toBe("bezier");
    expect(kf0?.bezierHandles).toBeDefined();
  });

  it("lets an overshoot drag push a handle past y=1 toward the y=2 bound", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "linear"),
          keyframe("kf-1", 2, 400, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    const grip = container.querySelector(
      '[data-testid="bezier-grip-out-kf-0"]',
    );
    expect(grip).not.toBeNull();
    const svg = graphSvg(container);
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 320, height: 148 }) as DOMRect;

    firePointer(grip!, "pointerdown", 9, 200, 20);
    firePointer(svg, "pointermove", 9, 200, -40);
    firePointer(svg, "pointerup", 9, 200, -40);

    const kf0 = storedKeyframes().find((candidate) => candidate.id === "kf-0");
    expect(kf0?.easing).toBe("bezier");
    const outY = kf0?.bezierHandles?.out.y;
    expect(outY).toBeDefined();
    expect(outY!).toBeGreaterThan(1);
    expect(outY!).toBeLessThanOrEqual(2);
  });

  it("seeds handles approximating the prior easing on first drag", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "ease-in-out"),
          keyframe("kf-1", 2, 400, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    const grip = container.querySelector(
      '[data-testid="bezier-grip-in-kf-0"]',
    );
    const svg = graphSvg(container);
    fireEvent.pointerDown(grip!, { pointerId: 3, ...svgPoint(40, 100) });
    fireEvent.pointerMove(svg, { pointerId: 3, ...svgPoint(40, 100) });
    fireEvent.pointerUp(svg, { pointerId: 3, ...svgPoint(40, 100) });

    const kf0 = storedKeyframes().find((candidate) => candidate.id === "kf-0");
    expect(kf0?.easing).toBe("bezier");
    expect(kf0?.bezierHandles?.in.y).toBeGreaterThan(0);
    expect(kf0?.bezierHandles?.out.y).toBeLessThan(1);
  });

  it("shows a muted hint and no grips for a flat segment", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 100, "linear"),
          keyframe("kf-1", 2, 100, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    expect(
      container.querySelector('[data-testid="bezier-grip-out-kf-0"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="flat-segment-hint-kf-0"]'),
    ).not.toBeNull();
  });

  it("commits a keyframe-point drag as exactly one undo entry", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "linear"),
          keyframe("kf-1", 2, 400, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    const startSize = undoStackSize();
    const point = container.querySelector('[data-testid="keyframe-point-kf-1"]');
    expect(point).not.toBeNull();
    const svg = graphSvg(container);

    fireEvent.pointerDown(point!, { pointerId: 11, ...svgPoint(250, 30) });
    fireEvent.pointerMove(svg, { pointerId: 11, ...svgPoint(240, 40) });
    fireEvent.pointerMove(svg, { pointerId: 11, ...svgPoint(230, 50) });
    fireEvent.pointerMove(svg, { pointerId: 11, ...svgPoint(220, 60) });
    fireEvent.pointerUp(svg, { pointerId: 11, ...svgPoint(220, 60) });

    await waitFor(() => expect(undoStackSize()).toBe(startSize + 1));
  });
});

describe("GraphEditorPanel speed toggle", () => {
  beforeEach(() => {
    useMotionStore.setState({
      selectedLayerId: "layer-1",
      selectedLayerIds: ["layer-1"],
      selectedLightId: null,
      selectedProperty: PROPERTY,
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  function speedControl(container: HTMLElement): HTMLElement {
    const control = container.querySelector<HTMLElement>(
      '[role="radio"][data-value="speed"]',
    );
    if (!control) throw new Error("speed toggle not found");
    return control;
  }

  function valueControl(container: HTMLElement): HTMLElement {
    const control = container.querySelector<HTMLElement>(
      '[role="radio"][data-value="value"]',
    );
    if (!control) throw new Error("value toggle not found");
    return control;
  }

  it("toggling to Speed renders the speed polyline and hides grips", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "ease-in-out"),
          keyframe("kf-1", 2, 400, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    expect(
      container.querySelector('[data-testid="speed-graph-polyline"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="bezier-grip-out-kf-0"]'),
    ).not.toBeNull();

    fireEvent.click(speedControl(container));

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="speed-graph-polyline"]'),
      ).not.toBeNull(),
    );
    expect(
      container.querySelector('[data-testid="bezier-grip-out-kf-0"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="bezier-grip-in-kf-0"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="speed-zero-line"]'),
    ).not.toBeNull();
  });

  it("draws diamonds in speed mode but disables their drag", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "linear"),
          keyframe("kf-1", 2, 400, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    fireEvent.click(speedControl(container));

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="speed-graph-polyline"]'),
      ).not.toBeNull(),
    );

    const diamond = container.querySelector(
      '[data-testid="speed-point-kf-1"]',
    );
    expect(diamond).not.toBeNull();

    const startSize = undoStackSize();
    const svg = container.querySelector<SVGSVGElement>(
      'svg[role="img"][aria-label*="graph"]',
    );
    if (!svg) throw new Error("graph svg not found");
    fireEvent.pointerDown(diamond!, { pointerId: 21, ...svgPoint(250, 30) });
    fireEvent.pointerMove(svg, { pointerId: 21, ...svgPoint(200, 60) });
    fireEvent.pointerUp(svg, { pointerId: 21, ...svgPoint(200, 60) });

    expect(undoStackSize()).toBe(startSize);
  });

  it("toggling back to Value restores the value graph and grips", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "bezier", {
            in: { x: 1 / 3, y: 1 / 3 },
            out: { x: 2 / 3, y: 2 / 3 },
          }),
          keyframe("kf-1", 2, 400, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    fireEvent.click(speedControl(container));
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="speed-graph-polyline"]'),
      ).not.toBeNull(),
    );

    fireEvent.click(valueControl(container));
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="bezier-grip-out-kf-0"]'),
      ).not.toBeNull(),
    );
    expect(
      container.querySelector('[data-testid="speed-graph-polyline"]'),
    ).toBeNull();
  });
});

describe("GraphEditorPanel roving keyframes", () => {
  beforeEach(() => {
    useMotionStore.setState({
      selectedLayerId: "layer-1",
      selectedLayerIds: ["layer-1"],
      selectedLightId: null,
      selectedProperty: PROPERTY,
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  function roveSwitch(container: HTMLElement, id: string): HTMLButtonElement {
    const wrapper = container.querySelector<HTMLElement>(
      `[data-testid="rove-switch-${id}"]`,
    );
    if (!wrapper) throw new Error(`rove switch ${id} not found`);
    const input = wrapper.querySelector<HTMLButtonElement>(
      'button[role="switch"]',
    );
    if (!input) throw new Error(`rove switch input ${id} not found`);
    return input;
  }

  it("toggling Rove on a middle keyframe sets roving and shifts its time", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "linear"),
          keyframe("kf-1", 1.5, 100, "linear"),
          keyframe("kf-2", 3, 300, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    fireEvent.click(roveSwitch(container, "kf-1"));

    await waitFor(() => {
      const kf1 = storedKeyframes().find(
        (candidate) => candidate.id === "kf-1",
      );
      expect(kf1?.roving).toBe(true);
      expect(kf1?.time).toBeCloseTo(1, 3);
    });
  });

  it("disables the Rove switch for endpoint keyframes", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "linear"),
          keyframe("kf-1", 1.5, 100, "linear"),
          keyframe("kf-2", 3, 300, "linear"),
        ]),
      ),
    );

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    expect(roveSwitch(container, "kf-0").disabled).toBe(true);
    expect(roveSwitch(container, "kf-2").disabled).toBe(true);
    expect(roveSwitch(container, "kf-1").disabled).toBe(false);
  });

  async function seedWithRoving(rovingId: string): Promise<void> {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "linear"),
          keyframe("kf-1", 1.5, 100, "linear"),
          keyframe("kf-2", 3, 400, "linear"),
        ]),
      ),
    );
    const seeded = storedComposition();
    const withRoving: MotionComposition = {
      ...seeded,
      layers: seeded.layers.map((layer) =>
        layer.id === "layer-1"
          ? {
              ...layer,
              keyframes: layer.keyframes.map((frame) =>
                frame.id === rovingId ? { ...frame, roving: true } : frame,
              ),
            }
          : layer,
      ),
    };
    await useProjectStore.getState().upsertMotionComposition(withRoving);
  }

  function expectedRovingTime(): number {
    const frames = storedKeyframes().slice().sort((a, b) => a.time - b.time);
    const [kf0, kf1, kf2] = frames;
    const v0 = kf0!.value as number;
    const v1 = kf1!.value as number;
    const v2 = kf2!.value as number;
    const span = kf2!.time - kf0!.time;
    const total = Math.abs(v1 - v0) + Math.abs(v2 - v1);
    const fraction = total === 0 ? 0.5 : Math.abs(v1 - v0) / total;
    return kf0!.time + span * fraction;
  }

  it("re-derives the roving middle time after dragging an anchor keyframe dot", async () => {
    await seedWithRoving("kf-1");

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    const before = storedKeyframes().find(
      (candidate) => candidate.id === "kf-1",
    );
    expect(before?.roving).toBe(true);

    const point = container.querySelector('[data-testid="keyframe-point-kf-2"]');
    expect(point).not.toBeNull();
    const svg = graphSvg(container);
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 320, height: 148 }) as DOMRect;

    firePointer(point!, "pointerdown", 41, 300, 30);
    firePointer(svg, "pointermove", 41, 230, 20);
    firePointer(svg, "pointerup", 41, 230, 20);

    await waitFor(() => {
      const kf1 = storedKeyframes().find(
        (candidate) => candidate.id === "kf-1",
      );
      expect(kf1?.roving).toBe(true);
      expect(kf1?.time).toBeCloseTo(expectedRovingTime(), 3);
    });
  });

  it("re-derives the roving time when an anchor value is edited via the row input", async () => {
    await seedWithRoving("kf-1");

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    const row = container.querySelector<HTMLElement>(
      '[data-testid="keyframe-row-kf-2"]',
    );
    if (!row) throw new Error("anchor row not found");
    const numberInputs = row.querySelectorAll<HTMLInputElement>(
      'input[type="number"]',
    );
    const valueInput = numberInputs[1];
    if (!valueInput) throw new Error("value input not found");

    fireEvent.change(valueInput, { target: { value: "50" } });

    await waitFor(() => {
      const kf2 = storedKeyframes().find(
        (candidate) => candidate.id === "kf-2",
      );
      expect(kf2?.value).toBeCloseTo(50, 3);
      const kf1 = storedKeyframes().find(
        (candidate) => candidate.id === "kf-1",
      );
      expect(kf1?.time).toBeCloseTo(expectedRovingTime(), 3);
    });
  });

  it("does not move a roving dot on pointer drag but keeps it selectable", async () => {
    await seedWithRoving("kf-1");

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    const before = storedKeyframes().find(
      (candidate) => candidate.id === "kf-1",
    );
    const point = container.querySelector('[data-testid="keyframe-point-kf-1"]');
    expect(point?.getAttribute("data-roving")).toBe("true");
    const svg = graphSvg(container);
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 320, height: 148 }) as DOMRect;

    const startSize = undoStackSize();
    firePointer(point!, "pointerdown", 51, 140, 60);
    firePointer(svg, "pointermove", 51, 60, 100);
    firePointer(svg, "pointerup", 51, 60, 100);

    fireEvent.click(point!);

    const after = storedKeyframes().find(
      (candidate) => candidate.id === "kf-1",
    );
    expect(after?.time).toBeCloseTo(before?.time ?? -1, 5);
    expect(after?.value).toBe(before?.value);
    expect(undoStackSize()).toBe(startSize);
  });

  it("makes the time input read-only while a keyframe is roving", async () => {
    await seedComposition(
      composition(
        shapeLayer([
          keyframe("kf-0", 0, 0, "linear"),
          keyframe("kf-1", 1.5, 100, "linear", undefined),
          keyframe("kf-2", 3, 300, "linear"),
        ]),
      ),
    );

    const rovingComp = storedComposition();
    const withRoving: MotionComposition = {
      ...rovingComp,
      layers: rovingComp.layers.map((layer) =>
        layer.id === "layer-1"
          ? {
              ...layer,
              keyframes: layer.keyframes.map((frame) =>
                frame.id === "kf-1" ? { ...frame, roving: true } : frame,
              ),
            }
          : layer,
      ),
    };
    await useProjectStore.getState().upsertMotionComposition(withRoving);

    const { container } = render(
      <GraphEditorPanel composition={storedComposition()} embedded />,
    );

    const row = container.querySelector<HTMLElement>(
      '[data-testid="keyframe-row-kf-1"]',
    );
    if (!row) throw new Error("keyframe row not found");
    const timeInput = row.querySelector<HTMLInputElement>("input");
    expect(timeInput?.disabled).toBe(true);

    const diamond = container.querySelector('[data-testid="keyframe-point-kf-1"]');
    expect(diamond?.getAttribute("data-roving")).toBe("true");
  });
});
