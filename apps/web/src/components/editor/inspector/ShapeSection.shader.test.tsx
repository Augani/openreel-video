import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { ShapeSection } from "./ShapeSection";

const CLIP_ID = "shape-shader-clip";
const originalShowPopover = HTMLElement.prototype.showPopover;
const originalHidePopover = HTMLElement.prototype.hidePopover;

beforeAll(() => {
  HTMLElement.prototype.showPopover = function showPopover() {
    this.setAttribute("data-testid-popover-open", "true");
  };
  HTMLElement.prototype.hidePopover = function hidePopover() {
    this.removeAttribute("data-testid-popover-open");
  };
});

afterAll(() => {
  HTMLElement.prototype.showPopover = originalShowPopover;
  HTMLElement.prototype.hidePopover = originalHidePopover;
});

describe("ShapeSection shader fill controls", () => {
  beforeEach(() => {
    const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
    graphicsEngine?.clearCache();
    const shapeClip = graphicsEngine?.createShape(
      {
        id: CLIP_ID,
        shapeType: "rectangle",
        width: 240,
        height: 160,
        style: {
          fill: { type: "solid", color: "#14b8a6", opacity: 1 },
          stroke: { color: "#ffffff", width: 0, opacity: 1 },
        },
      },
      "track-shape",
      0,
      5,
    );
    if (!shapeClip) throw new Error("shape engine unavailable");

    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Shape shader"),
        shapeClips: [shapeClip],
        modifiedAt: Date.now(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("switches a shape fill to a shader and updates shader params", async () => {
    render(<ShapeSection clipId={CLIP_ID} />);

    expect(screen.getAllByRole("button", { name: "Select color" }).length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText(/#rrggbb/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Shader" }));

    await waitFor(() => {
      const fill = useEngineStore
        .getState()
        .getGraphicsEngine()
        ?.getShapeClip(CLIP_ID)?.style.fill;
      expect(fill?.type).toBe("shader");
      expect(fill?.shader?.shaderId).toBe("liquid-metal");
      expect(fill?.shader?.params.scale).toBe(6);
    });

    cleanup();
    render(<ShapeSection clipId={CLIP_ID} />);

    const picker = screen.getByRole("combobox", { name: "Shader Fill" });
    fireEvent.click(picker);
    expect(await screen.findByText("Built-in")).toBeInTheDocument();
    expect(await screen.findByText("Paper")).toBeInTheDocument();

    const scaleField = screen
      .getAllByText("Scale")
      .map((node) => node.closest(".astryx-field") as HTMLElement | null)
      .find(
        (field): field is HTMLElement =>
          field !== null && within(field).queryByRole("spinbutton") !== null,
      );
    expect(scaleField).toBeDefined();

    fireEvent.change(within(scaleField!).getByRole("spinbutton"), {
      target: { value: "12" },
    });

    await waitFor(() => {
      expect(
        useEngineStore
          .getState()
          .getGraphicsEngine()
          ?.getShapeClip(CLIP_ID)?.style.fill.shader?.params.scale,
      ).toBe(12);
    });
  });
});
