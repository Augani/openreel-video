import { beforeEach, describe, expect, it, vi } from "vitest";
import { useColorMonitorStore } from "../stores/color-monitor-store";
import { useTimelineStore } from "../stores/timeline-store";
import { registerProgramFrameControl } from "../components/editor/preview/program-frame-control";
import { registerPreviewCanvas } from "../components/editor/scopes/preview-canvas-registry";
import { getReferenceImage, refreshReference } from "./comparison-service";

type FakeBitmap = ImageBitmap & { closed: boolean };

function fakeBitmap(): FakeBitmap {
  const bitmap = { width: 4, height: 4, closed: false, close() { this.closed = true; } };
  return bitmap as unknown as FakeBitmap;
}

describe("comparison reference capture", () => {
  const bitmaps: FakeBitmap[] = [];
  beforeEach(async () => {
    // Drop any reference a previous test left in the module.
    useColorMonitorStore.setState((s) => ({ comparison: { ...s.comparison, mode: "off" } }));
    await refreshReference();
    bitmaps.length = 0;
    vi.stubGlobal("createImageBitmap", async () => {
      const b = fakeBitmap();
      bitmaps.push(b);
      return b;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    registerPreviewCanvas(canvas);
    useColorMonitorStore.setState({
      comparison: { mode: "split-v", reference: "bypass", split: 0.5, stillId: null, refTime: null },
      stills: [],
    });
    useTimelineStore.setState({ playheadPosition: 1, playbackState: "paused" });
  });

  it("restores the CURRENT playhead frame when the user scrubbed during the capture", async () => {
    const rendered: number[] = [];
    registerProgramFrameControl({
      renderAt: async (time) => {
        rendered.push(time);
        if (rendered.length === 1) useTimelineStore.setState({ playheadPosition: 5 });
      },
    });
    await refreshReference();
    expect(rendered).toEqual([1, 5]);
  });

  it("drops a capture that finished after the reference changed", async () => {
    registerProgramFrameControl({
      renderAt: async () => {
        useColorMonitorStore.setState((s) => ({
          comparison: { ...s.comparison, reference: "playhead", refTime: 2 },
        }));
      },
    });
    await refreshReference();
    expect(bitmaps).toHaveLength(1);
    expect(bitmaps[0].closed).toBe(true);
    expect(getReferenceImage()).toBeNull();
  });

  it("releases the held reference when the comparison is closed", async () => {
    registerProgramFrameControl({ renderAt: async () => undefined });
    await refreshReference();
    expect(getReferenceImage()).toBe(bitmaps[0]);
    useColorMonitorStore.setState((s) => ({ comparison: { ...s.comparison, mode: "off" } }));
    await refreshReference();
    expect(bitmaps[0].closed).toBe(true);
    expect(getReferenceImage()).toBeNull();
  });
});
