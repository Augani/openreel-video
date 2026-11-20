import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPremiereProjectFile, previewTimelineFile } from "./timeline-interchange";

const fixture = new Uint8Array(
  readFileSync(join(process.cwd(), "..", "..", "packages", "core", "src", "interchange", "__fixtures__", "main-cut.prproj")),
);

describe("previewTimelineFile with a Premiere project", () => {
  it("recognises .prproj names", () => {
    expect(isPremiereProjectFile("Cut.PRPROJ")).toBe(true);
    expect(isPremiereProjectFile("cut.xml")).toBe(false);
  });

  it("opens the biggest sequence, offers the others and re-reads a chosen one", async () => {
    const preview = await previewTimelineFile("main-cut.prproj", fixture);
    expect(preview.result.format).toBe("prproj");
    expect(preview.result.sequenceName).toBe("Main Cut");
    expect(preview.result.importReport?.dropped).toBe(1);
    expect(preview.prproj?.sequences.map((s) => s.name).sort()).toEqual(["Alt Cut", "Lower Third Nest", "Main Cut"]);
    const alt = preview.prproj!.sequences.find((s) => s.name === "Alt Cut")!;
    const switched = preview.prproj!.select(alt.id);
    expect(switched.result.sequenceName).toBe("Alt Cut");
    expect(switched.prproj?.selectedId).toBe(alt.id);
  });

  it("sniffs gzip content even when the file name does not say .prproj", async () => {
    const preview = await previewTimelineFile("renamed.bin", fixture);
    expect(preview.result.format).toBe("prproj");
  });

  it("fails with a readable error on a corrupt project", async () => {
    const bad = new Uint8Array(fixture);
    bad.fill(9, 30, 90);
    await expect(previewTimelineFile("bad.prproj", bad)).rejects.toThrow();
  });
});
