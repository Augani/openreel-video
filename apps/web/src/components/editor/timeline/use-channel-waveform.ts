import { useEffect, useState } from "react";
import { applyChannelMapToChannels, isIdentityChannelMap, resolveClipChannelMap, type Clip, type ClipChannelMap, type MediaItem } from "@openreel/core";

const PEAKS_PER_SECOND = 100;
const MAX_DECODE_BYTES = 200 * 1024 * 1024;
/** Peaks of a media file as the given channel map plays it; null while computing or when it cannot be decoded. */
const peaksCache = new Map<string, Float32Array | null>();
const pending = new Map<string, Promise<Float32Array | null>>();
const mapKey = (map: ClipChannelMap): string => `${map.format}:${map.sources.join(",")}`;

async function computeMappedPeaks(blob: Blob, map: ClipChannelMap): Promise<Float32Array | null> {
  if (blob.size > MAX_DECODE_BYTES) return null;
  try {
    const context = new OfflineAudioContext(1, 1, 44100);
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const mapped = applyChannelMapToChannels(channels, map);
    const window = Math.max(1, Math.floor(buffer.sampleRate / PEAKS_PER_SECOND));
    const peaks = new Float32Array(Math.ceil(buffer.length / window));
    for (const data of mapped) {
      for (let i = 0; i < peaks.length; i++) {
        let peak = peaks[i];
        const end = Math.min(data.length, (i + 1) * window);
        for (let s = i * window; s < end; s++) {
          const value = Math.abs(data[s]);
          if (value > peak) peak = value;
        }
        peaks[i] = peak;
      }
    }
    return peaks;
  } catch {
    return null;
  }
}

/**
 * The waveform a timeline clip draws. Without an Audio Channels mapping this is the media's stored waveform; with
 * one it is recomputed from the mapped channels (left only draws only the left channel, a muted channel is flat),
 * so what you see matches what you hear.
 */
export function useChannelWaveform(clip: Pick<Clip, "id" | "channelMap" | "mediaId">, media: MediaItem | undefined, enabled: boolean): Float32Array | null | undefined {
  const map = media ? resolveClipChannelMap(clip, media) : undefined;
  const mapped = enabled && media?.blob && map && !isIdentityChannelMap(map, media.metadata.channels || 2) ? map : undefined;
  const key = mapped && media ? `${media.id}:${media.blob?.size ?? 0}:${mapKey(mapped)}` : null;
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key || !mapped || !media?.blob || peaksCache.has(key) || pending.has(key)) return;
    const job = computeMappedPeaks(media.blob, mapped).then((peaks) => { peaksCache.set(key, peaks); pending.delete(key); return peaks; });
    pending.set(key, job);
    let live = true;
    void job.then(() => { if (live) bump((n) => n + 1); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!key || !pending.has(key)) return;
    let live = true;
    void pending.get(key)!.then(() => { if (live) bump((n) => n + 1); });
    return () => { live = false; };
  }, [key]);
  if (!key) return media?.waveformData;
  return peaksCache.get(key) ?? media?.waveformData;
}
