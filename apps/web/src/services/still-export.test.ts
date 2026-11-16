import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core/types/project";

const { engine } = vi.hoisted(() => ({
  engine: {
    initialize: vi.fn(async () => undefined),
    exportGif: vi.fn(),
    exportImageSequenceZip: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return { ...actual, getExportEngine: () => engine };
});

import { cancelStillExport, runStillExport, stillExportFilename } from "./still-export";
import { stillRequestFromParams } from "./agent/export-job-runner";

const project = { name: "My Cut" } as unknown as Project;

function generator(result: unknown, steps = 2) {
  return (async function* () {
    for (let i = 0; i < steps; i++) yield { phase: "rendering", progress: i / steps, totalFrames: steps, currentFrame: i };
    return result;
  })();
}

beforeEach(() => {
  engine.exportGif.mockReset();
  engine.exportImageSequenceZip.mockReset();
  engine.cancel.mockReset();
});

describe("runStillExport", () => {
  it("routes a sequence request to the zip engine and reports progress", async () => {
    engine.exportImageSequenceZip.mockReturnValue(
      generator({ success: true, blob: new Blob(["z"]), stats: { framesRendered: 2 } }),
    );
    const progress = vi.fn();
    const outcome = await runStillExport(project, { kind: "sequence", format: "jpg", quality: 70, pattern: "a_{00}", startNumber: 5, range: { startTime: 1, endTime: 2 } }, progress);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.output).toMatchObject({ ext: "zip", contentType: "application/zip", frames: 2 });
    expect(engine.exportImageSequenceZip).toHaveBeenCalledWith(project, {
      format: "jpg",
      quality: 70,
      width: undefined,
      height: undefined,
      range: { startTime: 1, endTime: 2 },
      pattern: "a_{00}",
      startNumber: 5,
    });
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it("routes a GIF request to the GIF engine", async () => {
    engine.exportGif.mockReturnValue(generator({ success: true, blob: new Blob(["g"]), stats: { framesRendered: 7 } }));
    const outcome = await runStillExport(project, { kind: "gif", fps: 12, maxColors: 32, loop: "none" });
    expect(outcome.ok && outcome.output.ext).toBe("gif");
    expect(engine.exportGif).toHaveBeenCalledWith(project, expect.objectContaining({ fps: 12, maxColors: 32, loop: "none" }));
  });

  it("reports failures and cancellation", async () => {
    engine.exportGif.mockReturnValue(generator({ success: false, error: { code: "CANCELLED", message: "Export cancelled by user" } }, 0));
    expect(await runStillExport(project, { kind: "gif" })).toEqual({ ok: false, message: "Export cancelled by user", cancelled: true });
    engine.exportGif.mockReturnValue(generator({ success: false, error: { code: "INVALID_SETTINGS", message: "Too big" } }, 0));
    expect(await runStillExport(project, { kind: "gif" })).toEqual({ ok: false, message: "Too big" });
    cancelStillExport();
    expect(engine.cancel).toHaveBeenCalled();
  });

  it("names files from the project", () => {
    expect(stillExportFilename("My Cut!", { kind: "gif" })).toBe("My_Cut.gif");
    expect(stillExportFilename("My Cut", { kind: "sequence", format: "png" })).toBe("My_Cut-png-sequence.zip");
  });
});

describe("agent job parameters", () => {
  it("maps validated tool params to engine requests", () => {
    expect(stillRequestFromParams("exportImageSequence", { format: "jpg", quality: 80, pattern: "p_{000}", startNumber: 3, range: { startTime: 1, endTime: 2 } })).toEqual({
      kind: "sequence",
      format: "jpg",
      quality: 80,
      width: undefined,
      height: undefined,
      range: { startTime: 1, endTime: 2 },
      pattern: "p_{000}",
      startNumber: 3,
    });
    expect(stillRequestFromParams("exportGif", { fps: 12, loop: "none", maxColors: 16 })).toMatchObject({ kind: "gif", fps: 12, loop: "none", maxColors: 16, range: undefined });
    expect(stillRequestFromParams("exportGif", { loop: 0 })).toMatchObject({ loop: 0 });
  });
});
