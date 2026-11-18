import { describe, expect, it } from "vitest";
import { enqueueImportBatch, takeNextImportBatch, type PendingImportBatch } from "./import-batch-queue";

const file = (name: string) => new File(["x"], name);

describe("import batch queue", () => {
  it("keeps a batch picked while another is importing and hands it out in pick order", () => {
    const pending: PendingImportBatch<string>[] = [];
    enqueueImportBatch(pending, "p1", [file("resumeB.mp4")]);
    enqueueImportBatch(pending, "p1", [file("c.mp4"), file("d.mp4")]);
    const first = takeNextImportBatch(pending, () => true);
    expect(first?.files.map((f) => f.name)).toEqual(["resumeB.mp4"]);
    expect(takeNextImportBatch(pending, () => true)?.files.map((f) => f.name)).toEqual(["c.mp4", "d.mp4"]);
    expect(takeNextImportBatch(pending, () => true)).toBeNull();
  });

  it("drops batches that belong to a replaced project", () => {
    const pending: PendingImportBatch<string>[] = [];
    enqueueImportBatch(pending, "old", [file("a.mp4")]);
    enqueueImportBatch(pending, "new", [file("b.mp4")]);
    expect(takeNextImportBatch(pending, (owner) => owner === "new")?.files[0].name).toBe("b.mp4");
    expect(pending).toHaveLength(0);
  });

  it("ignores an empty batch", () => {
    const pending: PendingImportBatch<string>[] = [];
    enqueueImportBatch(pending, "p", []);
    expect(pending).toHaveLength(0);
  });
});
