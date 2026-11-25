import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createSourceTranscriptRecord } from "@openreel/core";
import { SourceTranscriptStorage } from "./storage";

const record = createSourceTranscriptRecord({
  mediaHash: "H9",
  duration: 8,
  engine: "import",
  cues: [{ id: "c", text: "hi there", startTime: 1, endTime: 2 }],
  now: 1,
});

describe("source transcript storage (IndexedDB)", () => {
  it("saves, reloads through a new instance, and removes", async () => {
    await new SourceTranscriptStorage().save(record);
    const reloaded = await new SourceTranscriptStorage().get("H9");
    expect(reloaded.record).toEqual(record);
    await new SourceTranscriptStorage().remove("H9");
    expect((await new SourceTranscriptStorage().get("H9")).record).toBeNull();
  });

  it("returns nothing for a hash that was never stored (old project)", async () => {
    expect(await new SourceTranscriptStorage().get("nope")).toEqual({ record: null, raw: undefined });
  });
});
