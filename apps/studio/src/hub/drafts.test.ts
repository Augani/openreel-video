import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { saveDraft, loadDraft, listDrafts, deleteDraft } from "./drafts";

describe("drafts (IndexedDB)", () => {
  beforeEach(async () => {
    const drafts = await listDrafts();
    await Promise.all(drafts.map((d) => deleteDraft(d.id)));
  });

  it("saves and reloads a draft", async () => {
    await saveDraft({
      id: "d-1",
      kind: "effect",
      name: "My Effect",
      doc: { subjects: [], sampleClipId: "portrait-closeup-01" },
      thumbnailDataUrl: "",
      updatedAt: Date.now(),
      schemaVersion: 1,
    });
    const loaded = await loadDraft("d-1");
    expect(loaded?.name).toBe("My Effect");
  });

  it("lists drafts sorted by updatedAt desc", async () => {
    await saveDraft({
      id: "d-old", kind: "effect", name: "Old", doc: { subjects: [], sampleClipId: "x" },
      thumbnailDataUrl: "", updatedAt: 1000, schemaVersion: 1,
    });
    await saveDraft({
      id: "d-new", kind: "effect", name: "New", doc: { subjects: [], sampleClipId: "x" },
      thumbnailDataUrl: "", updatedAt: 2000, schemaVersion: 1,
    });
    const list = await listDrafts();
    expect(list.map((d) => d.id)).toEqual(["d-new", "d-old"]);
  });
});
