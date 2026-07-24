import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { TextClip } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { TextSection } from "./TextSection";

const CLIP_ID = "text-shader-clip";
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

function makeTextClip(): TextClip {
  return {
    id: CLIP_ID,
    trackId: "track-text",
    startTime: 0,
    duration: 5,
    text: "Shader title",
    style: {
      fontFamily: "Inter",
      fontSize: 72,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#ffffff",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    transform: {
      position: { x: 0.5, y: 0.5 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
  };
}

describe("TextSection shader controls", () => {
  beforeEach(() => {
    const textClip = makeTextClip();
    const titleEngine = useEngineStore.getState().getTitleEngine();
    titleEngine?.loadTextClips([textClip]);
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Text shader"),
        textClips: [textClip],
        modifiedAt: Date.now(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    useEngineStore.getState().getTitleEngine()?.clear();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("selects a text shader and writes shader params through text style", async () => {
    render(<TextSection clipId={CLIP_ID} />);

    expect(
      screen.getByRole("button", { name: "Select text color" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select background" }),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/#rrggbb/i)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Preview and select Glyph Dissolve",
      }),
    );

    await waitFor(() => {
      const shader = useEngineStore
        .getState()
        .getTitleEngine()
        ?.getTextClip(CLIP_ID)?.style.shader;
      expect(shader?.shaderId).toBe("glyph-dissolve");
      expect(shader?.progress).toBe(0.5);
      expect(shader?.params.scale).toBe(12);
    });

    cleanup();
    render(<TextSection clipId={CLIP_ID} />);

    const scaleField = screen
      .getAllByText("Scale")
      .map((node) => node.closest(".astryx-field") as HTMLElement | null)
      .find(
        (field): field is HTMLElement =>
          field !== null && within(field).queryByRole("spinbutton") !== null,
      );
    expect(scaleField).toBeDefined();

    fireEvent.change(within(scaleField!).getByRole("spinbutton"), {
      target: { value: "20" },
    });

    await waitFor(() => {
      expect(
        useEngineStore
          .getState()
          .getTitleEngine()
          ?.getTextClip(CLIP_ID)?.style.shader?.params.scale,
      ).toBe(20);
    });
  });

  it("offers Paper materials and stores their default fill parameters", async () => {
    render(<TextSection clipId={CLIP_ID} />);

    expect(screen.getAllByText("Paper").length).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Preview and select Mesh Gradient",
      }),
    );

    await waitFor(() => {
      const shader = useEngineStore
        .getState()
        .getTitleEngine()
        ?.getTextClip(CLIP_ID)?.style.shader;
      expect(shader?.shaderId).toBe("paper-mesh-gradient");
      expect(shader?.progress).toBe(0.5);
      expect(shader?.params.distortion).toBe(0.8);
      expect(shader?.params.color1).toBe("#e0eaff");
    });
  });
});
