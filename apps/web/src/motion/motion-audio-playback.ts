import type { MediaItem, MotionAudioClip } from "@openreel/core";
import { loadAudioBuffer } from "../utils/load-audio-buffer";

const EPSILON = 1e-4;

async function resolveAudioBlob(
  mediaId: string,
  mediaItems: readonly MediaItem[],
): Promise<Blob | null> {
  const item = mediaItems.find((candidate) => candidate.id === mediaId);
  if (!item) return null;
  if (item.blob) return item.blob;
  if (item.fileHandle) {
    try {
      return await item.fileHandle.getFile();
    } catch {
      return null;
    }
  }
  if (item.originalUrl) {
    try {
      const response = await fetch(item.originalUrl);
      return response.ok ? await response.blob() : null;
    } catch {
      return null;
    }
  }
  return null;
}

export class MotionAudioPlayback {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private rate = 1;
  private playGeneration = 0;
  private active: AudioBufferSourceNode[] = [];
  private bufferCache = new Map<string, Promise<AudioBuffer | null>>();

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    const context = new Ctor();
    const masterGain = context.createGain();
    masterGain.gain.value = this.muted ? 0 : 1;
    masterGain.connect(context.destination);
    this.context = context;
    this.masterGain = masterGain;
    return context;
  }

  async resume(): Promise<void> {
    const context = this.ensureContext();
    if (context && context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        /* autoplay policy may reject until a gesture */
      }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain) this.masterGain.gain.value = muted ? 0 : 1;
  }

  setRate(rate: number): void {
    this.rate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    for (const source of this.active) {
      try {
        source.playbackRate.value = this.rate;
      } catch {
        /* source may have ended */
      }
    }
  }

  private decode(
    mediaId: string,
    mediaItems: readonly MediaItem[],
  ): Promise<AudioBuffer | null> {
    const cached = this.bufferCache.get(mediaId);
    if (cached) return cached;
    const context = this.ensureContext();
    if (!context) return Promise.resolve(null);
    const promise = (async () => {
      const blob = await resolveAudioBlob(mediaId, mediaItems);
      if (!blob) return null;
      try {
        return await loadAudioBuffer(context, blob);
      } catch {
        return null;
      }
    })();
    this.bufferCache.set(mediaId, promise);
    return promise;
  }

  stop(): void {
    this.playGeneration += 1;
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.active = [];
  }

  async play(
    clips: readonly MotionAudioClip[],
    mediaItems: readonly MediaItem[],
    playhead: number,
    rate: number,
  ): Promise<void> {
    const context = this.ensureContext();
    const masterGain = this.masterGain;
    if (!context || !masterGain) return;
    this.rate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    this.stop();
    const generation = this.playGeneration;
    await this.resume();
    if (generation !== this.playGeneration) return;

    const audible = clips.filter((clip) => {
      if (clip.muted) return false;
      const mediaId = clip.mediaId ?? clip.assetId;
      if (!mediaId) return false;
      return clip.startTime + clip.duration > playhead + EPSILON;
    });
    if (audible.length === 0) return;

    const decoded = await Promise.all(
      audible.map(async (clip) => ({
        clip,
        buffer: await this.decode(
          (clip.mediaId ?? clip.assetId) as string,
          mediaItems,
        ),
      })),
    );
    if (generation !== this.playGeneration) return;

    const anchorCtxTime = context.currentTime;
    for (const { clip, buffer } of decoded) {
      if (!buffer) continue;
      const trimStart = clip.trimStart ?? 0;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = this.rate;
      const gain = context.createGain();
      gain.gain.value = clip.gain ?? 1;
      source.connect(gain);
      gain.connect(masterGain);

      const startOffset = (clip.startTime - playhead) / this.rate;
      if (startOffset > EPSILON) {
        const bufferDuration = Math.min(clip.duration, buffer.duration - trimStart);
        if (bufferDuration > EPSILON) {
          source.start(anchorCtxTime + startOffset, trimStart, bufferDuration);
          this.track(source);
          continue;
        }
      } else {
        const elapsed = playhead - clip.startTime;
        const sourceOffset = trimStart + elapsed;
        const bufferDuration = Math.min(
          clip.duration - elapsed,
          buffer.duration - sourceOffset,
        );
        if (bufferDuration > EPSILON && sourceOffset < buffer.duration) {
          source.start(anchorCtxTime, sourceOffset, bufferDuration);
          this.track(source);
          continue;
        }
      }
      source.disconnect();
      gain.disconnect();
    }
  }

  private track(source: AudioBufferSourceNode): void {
    this.active.push(source);
    source.onended = () => {
      const index = this.active.indexOf(source);
      if (index > -1) this.active.splice(index, 1);
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }

  clearCache(): void {
    this.bufferCache.clear();
  }

  dispose(): void {
    this.stop();
    this.bufferCache.clear();
    if (this.context) {
      try {
        void this.context.close();
      } catch {
        /* already closed */
      }
    }
    this.context = null;
    this.masterGain = null;
  }
}
