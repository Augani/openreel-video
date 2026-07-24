import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeLayer,
} from "@openreel/core/motion/types";
import type {
  EditingHost,
  MotionRenderQueueBridge,
  MotionRenderQueueAddInput,
  MotionRenderQueueAddResult,
  MotionRenderQueueAddError,
  MotionRenderQueueRunOutcome,
  MotionRenderQueueRunResult,
} from "./host";
import type { Project } from "@openreel/core/types/project";

const COMP_ID = "comp-queue";
const SHAPE_ID = "layer-shape";

function shapeLayer(): MotionShapeLayer {
  return {
    id: SHAPE_ID,
    type: "shape",
    name: "Shape",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 200,
    height: 120,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 0.8 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}

function baseComposition(
  overrides: Partial<MotionComposition> = {},
): MotionComposition {
  return {
    id: COMP_ID,
    name: "Queue Scene",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 6,
    backgroundColor: "#101820",
    layers: [shapeLayer() as MotionLayer],
    assets: [],
    variables: [],
    markers: [],
    lights: [],
    createdAt: 1,
    modifiedAt: 1,
    ...overrides,
  };
}

function projectWith(composition: MotionComposition): Project {
  return {
    ...makeEmptyProject(),
    motionCompositions: [composition],
  } as unknown as Project;
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Expected data object");
  return value as Record<string, unknown>;
}

interface QueueEntry {
  id: string;
  compositionId: string;
  format: string;
  status: string;
  range?: { startTime: number; endTime: number };
  resolutionScale?: number;
  cancelRequested?: boolean;
}

function hostWithQueue(composition: MotionComposition): {
  host: EditingHost;
  entries: QueueEntry[];
} {
  const base = new HeadlessHost(projectWith(composition));
  const entries: QueueEntry[] = [];
  let counter = 0;
  const bridge: MotionRenderQueueBridge = {
    add: (
      input: MotionRenderQueueAddInput,
    ): MotionRenderQueueAddResult | MotionRenderQueueAddError => {
      const id = `item-${(counter += 1)}`;
      entries.push({
        id,
        compositionId: input.compositionId,
        format: input.format ?? "mp4",
        status: "queued",
        ...(input.range ? { range: input.range } : {}),
        ...(input.resolutionScale !== undefined
          ? { resolutionScale: input.resolutionScale }
          : {}),
      });
      return { itemId: id };
    },
    run: async (): Promise<MotionRenderQueueRunResult> => {
      const outcomes: MotionRenderQueueRunOutcome[] = [];
      for (const entry of entries) {
        if (entry.status === "queued") {
          if (entry.cancelRequested === true) {
            entry.status = "canceled";
            outcomes.push({ itemId: entry.id, status: "canceled" });
            continue;
          }
          entry.status = "complete";
          outcomes.push({
            itemId: entry.id,
            status: "complete",
            encodedFormat: entry.format,
            filename: `${entry.id}.mp4`,
          });
        }
      }
      return { outcomes, alreadyRunning: false };
    },
    list: (): ReadonlyArray<Record<string, unknown>> =>
      entries.map((entry) => ({
        itemId: entry.id,
        compositionId: entry.compositionId,
        format: entry.format,
        status: entry.status,
      })),
    cancel: (itemId: string): boolean => {
      const entry = entries.find((candidate) => candidate.id === itemId);
      if (!entry) return false;
      entry.cancelRequested = true;
      if (entry.status === "queued") entry.status = "canceled";
      return true;
    },
  };
  const host: EditingHost = Object.assign(base, { motionRenderQueue: bridge });
  return { host, entries };
}

describe("render queue MCP tools — registration", () => {
  it("registers all four queue tools with the expected flags", () => {
    const queue = getTool("queue_motion_render");
    const run = getTool("run_motion_render_queue");
    const list = getTool("list_motion_render_queue");
    const cancel = getTool("cancel_motion_render_item");
    expect(queue?.readOnly).toBe(false);
    expect(run?.expensive).toBe(true);
    expect(list?.readOnly).toBe(true);
    expect(cancel).toBeDefined();
  });
});

describe("render queue MCP tools — headless graceful failure", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["queue_motion_render", { compositionId: COMP_ID }],
    ["run_motion_render_queue", {}],
    ["list_motion_render_queue", {}],
    ["cancel_motion_render_item", { itemId: "item-1" }],
  ];
  for (const [name, args] of cases) {
    it(`${name} fails gracefully without the capability`, async () => {
      const host = new HeadlessHost(projectWith(baseComposition()));
      const result = await executeTool(name, args, host);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("UNSUPPORTED");
      expect(result.summary.toLowerCase()).toContain("render queue");
      expect(result.summary.toLowerCase()).toContain("not supported");
    });
  }
});

describe("queue_motion_render — validation", () => {
  it("requires compositionId", async () => {
    const { host } = hostWithQueue(baseComposition());
    const result = await executeTool("queue_motion_render", {}, host);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects an unknown format", async () => {
    const { host } = hostWithQueue(baseComposition());
    const result = await executeTool(
      "queue_motion_render",
      { compositionId: COMP_ID, format: "gif" },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects an invalid resolution scale", async () => {
    const { host } = hostWithQueue(baseComposition());
    const result = await executeTool(
      "queue_motion_render",
      { compositionId: COMP_ID, resolutionScale: 0.75 },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects a range outside the composition duration", async () => {
    const { host } = hostWithQueue(baseComposition());
    const result = await executeTool(
      "queue_motion_render",
      { compositionId: COMP_ID, rangeStart: 0, rangeEnd: 99 },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects a range whose start is not before end", async () => {
    const { host } = hostWithQueue(baseComposition());
    const result = await executeTool(
      "queue_motion_render",
      { compositionId: COMP_ID, rangeStart: 3, rangeEnd: 2 },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("fails NOT_FOUND for a missing composition", async () => {
    const { host } = hostWithQueue(baseComposition());
    const result = await executeTool(
      "queue_motion_render",
      { compositionId: "missing" },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("requires acknowledgeH264Fallback for ProRes on web", async () => {
    const { host } = hostWithQueue(baseComposition());
    const result = await executeTool(
      "queue_motion_render",
      { compositionId: COMP_ID, format: "mov-prores4444" },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.summary.toLowerCase()).toContain("acknowledgeh264fallback");
  });

  it("queues ProRes when the fallback is acknowledged", async () => {
    const { host, entries } = hostWithQueue(baseComposition());
    const result = await executeTool(
      "queue_motion_render",
      {
        compositionId: COMP_ID,
        format: "mov-prores4444",
        acknowledgeH264Fallback: true,
      },
      host,
    );
    expect(result.ok).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].format).toBe("mov-prores4444");
  });

  it("queues png-sequence without acknowledgement (bypasses the guardrail)", async () => {
    const { host, entries } = hostWithQueue(baseComposition());
    const result = await executeTool(
      "queue_motion_render",
      { compositionId: COMP_ID, format: "png-sequence" },
      host,
    );
    expect(result.ok).toBe(true);
    expect(entries[0].format).toBe("png-sequence");
  });
});

describe("render queue MCP tools — round-trip", () => {
  it("queues, lists, cancels, and runs with per-item outcomes", async () => {
    const { host } = hostWithQueue(baseComposition());
    const added = await executeTool(
      "queue_motion_render",
      {
        compositionId: COMP_ID,
        format: "mp4",
        resolutionScale: 0.5,
        rangeStart: 0,
        rangeEnd: 1,
      },
      host,
    );
    expect(added.ok).toBe(true);
    const addedData = dataRecord(added.data);
    const itemId = String(addedData.itemId);
    expect(itemId).toBeTruthy();

    const listed = await executeTool("list_motion_render_queue", {}, host);
    expect(listed.ok).toBe(true);
    const listedData = dataRecord(listed.data);
    const items = listedData.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe(itemId);

    const secondAdd = await executeTool(
      "queue_motion_render",
      { compositionId: COMP_ID },
      host,
    );
    const secondId = String(dataRecord(secondAdd.data).itemId);

    const canceled = await executeTool(
      "cancel_motion_render_item",
      { itemId },
      host,
    );
    expect(canceled.ok).toBe(true);

    const run = await executeTool("run_motion_render_queue", {}, host);
    expect(run.ok).toBe(true);
    const runData = dataRecord(run.data);
    const outcomes = runData.outcomes as Array<Record<string, unknown>>;
    const byId = new Map(outcomes.map((o) => [o.itemId, o]));
    expect(byId.get(secondId)?.status).toBe("complete");
    expect(byId.get(secondId)?.encodedFormat).toBe("mp4");

    const afterList = await executeTool("list_motion_render_queue", {}, host);
    const afterItems = dataRecord(afterList.data).items as Array<
      Record<string, unknown>
    >;
    const canceledEntry = afterItems.find((entry) => entry.itemId === itemId);
    expect(canceledEntry?.status).toBe("canceled");
  });

  it("surfaces already-running through the MCP run tool result", async () => {
    const { host } = hostWithQueue(baseComposition());
    if (!host.motionRenderQueue) throw new Error("bridge missing");
    host.motionRenderQueue.run = async (): Promise<MotionRenderQueueRunResult> => ({
      outcomes: [],
      alreadyRunning: true,
    });

    const run = await executeTool("run_motion_render_queue", {}, host);
    expect(run.ok).toBe(true);
    const runData = dataRecord(run.data);
    expect(runData.alreadyRunning).toBe(true);
    expect((runData.outcomes as unknown[]).length).toBe(0);
    expect(run.summary.toLowerCase()).toContain("already running");
  });

  it("cancel returns not-found for an unknown item", async () => {
    const { host } = hostWithQueue(baseComposition());
    const result = await executeTool(
      "cancel_motion_render_item",
      { itemId: "nope" },
      host,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
