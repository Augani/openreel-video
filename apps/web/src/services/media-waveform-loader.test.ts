import { describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { MediaWaveformLoader } from "./media-waveform-loader";

const media = (id: string): MediaItem => ({
  id,
  name: `${id}.wav`,
  type: "audio",
  blob: new Blob([id]),
  fileHandle: null,
  thumbnailUrl: null,
  waveformData: null,
  metadata: {
    duration: 2,
    width: 0,
    height: 0,
    frameRate: 0,
    codec: "pcm",
    sampleRate: 48000,
    channels: 1,
    fileSize: 2,
  },
});
function fixture(items: MediaItem[]): Project {
  return { ...createEmptyProject("Waveform QA"), mediaLibrary: { items } };
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("background media waveform loading", () => {
  it("bounds decoding work and rebuilds only missing audio envelopes, including genuine silence", async () => {
    let project = fixture([
      media("a"),
      media("b"),
      media("c"),
      { ...media("cached"), waveformData: new Float32Array([0.5]) },
      { ...media("pending"), isPending: true },
    ]);
    const jobs = Array.from({ length: 3 }, () =>
      deferred<Float32Array | null>(),
    );
    let nextJob = 0;
    const generate = vi.fn(() => jobs[nextJob++].promise);
    const publish = vi.fn((_id, item, peaks) => {
      project = {
        ...project,
        mediaLibrary: {
          items: project.mediaLibrary.items.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, waveformData: peaks }
              : candidate,
          ),
        },
      };
      loader.update(project, true, true);
    });
    const loader = new MediaWaveformLoader({ generate, publish });
    loader.update(project, false, true);
    expect(generate).not.toHaveBeenCalled();
    loader.update(project, true, true);
    expect(generate).toHaveBeenCalledTimes(2);
    jobs[0].resolve(new Float32Array([0.2, 0.8]));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
    jobs[1].resolve(new Float32Array([0, 0]));
    jobs[2].resolve(new Float32Array([0.1, 0.4]));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(3));
    loader.update(project, true, true);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(project.mediaLibrary.items[1].waveformData).toEqual(
      new Float32Array([0, 0]),
    );
    loader.dispose();
  });
  it("cancels removed/replaced sources and rejects late results from another project", async () => {
    const first = deferred<Float32Array | null>(),
      second = deferred<Float32Array | null>(),
      third = deferred<Float32Array | null>();
    const generate = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const publish = vi.fn();
    const loader = new MediaWaveformLoader({ generate, publish });
    const project = fixture([media("same-id")]);
    loader.update(project, true, true);
    const originalSignal = generate.mock.calls[0][1] as AbortSignal;
    const replacement = {
      ...project,
      mediaLibrary: {
        items: [
          { ...project.mediaLibrary.items[0], blob: new Blob(["new source"]) },
        ],
      },
    };
    loader.update(replacement, true, true);
    expect(originalSignal.aborted).toBe(true);
    first.resolve(new Float32Array([0.9]));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(publish).not.toHaveBeenCalled();
    loader.update({ ...replacement, id: "another-project" }, true, true);
    expect((generate.mock.calls[1][1] as AbortSignal).aborted).toBe(true);
    second.resolve(new Float32Array([0.7]));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
    expect(publish).not.toHaveBeenCalled();
    loader.dispose();
    expect((generate.mock.calls[2][1] as AbortSignal).aborted).toBe(true);
    third.resolve(new Float32Array([0.5]));
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });
  it("does not invent peaks or retry a failed source on every edit, and retries a replacement", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(new Float32Array([0.3]));
    const publish = vi.fn();
    const loader = new MediaWaveformLoader({ generate, publish });
    const project = fixture([media("unsupported")]);
    loader.update(project, true, true);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await Promise.resolve();
    loader.update({ ...project, name: "An unrelated edit" }, true, true);
    expect(generate).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    loader.update(
      {
        ...project,
        mediaLibrary: {
          items: [
            {
              ...project.mediaLibrary.items[0],
              blob: new Blob(["replacement"]),
            },
          ],
        },
      },
      true,
      true,
    );
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    loader.dispose();
  });
});
