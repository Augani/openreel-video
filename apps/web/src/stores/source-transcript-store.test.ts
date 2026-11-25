import { describe, expect, it, vi } from "vitest";
import type { MediaItem, Subtitle } from "@openreel/core";
import { MemoryTranscriptBackend, SourceTranscriptStorage } from "../services/source-transcripts/storage";
import { createSourceTranscriptStore, type SourceTranscriptDeps } from "./source-transcript-store";

const cues: Subtitle[] = [
  { id: "a", text: "Hello there world", startTime: 1, endTime: 4, words: [
    { text: "Hello", startTime: 1, endTime: 1.5 },
    { text: "there", startTime: 1.5, endTime: 2 },
    { text: "world", startTime: 2, endTime: 4 },
  ] },
];

const media = (id: string, duration = 10): MediaItem =>
  ({ id, name: `${id}.mp4`, type: "video", blob: null, fileHandle: null, metadata: { duration } }) as unknown as MediaItem;

function setup(blobs: Record<string, Blob | null>, hashes: Map<Blob, string>, backend = new MemoryTranscriptBackend()) {
  const transcribe = vi.fn(async (_m: MediaItem, onProgress: (f: number | null, msg: string) => void) => {
    onProgress(0.5, "Transcribing");
    return cues;
  });
  const deps: SourceTranscriptDeps = {
    storage: new SourceTranscriptStorage(backend),
    hash: async (blob) => hashes.get(blob) ?? "unknown",
    blobOf: async (m) => blobs[m.id] ?? null,
    transcribe,
  };
  return { store: createSourceTranscriptStore(deps), transcribe, backend, blobs, deps };
}

describe("source transcript store", () => {
  it("transcribes once, saves by media hash, and a fresh session reloads it without transcribing", async () => {
    const blob = new Blob(["a"]);
    const hashes = new Map([[blob, "H1"]]);
    const first = setup({ m1: blob }, hashes);
    const entry = await first.store.getState().transcribe(media("m1"));
    expect(entry.status).toBe("ready");
    expect(entry.transcript?.words.map((w) => w.text)).toEqual(["Hello", "there", "world"]);
    expect(first.backend.values.has("H1")).toBe(true);

    // New page load: empty store, same IndexedDB contents.
    const second = setup({ m1: blob }, hashes, first.backend);
    expect((await second.store.getState().refresh(media("m1"))).status).toBe("ready");
    expect(second.store.getState().entries.m1.transcript?.words).toHaveLength(3);
    expect(second.transcribe).not.toHaveBeenCalled();
  });

  it("shares one transcription between concurrent requests", async () => {
    const blob = new Blob(["a"]);
    const { store, transcribe } = setup({ m1: blob }, new Map([[blob, "H1"]]));
    await Promise.all([store.getState().transcribe(media("m1")), store.getState().transcribe(media("m1"))]);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("drops the transcript when the media is relinked to different content", async () => {
    const original = new Blob(["a"]);
    const replacement = new Blob(["bb"]);
    const hashes = new Map([[original, "H1"], [replacement, "H2"]]);
    const ctx = setup({ m1: original }, hashes);
    await ctx.store.getState().transcribe(media("m1"));
    ctx.blobs.m1 = replacement;
    const entry = await ctx.store.getState().refresh(media("m1"));
    expect(entry.status).toBe("none");
    expect(entry.relinked).toBe(true);
    expect(entry.transcript).toBeUndefined();
    // Relinking back to the original finds the cached transcript again.
    ctx.blobs.m1 = original;
    expect((await ctx.store.getState().refresh(media("m1"))).status).toBe("ready");
  });

  it("does not use a stored record whose duration disagrees with the linked media", async () => {
    const blob = new Blob(["a"]);
    const ctx = setup({ m1: blob }, new Map([[blob, "H1"]]));
    await ctx.store.getState().transcribe(media("m1", 10));
    const fresh = setup({ m1: blob }, new Map([[blob, "H1"]]), ctx.backend);
    expect((await fresh.store.getState().refresh(media("m1", 60))).status).toBe("none");
  });

  it("projects with no stored transcripts load cleanly, and offline media is reported", async () => {
    const blob = new Blob(["a"]);
    const { store } = setup({ m1: blob, m2: null }, new Map([[blob, "H1"]]));
    await store.getState().refreshAll([media("m1"), media("m2")]);
    expect(store.getState().entries.m1.status).toBe("none");
    expect(store.getState().entries.m2.status).toBe("offline");
  });

  it("ignores a corrupt stored value", async () => {
    const blob = new Blob(["a"]);
    const backend = new MemoryTranscriptBackend();
    await backend.put("H1", { version: 1, mediaHash: "H1", cues: "nope" });
    const { store } = setup({ m1: blob }, new Map([[blob, "H1"]]), backend);
    expect((await store.getState().refresh(media("m1"))).status).toBe("none");
  });

  it("reports a failed transcription and keeps nothing", async () => {
    const blob = new Blob(["a"]);
    const ctx = setup({ m1: blob }, new Map([[blob, "H1"]]));
    ctx.deps.transcribe = async () => {
      throw new Error("model failed");
    };
    const store = createSourceTranscriptStore(ctx.deps);
    const entry = await store.getState().transcribe(media("m1"));
    expect(entry).toMatchObject({ status: "error", error: "model failed" });
    expect(ctx.backend.values.size).toBe(0);
  });

  it("adopts imported cues and removes them again", async () => {
    const blob = new Blob(["a"]);
    const ctx = setup({ m1: blob }, new Map([[blob, "H1"]]));
    await ctx.store.getState().adopt(media("m1"), cues, "import");
    expect(ctx.store.getState().entries.m1.record?.engine).toBe("import");
    await ctx.store.getState().remove(media("m1"));
    expect(ctx.backend.values.size).toBe(0);
    expect(ctx.store.getState().entries.m1.status).toBe("none");
  });
});
