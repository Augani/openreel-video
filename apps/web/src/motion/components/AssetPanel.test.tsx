import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaItem, MotionAsset, MotionComposition } from "@openreel/core";

import { createEmptyProject } from "../../stores/project/project-helpers";
import { useNotificationStore } from "../../stores/notification-store";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useMotionStore } from "../stores/motion-store";
import { AssetPanel } from "./AssetPanel";

const composition: MotionComposition = {
  id: "asset-panel-composition",
  name: "Asset Panel Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  guides: [],
  createdAt: 1,
  modifiedAt: 1,
};

function seedProject() {
  useProjectStore.setState({
    hasOpenProject: true,
    project: {
      ...createEmptyProject("Asset Panel Test"),
      motionCompositions: [composition],
    },
  });
}

describe("AssetPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = "";
    useNotificationStore.getState().clearAll();
    useUIStore.setState({ desktopPage: "motion" });
    useMotionStore.setState({ playhead: 2.5, selectedLayerId: null, selectedLayerIds: [] });
    seedProject();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.location.hash = "";
    useNotificationStore.getState().clearAll();
    useProjectStore.setState({ project: createEmptyProject("Reset") });
  });

  it("renders the assets header, search, category tabs and compositions list", () => {
    render(<AssetPanel composition={composition} />);

    expect(screen.getByText("Assets")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import SVG" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import Lottie" })).toBeTruthy();
    expect(
      screen.getByPlaceholderText(/search assets/i),
    ).toBeTruthy();
    for (const tab of ["All", "Footage", "Images", "Audio", "Solids", "Comps"]) {
      expect(screen.getByText(tab)).toBeTruthy();
    }
    expect(screen.getByText("Compositions")).toBeTruthy();
    expect(screen.getByText(composition.name)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Show scene assets only" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("adds media as a selected layer at the current playhead", async () => {
    const image: MediaItem = {
      id: "media-photo",
      name: "photo.png",
      type: "image",
      fileHandle: null,
      blob: null,
      metadata: {
        duration: 0,
        width: 1200,
        height: 800,
        frameRate: 0,
        codec: "png",
        sampleRate: 0,
        channels: 0,
        fileSize: 100,
      },
      thumbnailUrl: "data:image/png;base64,AA==",
      waveformData: null,
    };
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: { items: [image] },
      },
    }));

    render(<AssetPanel composition={composition} />);
    fireEvent.click(screen.getByRole("button", { name: "photo.png" }));

    await waitFor(() => {
      const stored = useProjectStore.getState().getMotionComposition(composition.id);
      expect(stored?.layers).toHaveLength(1);
      expect(stored?.layers[0]).toMatchObject({
        type: "image",
        name: "photo.png",
        startTime: 2.5,
        duration: 2.5,
      });
      expect(stored?.assets).toHaveLength(1);
      expect(useMotionStore.getState().selectedLayerId).toBe(stored?.layers[0]?.id);
    });
  });

  it("reuses an existing scene asset as another layer", async () => {
    const asset: MotionAsset = {
      id: "existing-image",
      type: "image",
      name: "Reusable Logo",
      width: 640,
      height: 320,
    };
    const withAsset: MotionComposition = {
      ...composition,
      assets: [asset],
    };
    useProjectStore.setState((state) => ({
      project: { ...state.project, motionCompositions: [withAsset] },
    }));

    render(<AssetPanel composition={withAsset} />);
    fireEvent.click(screen.getByRole("button", { name: "Reusable Logo" }));

    await waitFor(() => {
      const stored = useProjectStore.getState().getMotionComposition(composition.id);
      expect(stored?.layers).toHaveLength(1);
      expect(stored?.layers[0]).toMatchObject({
        assetId: asset.id,
        startTime: 2.5,
      });
      expect(stored?.assets).toHaveLength(1);
    });
  });
});
