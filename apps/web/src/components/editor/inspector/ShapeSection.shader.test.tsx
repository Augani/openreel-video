import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
        timeline: { tracks: [{ id: "track-shape", name: "Shape", type: "video", clips: [], transitions: [], hidden: false, locked: false, muted: false, solo: false }], duration: 5, markers: [], subtitles: [] },
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
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    fireEvent.change(screen.getByRole("spinbutton", { name: "Scale" }), {
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
