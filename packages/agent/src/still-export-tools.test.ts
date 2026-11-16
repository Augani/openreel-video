import { describe, expect, it } from "vitest";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool, toMcpTools } from "./registry";
import { makeEmptyProject } from "./test-fixtures";
import type { EditingHost, JobResult } from "./host";

function stillHost(job?: (params: Record<string, unknown>) => JobResult) {
  const jobs: Array<[string, Record<string, unknown>]> = [];
  const host = Object.assign(new HeadlessHost(makeEmptyProject()), {
    runJob: async (kind: string, params: Record<string, unknown>): Promise<JobResult> => {
      jobs.push([kind, params]);
      return job ? job(params) : { ok: true, data: { path: "/tmp/out.zip", frames: 3 } };
    },
  }) as EditingHost;
  return { host, jobs };
}

describe("export_image_sequence", () => {
  it("is registered as an expensive, non-editing export tool", () => {
    expect(getTool("export_image_sequence")).toMatchObject({ domain: "export", expensive: true, readOnly: false });
    expect(toMcpTools().some((t) => t.name === "export_image_sequence")).toBe(true);
    const props = Object.keys((getTool("export_image_sequence")!.inputSchema as { properties: Record<string, unknown> }).properties);
    for (const key of ["format", "quality", "width", "height", "rangeStart", "rangeEnd", "pattern", "startNumber", "outputPath"]) expect(props).toContain(key);
  });

  it("passes validated options to the exportImageSequence job", async () => {
    const { host, jobs } = stillHost();
    const result = await executeTool(
      "export_image_sequence",
      { format: "jpg", quality: 80, rangeStart: 1, rangeEnd: 2.5, pattern: "shot_{000}", startNumber: 100 },
      host,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(jobs).toEqual([
      ["exportImageSequence", { format: "jpg", quality: 80, startNumber: 100, pattern: "shot_{000}", range: { startTime: 1, endTime: 2.5 } }],
    ]);
  });

  it("rejects bad input before starting a job", async () => {
    const { host, jobs } = stillHost();
    for (const args of [
      { format: "gif" },
      { quality: 0 },
      { width: 1.5 },
      { rangeStart: 1 },
      { rangeStart: 3, rangeEnd: 2 },
      { pattern: "" },
      { overwrite: true },
      { outputPath: "/x/out.png" },
    ]) {
      const result = await executeTool("export_image_sequence", args, host);
      expect(result.ok, JSON.stringify(args)).toBe(false);
    }
    expect(jobs).toEqual([]);
  });

  it("surfaces a job failure with its code", async () => {
    const { host } = stillHost(() => ({ ok: false, error: "An image sequence is limited to 5000 frames.", code: "JOB_FAILED" }));
    const result = await executeTool("export_image_sequence", {}, host);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/limited/);
  });
});

describe("export_gif", () => {
  it("passes fps, palette, loop and range to the exportGif job", async () => {
    const { host, jobs } = stillHost();
    const result = await executeTool("export_gif", { fps: 12, width: 480, maxColors: 64, loop: "none", rangeStart: 0, rangeEnd: 2 }, host);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(jobs).toEqual([["exportGif", { fps: 12, width: 480, maxColors: 64, loop: "none", range: { startTime: 0, endTime: 2 } }]]);
  });

  it("validates ranges of every option", async () => {
    const { host, jobs } = stillHost();
    for (const args of [{ fps: 0 }, { fps: 60 }, { maxColors: 1 }, { maxColors: 300 }, { loop: -1 }, { loop: "forever" }, { width: 5000 }, { rangeEnd: 3 }]) {
      expect((await executeTool("export_gif", args, host)).ok, JSON.stringify(args)).toBe(false);
    }
    expect(jobs).toEqual([]);
  });

  it("answers NO_PROJECT without an open project", async () => {
    const host = Object.assign(new HeadlessHost(makeEmptyProject()), {
      requireOpenProject: () => {
        throw new Error("no project");
      },
    }) as EditingHost;
    const result = await executeTool("export_gif", {}, host);
    expect(result.error).toMatchObject({ code: "NO_PROJECT" });
  });
});
