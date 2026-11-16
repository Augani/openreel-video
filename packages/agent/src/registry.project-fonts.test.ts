import { describe, expect, it } from "vitest";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool, toMcpTools } from "./registry";
import { makeEmptyProject } from "./test-fixtures";
import type { EditingHost, ProjectFontReport } from "./host";

const report: ProjectFontReport = {
  fonts: [
    { family: "Brand Open", usages: ['Text clip "Hi"'], status: "embedded", fsType: 0, note: "Embedded in the package." },
    { family: "Brand Locked", usages: ['Caption "Yo"'], status: "restricted", fsType: 2, note: "License forbids embedding." },
    { family: "Bangers", usages: ["x"], status: "web", url: "https://fonts.googleapis.com/css2?family=Bangers", note: "web" },
  ],
};

describe("get_project_fonts", () => {
  it("is a read-only MCP tool", () => {
    expect(toMcpTools().some((t) => t.name === "get_project_fonts")).toBe(true);
    expect(getTool("get_project_fonts")).toMatchObject({ readOnly: true, destructive: false });
  });

  it("returns the host's font report with embed status and flags unembeddable fonts", async () => {
    const host = Object.assign(new HeadlessHost(makeEmptyProject()), {
      getProjectFonts: async () => report,
    }) as EditingHost;
    const result = await executeTool("get_project_fonts", {}, host);
    expect(result.ok).toBe(true);
    expect((result.data as ProjectFontReport).fonts.map((f) => [f.family, f.status])).toEqual([
      ["Brand Open", "embedded"],
      ["Brand Locked", "restricted"],
      ["Bangers", "web"],
    ]);
    expect(result.summary).toMatch(/3 font families used, 1 that cannot be embedded/);
  });

  it("fails clearly on a host without a live editor", async () => {
    const result = await executeTool("get_project_fonts", {}, new HeadlessHost(makeEmptyProject()));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNSUPPORTED");
  });
});
