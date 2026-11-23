import { describe, expect, it, vi } from "vitest";
import { MediaImportService } from "./media-import-service";
import type { MediaBunnyEngine } from "./mediabunny-engine";
import type { FFmpegFallback } from "./ffmpeg-fallback";

const bridge = vi.hoisted(() => ({ available: false, probe: vi.fn() }));
vi.mock("./native-media-bridge", () => ({
  nativeMediaAvailable: () => bridge.available,
  probeAudioStreamsViaNative: bridge.probe,
}));

const streams = (channels: number[]) => channels.map((count, index) => ({ index, codec: "aac", sampleRate: 48000, channels: count, channelLayout: count === 1 ? "mono" : "stereo" }));
const service = (probed: ReturnType<typeof streams>) =>
  new MediaImportService({ isAvailable: () => true } as unknown as MediaBunnyEngine, { probeAudioStreams: vi.fn().mockResolvedValue({ audioStreamCount: probed.length, streams: probed }) } as unknown as FFmpegFallback) as unknown as {
    probeAudioStreamsCompat(file: Blob): Promise<{ audioStreamCount: number; channels?: number[] }>;
  };

describe("per-stream audio channels from the importer's probe", () => {
  it("the browser path reports the channel count of every stream the ffmpeg probe finds (mono beside stereo)", async () => {
    bridge.available = false;
    expect(await service(streams([1, 2])).probeAudioStreamsCompat(new Blob(["x"]))).toEqual({ audioStreamCount: 2, channels: [1, 2] });
  });

  it("the desktop path reports them from the native probe", async () => {
    bridge.available = true;
    bridge.probe.mockResolvedValue({ audioStreamCount: 3, channels: [2, 1, 6] });
    expect(await service(streams([2])).probeAudioStreamsCompat(new Blob(["x"]))).toEqual({ audioStreamCount: 3, channels: [2, 1, 6] });
    bridge.available = false;
  });
});
