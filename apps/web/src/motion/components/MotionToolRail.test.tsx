import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MotionToolRail } from "./MotionToolRail";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";

describe("MotionToolRail 3D scene", () => {
  beforeEach(() => {
    const composition = {
      id: "c1",
      name: "S",
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
      backgroundColor: "#000",
      layers: [],
      assets: [],
      variables: [],
      markers: [],
      guides: [],
      createdAt: 1,
      modifiedAt: 1,
    };
    useProjectStore.setState({
      project: {
        ...useProjectStore.getState().project,
        motionCompositions: [composition],
      },
    } as never);
    useMotionStore.setState({ activeCompositionId: "c1" } as never);
  });

  it("adds a scene3d layer from the Add menu", async () => {
    render(<MotionToolRail />);
    fireEvent.click(screen.getByRole("button", { name: /add layer/i }));
    fireEvent.click(screen.getByText("3D scene"));
    await waitFor(() => {
      const comp = (useProjectStore.getState().project.motionCompositions ?? [])[0];
      expect(comp.layers.some((layer) => layer.type === "scene3d")).toBe(true);
    });
  });
});
