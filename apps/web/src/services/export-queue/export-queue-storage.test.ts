import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import { loadSnapshot, pruneStorage, saveSnapshot } from "./export-queue-storage";
import { deleteMediaBlob, saveMediaBlob } from "../media-storage";

/**
 * jsdom's Blob is not structured-cloneable by fake-indexeddb; the store only reads `size` and
 * `type` (for the dedupe key) and hands the value back untouched, so a plain object stands in.
 */
const fakeBlob = (text: string): Blob => ({ size: text.length, type: "video/mp4", text }) as unknown as Blob;

/** Minimal project: only the media library matters to the snapshot store. */
function projectWith(mediaIds: string[], bytes: Record<string, string>): Project {
  return {
    id: "p",
    mediaLibrary: {
      items: mediaIds.map((id) => ({
        id,
        name: id,
        blob: fakeBlob(bytes[id] ?? id),
        fileHandle: null,
      })),
    },
  } as unknown as Project;
}

const blobText = async (project: Project, mediaId: string): Promise<string | null> => {
  const blob = project.mediaLibrary.items.find((i) => i.id === mediaId)?.blob as unknown as { text: string } | null | undefined;
  return blob ? blob.text : null;
};

describe("export queue storage pruning", () => {
  it("removes the snapshot of a deleted job and blobs nothing references any more", async () => {
    expect(await saveSnapshot("gone", projectWith(["only-gone"], { "only-gone": "aaaa" }))).toBe(true);
    expect(await saveSnapshot("kept", projectWith(["only-kept"], { "only-kept": "bbbb" }))).toBe(true);

    await pruneStorage(() => new Set(["kept"]));

    expect(await loadSnapshot("gone")).toBeNull();
    const kept = await loadSnapshot("kept");
    expect(await blobText(kept as Project, "only-kept")).toBe("bbbb");
  });

  it("keeps a blob that a surviving job still shares with a pruned one", async () => {
    await saveSnapshot("a", projectWith(["shared"], { shared: "same" }));
    await saveSnapshot("b", projectWith(["shared"], { shared: "same" }));

    await pruneStorage(() => new Set(["b"]));

    expect(await loadSnapshot("a")).toBeNull();
    expect(await blobText((await loadSnapshot("b")) as Project, "shared")).toBe("same");
  });

  // The prune race: pruning used to capture the live job set BEFORE it listed the snapshots, so a
  // job enqueued in between (queue state updated, snapshot already written) looked stale and its
  // snapshot AND blobs were deleted. The live set is now read lazily, after the snapshot keys.
  it("reads the live job set lazily: a job enqueued while pruning runs keeps its snapshot and blobs", async () => {
    const live = new Set<string>(["old"]);
    await saveSnapshot("old", projectWith(["m-old"], { "m-old": "old-bytes" }));
    // The new job's snapshot is written first, then it joins the queue state, all while the
    // prune is in flight; the prune must see it when it finally asks for the live set.
    await saveSnapshot("racing", projectWith(["m-racing"], { "m-racing": "racing-bytes" }));
    let asked = 0;
    let snapshotKeyListsBeforeAsk = 0;
    // A lazy read happens AFTER the snapshot keys were listed; an eager read happens before. Count
    // the key listings that already happened when the live set is requested so the test fails if
    // someone moves `liveJobIds()` back to the top of pruneStorage.
    const getAllKeys = vi.spyOn(IDBObjectStore.prototype, "getAllKeys");
    const lazyLive = (): ReadonlySet<string> => {
      asked += 1;
      snapshotKeyListsBeforeAsk = getAllKeys.mock.calls.length;
      live.add("racing");
      return live;
    };

    try {
      await pruneStorage(lazyLive);
    } finally {
      getAllKeys.mockRestore();
    }

    expect(asked).toBe(1);
    expect(snapshotKeyListsBeforeAsk).toBeGreaterThanOrEqual(1);
    expect(await blobText((await loadSnapshot("racing")) as Project, "m-racing")).toBe("racing-bytes");
    expect(await blobText((await loadSnapshot("old")) as Project, "m-old")).toBe("old-bytes");
  });

  it("does not lose a blob when a snapshot reusing it is saved concurrently with the sweep", async () => {
    // "stale" is the only reference to the blob today; "fresh" reuses the very same blob key
    // (same media id, size and type) while the sweep is running.
    await saveSnapshot("stale", projectWith(["clip"], { clip: "payload" }));
    const live = new Set<string>(["fresh"]);

    await Promise.all([
      pruneStorage(() => live),
      saveSnapshot("fresh", projectWith(["clip"], { clip: "payload" })),
    ]);

    expect(await loadSnapshot("stale")).toBeNull();
    const fresh = await loadSnapshot("fresh");
    expect(fresh).not.toBeNull();
    expect(await blobText(fresh as Project, "clip")).toBe("payload");
  });
});

describe("snapshots reuse the project's media store instead of copying gigabytes", () => {
  const meta = { duration: 1, width: 1, height: 1, frameRate: 30, codec: "h264", sampleRate: 0, channels: 0, fileSize: 1 } as never;

  it("references bytes the project store already holds, and reads them back from there", async () => {
    await saveMediaBlob("proj", "big", fakeBlob("source-bytes"), meta);
    expect(await saveSnapshot("ref", projectWith(["big"], { big: "source-bytes" }))).toBe(true);

    // Nothing was copied into the queue database's media store.
    const db: IDBDatabase = await new Promise((resolve) => {
      const open = indexedDB.open("openreel-export-queue");
      open.onsuccess = () => resolve(open.result);
    });
    const copied: unknown[] =await new Promise((resolve) => {
      const req = db.transaction("media").objectStore("media").getAllKeys();
      req.onsuccess = () => resolve(req.result);
    });
    expect(copied.some((k) => String(k).startsWith("big:"))).toBe(false);

    expect(await blobText((await loadSnapshot("ref")) as Project, "big")).toBe("source-bytes");
  });

  it("copies bytes the project store does not hold (or holds with a different size)", async () => {
    await saveMediaBlob("proj", "changed", fakeBlob("now-longer-bytes"), meta);
    expect(await saveSnapshot("copy", projectWith(["changed"], { changed: "short" }))).toBe(true);
    expect(await blobText((await loadSnapshot("copy")) as Project, "changed")).toBe("short");
  });

  it("a referenced snapshot fails cleanly when the project media was replaced or removed", async () => {
    await saveMediaBlob("proj", "gone-later", fakeBlob("original"), meta);
    await saveSnapshot("dangling", projectWith(["gone-later"], { "gone-later": "original" }));
    await saveMediaBlob("proj", "gone-later", fakeBlob("replaced-with-other-size"), meta);
    expect(await loadSnapshot("dangling")).toBeNull();
    await deleteMediaBlob("gone-later");
    expect(await loadSnapshot("dangling")).toBeNull();
  });
});
