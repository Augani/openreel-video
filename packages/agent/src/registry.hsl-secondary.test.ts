import { describe, it, expect } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import type { ColorMonitorBridge, ComparisonSnapshot } from "./host";
import { makeProjectWithClip } from "./test-fixtures";

interface Effect {
  id: string;
  type: string;
  params: Record<string, unknown>;
}

function effects(host: HeadlessHost): Effect[] {
  const clip = host
    .getProject()
    .timeline.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === "c1");
  return (clip?.effects ?? []) as unknown as Effect[];
}

describe("agent HSL secondary tools", () => {
  it("add_hsl_secondary keys around a sample colour and returns the effect id", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool(
      "add_hsl_secondary",
      { clipId: "c1", sample: { r: 0, g: 255, b: 0 }, params: { saturation: -80 } },
      host,
    );
    expect(res.ok).toBe(true);
    const added = effects(host);
    expect(added).toHaveLength(1);
    expect(added[0].type).toBe("hsl-secondary");
    expect(added[0].id).toBe((res.data as { effectId: string }).effectId);
    expect(added[0].params.hueMin).toBeCloseTo(105);
    expect(added[0].params.hueMax).toBeCloseTo(135);
    expect(added[0].params.saturation).toBe(-80);
  });

  it("stacks several secondaries and range-checks params", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    expect((await executeTool("add_hsl_secondary", { clipId: "c1" }, host)).ok).toBe(true);
    expect((await executeTool("add_hsl_secondary", { clipId: "c1" }, host)).ok).toBe(true);
    expect(effects(host)).toHaveLength(2);
    const bad = await executeTool("add_hsl_secondary", { clipId: "c1", params: { hueMax: 999 } }, host);
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
    const unknownClip = await executeTool("add_hsl_secondary", { clipId: "nope" }, host);
    expect(unknownClip.ok).toBe(false);
    expect(effects(host)).toHaveLength(2);
  });

  it("set_secondary_qualifier add then subtract composes from the current range", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const added = await executeTool(
      "add_hsl_secondary",
      { clipId: "c1", sample: { r: 0, g: 255, b: 0 }, params: { hueSoft: 0 } },
      host,
    );
    const effectId = (added.data as { effectId: string }).effectId;
    const widen = await executeTool(
      "set_secondary_qualifier",
      { clipId: "c1", effectId, mode: "add", sample: { r: 255, g: 0, b: 0 } },
      host,
    );
    expect(widen.ok).toBe(true);
    const widened = effects(host)[0].params;
    expect(widened.hueMin).toBeCloseTo(358);
    const narrow = await executeTool(
      "set_secondary_qualifier",
      { clipId: "c1", effectId, mode: "subtract", sample: { r: 255, g: 0, b: 0 } },
      host,
    );
    expect(narrow.ok).toBe(true);
    expect(effects(host)[0].params.hueMin).toBeCloseTo(2);
    const explicit = await executeTool(
      "set_secondary_qualifier",
      { clipId: "c1", effectId, params: { denoise: 40, invert: true } },
      host,
    );
    expect(explicit.ok).toBe(true);
    expect(effects(host)[0].params.denoise).toBe(40);
    expect(effects(host)[0].params.invert).toBe(true);
    const empty = await executeTool("set_secondary_qualifier", { clipId: "c1", effectId }, host);
    expect(empty.ok).toBe(false);
  });

  it("adding a secondary is exactly one undo step", async () => {
    const history = new ActionHistory();
    const host = new HeadlessHost(makeProjectWithClip(), { history });
    await executeTool("add_hsl_secondary", { clipId: "c1", sample: { r: 255, g: 0, b: 0 } }, host);
    expect(history.getUndoStackSize()).toBe(1);
  });
});

function fakeMonitor(): ColorMonitorBridge {
  let state: ComparisonSnapshot = {
    mode: "off",
    reference: "bypass",
    split: 0.5,
    stillId: null,
    refTime: null,
    stills: [],
  };
  return {
    getComparison: () => state,
    setComparison: (patch) => {
      state = { ...state, ...patch, stillId: patch.stillId ?? state.stillId } as ComparisonSnapshot;
      return state;
    },
    grabStill: async ({ time, label }) => {
      const still = { id: "still-1", label: label ?? "Still 1", time: time ?? 0 };
      state = { ...state, stills: [...state.stills, still], stillId: still.id, reference: "still" };
      return { stillId: still.id, label: still.label, time: still.time, width: 640, height: 360 };
    },
  };
}

describe("agent comparison view tools", () => {
  it("are unavailable without a live editor", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    for (const name of ["grab_still", "toggle_comparison"]) {
      const res = await executeTool(name, {}, host);
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("UNSUPPORTED");
    }
  });

  it("grab_still then toggle_comparison against it", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    Object.assign(host, { colorMonitor: fakeMonitor() });
    const noStill = await executeTool("toggle_comparison", { reference: "still" }, host);
    expect(noStill.ok).toBe(false);
    const grabbed = await executeTool("grab_still", { time: 1.5, label: "Hero" }, host);
    expect(grabbed.ok).toBe(true);
    expect(grabbed.data).toMatchObject({ label: "Hero", time: 1.5 });
    const on = await executeTool("toggle_comparison", { mode: "split-h", split: 0.25 }, host);
    expect(on.ok).toBe(true);
    expect(on.data).toMatchObject({ mode: "split-h", split: 0.25, reference: "still" });
    const off = await executeTool("toggle_comparison", { mode: "off" }, host);
    expect((off.data as ComparisonSnapshot).mode).toBe("off");
    const toggled = await executeTool("toggle_comparison", {}, host);
    expect((toggled.data as ComparisonSnapshot).mode).toBe("split-v");
    const bad = await executeTool("toggle_comparison", { split: 4 }, host);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
  });
});
