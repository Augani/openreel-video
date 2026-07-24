import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Scene3DInspector } from "./Scene3DInspector";
import type { MotionScene3DLayer } from "@openreel/core";

const baseLayer = {
  id: "L1",
  type: "scene3d",
  name: "3D Scene",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {},
  keyframes: [],
  object: { kind: "rounded-box" },
  objects: [
    {
      id: "o1",
      name: "Object 1",
      object: { kind: "rounded-box" },
      material: { color: "#10b981" },
      transform3d: {},
    },
  ],
  camera: { fov: 35 },
} as unknown as MotionScene3DLayer;

describe("Scene3DInspector objects + geometry", () => {
  it("adds an object and changes the active object's kind", () => {
    const replaceLayer = vi.fn();
    render(<Scene3DInspector layer={baseLayer} replaceLayer={replaceLayer} />);

    fireEvent.click(screen.getByRole("button", { name: /add object/i }));
    expect(replaceLayer).toHaveBeenCalled();
    const added = replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer;
    expect(added.objects?.length).toBe(2);

    fireEvent.change(screen.getByLabelText(/geometry kind/i), {
      target: { value: "sphere" },
    });
    const changed = replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer;
    expect(changed.objects?.[0].object.kind).toBe("sphere");
  });

  it("edits material color, transform, and camera fov", () => {
    const replaceLayer = vi.fn();
    render(<Scene3DInspector layer={baseLayer} replaceLayer={replaceLayer} />);

    const colorGroup = screen.getByRole("group", { name: /material color/i });
    fireEvent.change(within(colorGroup).getByRole("textbox"), {
      target: { value: "#ff0000" },
    });
    expect(
      (replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer).objects?.[0]
        .material?.color,
    ).toBe("#ff0000");

    const fovGroup = screen.getByRole("group", { name: /camera fov/i });
    fireEvent.change(within(fovGroup).getByRole("spinbutton"), {
      target: { value: "50" },
    });
    expect(
      (replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer).camera?.fov,
    ).toBe(50);
  });
});
