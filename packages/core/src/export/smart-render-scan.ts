import { descriptionBytes, parseAvcC } from "./avc-config";
import type { SmartRenderEngine, SmartRenderSourceInfo } from "./smart-render";

type MediaBunnyModule = typeof import("mediabunny");
type VideoTrack = NonNullable<Awaited<ReturnType<InstanceType<MediaBunnyModule["Input"]>["getPrimaryVideoTrack"]>>>;

const scans = new WeakMap<Blob, Partial<Record<SmartRenderEngine, Promise<SmartRenderSourceInfo | null>>>>();

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Snap a measured rate to the usual broadcast rates so 29.97 stays 30000/1001. */
function snapFrameRate(fps: number): number {
  for (const candidate of [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60]) {
    if (Math.abs(candidate - fps) < 0.02) return candidate;
  }
  return fps;
}

/**
 * Read the packet index of a video file (no pixel data) and describe it for
 * the smart-render planner. Returns null for anything that cannot be cut at a
 * key frame: a codec the engine cannot splice (WebCodecs: AVC; native ffmpeg:
 * AVC, HEVC and ProRes), variable frame rate, open GOPs, or no key frame metadata.
 * Results are cached per Blob and engine.
 */
export function scanSourceForSmartRender(
  mediabunny: MediaBunnyModule,
  mediaId: string,
  blob: Blob,
  engine: SmartRenderEngine = "webcodecs",
): Promise<SmartRenderSourceInfo | null> {
  const perBlob = scans.get(blob) ?? {};
  const cached = perBlob[engine];
  if (cached) return cached;
  const result = scan(mediabunny, mediaId, blob, engine).catch(() => null);
  perBlob[engine] = result;
  scans.set(blob, perBlob);
  return result;
}

/** profile_idc / level_idc of an AVCDecoderConfigurationRecord or HEVCDecoderConfigurationRecord. */
function profileAndLevel(codec: "avc" | "hevc", description: Uint8Array): { profile?: number; level?: number } {
  if (codec === "avc") return description.length >= 4 ? { profile: description[1], level: description[3] } : {};
  return description.length >= 13 ? { profile: description[1] & 0x1f, level: description[12] } : {};
}

const PRORES_FOURCC: Readonly<Record<string, NonNullable<SmartRenderSourceInfo["proresProfile"]>>> = {
  apco: "proxy",
  apcs: "lt",
  apcn: "standard",
  apch: "hq",
  ap4h: "4444",
  ap4x: "4444xq",
};

function proresProfileOf(fourcc: unknown): SmartRenderSourceInfo["proresProfile"] | undefined {
  return typeof fourcc === "string" ? PRORES_FOURCC[fourcc] : undefined;
}

/**
 * ProRes is all-intra: every frame is a cut point, so the packet index alone
 * says where a copy may start. Mediabunny does not decode ProRes but lists its
 * packets (and the sample entry fourcc, which names the profile).
 */
async function scanProRes(
  mediaId: string,
  track: VideoTrack,
  proresProfile: NonNullable<SmartRenderSourceInfo["proresProfile"]>,
  mediabunny: MediaBunnyModule,
  colorSpace: { matrix?: string | null; transfer?: string | null; primaries?: string | null; fullRange?: boolean | null },
): Promise<SmartRenderSourceInfo | null> {
  const sink = new mediabunny.EncodedPacketSink(track);
  const times: number[] = [];
  for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) times.push(packet.timestamp);
  if (times.length < 2) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) diffs.push(sorted[i] - sorted[i - 1]);
  const frameDuration = median(diffs);
  if (!(frameDuration > 0)) return null;
  const frameRate = snapFrameRate(1 / frameDuration);
  const grid = 1 / frameRate;
  const firstPts = sorted[0];
  const constantFrameRate =
    sorted.every((time) => {
      const k = (time - firstPts) / grid;
      return Math.abs(k - Math.round(k)) < 0.02;
    }) && new Set(sorted.map((time) => Math.round((time - firstPts) / grid))).size === sorted.length;
  return {
    mediaId,
    codec: "prores",
    width: track.codedWidth,
    height: track.codedHeight,
    frameRate,
    firstPts,
    endTime: sorted[sorted.length - 1] + grid,
    keyframeTimes: sorted,
    closedGops: true,
    constantFrameRate,
    nalLengthSize: 4,
    rotation: track.rotation,
    allIntra: true,
    proresProfile,
    color: {
      matrix: colorSpace.matrix,
      transfer: colorSpace.transfer,
      primaries: colorSpace.primaries,
      fullRange: colorSpace.fullRange,
    },
  };
}

async function scan(
  mediabunny: MediaBunnyModule,
  mediaId: string,
  blob: Blob,
  engine: SmartRenderEngine,
): Promise<SmartRenderSourceInfo | null> {
  const { Input, BlobSource, ALL_FORMATS, EncodedPacketSink } = mediabunny;
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const proresProfile = engine === "native" && track.codec === null ? proresProfileOf(track.internalCodecId) : undefined;
    if (proresProfile) return await scanProRes(mediaId, track, proresProfile, mediabunny, await track.getColorSpace());
    const codec = track.codec;
    if (codec !== "avc" && !(engine === "native" && codec === "hevc")) return null;
    const config = await track.getDecoderConfig();
    if (!config?.description) return null;
    const description = descriptionBytes(config.description);
    // Only the WebCodecs muxer rewrites length-prefixed AVC packets itself.
    const params = codec === "avc" ? parseAvcC(description) : null;
    if (codec === "avc" && !params) return null;

    const sink = new EncodedPacketSink(track);
    const times: number[] = [];
    const isKey: boolean[] = [];
    for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
      times.push(packet.timestamp);
      isKey.push(packet.type === "key");
    }
    if (times.length < 2) return null;
    const colorSpace = await track.getColorSpace();

    // Closed GOPs: in decode order every packet before a key frame presents
    // before it and every packet from it onward presents at or after it.
    const n = times.length;
    const suffixMin = new Array<number>(n + 1).fill(Infinity);
    for (let i = n - 1; i >= 0; i--) suffixMin[i] = Math.min(suffixMin[i + 1], times[i]);
    let prefixMax = -Infinity;
    let closedGops = true;
    for (let i = 0; i < n; i++) {
      if (isKey[i] && (prefixMax >= times[i] - 1e-6 || suffixMin[i] < times[i] - 1e-6)) closedGops = false;
      prefixMax = Math.max(prefixMax, times[i]);
    }

    const sorted = [...times].sort((a, b) => a - b);
    const diffs: number[] = [];
    for (let i = 1; i < sorted.length; i++) diffs.push(sorted[i] - sorted[i - 1]);
    const frameDuration = median(diffs);
    if (!(frameDuration > 0)) return null;
    const frameRate = snapFrameRate(1 / frameDuration);
    const grid = 1 / frameRate;
    const firstPts = sorted[0];
    // Constant frame rate: every pts is an integer number of frames after the first.
    const constantFrameRate = sorted.every((time) => {
      const k = (time - firstPts) / grid;
      return Math.abs(k - Math.round(k)) < 0.02;
    }) && new Set(sorted.map((time) => Math.round((time - firstPts) / grid))).size === sorted.length;

    const keyframeTimes = times.filter((_, i) => isKey[i]).sort((a, b) => a - b);
    if (keyframeTimes.length === 0) return null;
    return {
      mediaId,
      codec,
      width: track.codedWidth,
      height: track.codedHeight,
      frameRate,
      firstPts,
      endTime: sorted[sorted.length - 1] + grid,
      keyframeTimes,
      closedGops,
      constantFrameRate,
      nalLengthSize: params?.nalLengthSize ?? 4,
      ...profileAndLevel(codec, description),
      rotation: track.rotation,
      color: {
        matrix: colorSpace.matrix,
        transfer: colorSpace.transfer,
        primaries: colorSpace.primaries,
        fullRange: colorSpace.fullRange,
      },
    };
  } finally {
    input.dispose();
  }
}
