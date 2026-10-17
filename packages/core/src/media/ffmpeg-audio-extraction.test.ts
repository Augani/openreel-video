import { describe, expect, it, vi } from "vitest";
import { FFmpegFallback } from "./ffmpeg-fallback";

const setup = () => {
  const fallback = new FFmpegFallback();
  vi.spyOn(fallback, "load").mockResolvedValue();
  const ffmpeg = {
    writeFile: vi.fn().mockResolvedValue(undefined), exec: vi.fn().mockResolvedValue(0),
    readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2])),
    deleteFile: vi.fn().mockResolvedValue(undefined), on: vi.fn(), off: vi.fn(),
  };
  Object.assign(fallback, { ffmpeg, loaded: true });
  return { fallback, ffmpeg };
};

describe("audio extraction stream isolation", () => {
  it("isolates temporary files across concurrent stream extractions", async () => {
    const { fallback, ffmpeg } = setup();
    const files = new Map<string, Uint8Array>();
    ffmpeg.exec.mockImplementation(async (args: string[]) => {
      const stream = args[args.indexOf("-map") + 1];
      files.set(args.at(-1)!, new Uint8Array([stream === "0:a:0" ? 10 : 20]));
      return 0;
    });
    ffmpeg.readFile.mockImplementation(async (name: string) => files.get(name)!);
    const results = await Promise.all([0, 1].map((stream) =>
      fallback.extractAudioAsWav(new Blob(["video"]), stream),
    ));
    expect(await results[0].arrayBuffer()).toEqual(new Uint8Array([10]).buffer);
    expect(await results[1].arrayBuffer()).toEqual(new Uint8Array([20]).buffer);
    expect(new Set(ffmpeg.writeFile.mock.calls.map(([name]) => name)).size).toBe(2);
    expect(new Set(ffmpeg.readFile.mock.calls.map(([name]) => name)).size).toBe(2);
    expect(ffmpeg.deleteFile).toHaveBeenCalledTimes(4);
  });

  it("rejects failed extractions and never reads leftover output", async () => {
    const { fallback, ffmpeg } = setup();
    ffmpeg.exec.mockResolvedValueOnce(1);
    await expect(fallback.extractAudioAsWav(new Blob(["video"]), 2)).rejects.toThrow("audio stream 2");
    expect(ffmpeg.readFile).not.toHaveBeenCalled();
    expect(ffmpeg.deleteFile).toHaveBeenCalledTimes(2);
  });

  it("only returns the bytes in the output view", async () => {
    const { fallback, ffmpeg } = setup();
    ffmpeg.readFile.mockResolvedValueOnce(new Uint8Array([99, 1, 2, 99]).subarray(1, 3));
    const wav = await fallback.extractAudioAsWav(new Blob(["video"]), 0);
    expect(new Uint8Array(await wav.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });
});
