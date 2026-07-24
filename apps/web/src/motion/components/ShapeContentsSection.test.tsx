import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  hasExplicitShapeContents,
  type MotionComposition,
  type MotionShapeGroupItem,
  type MotionShapeItem,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { ShapeContentsSection } from "./ShapeContentsSection";

const LAYER_ID = "layer-shape";
const COMP_ID = "comp-contents";

function shapeLayer(contents?: readonly MotionShapeItem[]): MotionShapeLayer {
  return {
    id: LAYER_ID,
    type: "shape",
    name: "Block",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 400,
    height: 240,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#ffffff", width: 8, opacity: 1 },
    },
    ...(contents ? { contents } : {}),
  };
}

function composition(layer: MotionShapeLayer): MotionComposition {
  return {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [layer],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function storedComposition(): MotionComposition {
  const project = useProjectStore.getState().project;
  const found = (project.motionCompositions ?? []).find(
    (entry) => entry.id === COMP_ID,
  );
  if (!found) throw new Error("composition not stored");
  return found;
}

function storedLayer(): MotionShapeLayer {
  return storedComposition().layers[0] as MotionShapeLayer;
}

function seed(comp: MotionComposition): void {
  useProjectStore.setState({
    hasOpenProject: true,
    project: {
      ...createEmptyProject("Contents test"),
      motionCompositions: [comp],
    },
  });
}

function renderSection(layer: MotionShapeLayer) {
  return render(
    <ShapeContentsSection composition={composition(layer)} layer={layer} />,
  );
}

describe("ShapeContentsSection", () => {
  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("renders a Group contents CTA for legacy layers", () => {
    seed(composition(shapeLayer()));
    renderSection(shapeLayer());
    expect(
      screen.getByRole("button", { name: /group contents/i }),
    ).toBeInTheDocument();
  });

  it("materializes contents on Group contents click", async () => {
    seed(composition(shapeLayer()));
    renderSection(shapeLayer());

    fireEvent.click(screen.getByRole("button", { name: /group contents/i }));

    await waitFor(() => {
      expect(hasExplicitShapeContents(storedLayer())).toBe(true);
    });
    const contents = storedLayer().contents ?? [];
    expect(contents).toHaveLength(1);
    expect(contents[0].kind).toBe("group");
  });

  it("adds a group to the root", async () => {
    seed(composition(shapeLayer()));
    renderSection(shapeLayer());

    fireEvent.click(screen.getByRole("button", { name: /group contents/i }));
    await waitFor(() => {
      expect(hasExplicitShapeContents(storedLayer())).toBe(true);
    });

    cleanup();
    renderSection(storedLayer());
    fireEvent.click(screen.getByRole("button", { name: /add group/i }));

    await waitFor(() => {
      expect(storedLayer().contents ?? []).toHaveLength(2);
    });
  });

  it("adds a shape into the selected group", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /add shape/i }));

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.items).toHaveLength(1);
      expect(stored.items[0].kind).toBe("path");
    });
  });

  it("renames an item on Enter and commits once", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    const row = screen.getByText("Group 1");
    fireEvent.doubleClick(row);
    const input = screen.getByRole("textbox", { name: /rename/i });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.name).toBe("Renamed");
    });
  });

  it("writes mergeMode via the merge-mode select", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    const select = screen.getByLabelText("Merge mode");
    fireEvent.change(select, { target: { value: "union" } });

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.mergeMode).toBe("union");
    });
  });

  it("adds a twist operator with defaults to the group stack", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    const operatorSelect = screen.getByLabelText("Add operator");
    fireEvent.change(operatorSelect, { target: { value: "twist" } });
    fireEvent.click(screen.getByRole("button", { name: /add operator/i }));

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      const operators = stored.operators ?? [];
      expect(operators).toHaveLength(1);
      expect(operators[0].type).toBe("twist");
    });
  });

  it("reorders items via the move-down button", async () => {
    const items: MotionShapeItem[] = [
      {
        kind: "group",
        id: "grp-a",
        name: "Alpha",
        transform: {
          anchor: { x: 0, y: 0 },
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          opacity: 1,
        },
        items: [],
      },
      {
        kind: "group",
        id: "grp-b",
        name: "Beta",
        transform: {
          anchor: { x: 0, y: 0 },
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          opacity: 1,
        },
        items: [],
      },
    ];
    seed(composition(shapeLayer(items)));
    renderSection(shapeLayer(items));

    fireEvent.click(screen.getByRole("button", { name: /Alpha/i }));
    fireEvent.click(screen.getByRole("button", { name: /move down/i }));

    await waitFor(() => {
      const contents = storedLayer().contents ?? [];
      expect(contents[0].id).toBe("grp-b");
      expect(contents[1].id).toBe("grp-a");
    });
  });

  it("toggles item visibility via the eye button", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /toggle visibility/i }));

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.visible).toBe(false);
    });
  });

  it("edits a group transform field", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    const detail = screen.getByTestId("shape-contents-detail");
    const spinbuttons = within(detail).getAllByRole("spinbutton");
    const rotation = spinbuttons[4];
    fireEvent.change(rotation, { target: { value: "45" } });

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.transform.rotation).toBe(45);
    });
  });

  it("commits one undoable gesture for a multi-change transform scrub", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));

    const realCommit =
      useProjectStore.getState().commitMotionCompositionGesture;
    const realPreview =
      useProjectStore.getState().updateMotionCompositionPreview;
    const realUpsert = useProjectStore.getState().upsertMotionComposition;
    const commitSpy = vi.fn(realCommit);
    const previewSpy = vi.fn(realPreview);
    const upsertSpy = vi.fn(realUpsert);
    useProjectStore.setState({
      commitMotionCompositionGesture: commitSpy,
      updateMotionCompositionPreview: previewSpy,
      upsertMotionComposition: upsertSpy,
    });

    renderSection(shapeLayer([group]));
    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    const detail = screen.getByTestId("shape-contents-detail");
    const rotation = within(detail).getAllByRole("spinbutton")[4];

    fireEvent.change(rotation, { target: { value: "10" } });
    fireEvent.change(rotation, { target: { value: "20" } });
    fireEvent.change(rotation, { target: { value: "30" } });

    expect(commitSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(previewSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    fireEvent.pointerUp(window);

    await waitFor(() => {
      expect(commitSpy).toHaveBeenCalledTimes(1);
    });
    expect(upsertSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.transform.rotation).toBe(30);
    });
  });

  it("keeps a pending scrub when a discrete edit interleaves", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));

    const realCommit =
      useProjectStore.getState().commitMotionCompositionGesture;
    const realUpsert = useProjectStore.getState().upsertMotionComposition;
    const commitSpy = vi.fn(realCommit);
    const upsertSpy = vi.fn(realUpsert);
    useProjectStore.setState({
      commitMotionCompositionGesture: commitSpy,
      upsertMotionComposition: upsertSpy,
    });

    renderSection(shapeLayer([group]));
    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    const detail = screen.getByTestId("shape-contents-detail");
    const rotation = within(detail).getAllByRole("spinbutton")[4];

    fireEvent.change(rotation, { target: { value: "30" } });
    expect(commitSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /toggle visibility/i }));

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalledTimes(1);
    });
    expect(commitSpy).toHaveBeenCalledTimes(1);

    const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
    expect(stored.transform.rotation).toBe(30);
    expect(stored.visible).toBe(false);
  });

  it("removes the selected item", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(storedLayer().contents ?? []).toHaveLength(0);
    });
  });
});
