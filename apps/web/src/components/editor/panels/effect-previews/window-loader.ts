import { createMediaImageBitmap, type MediaItem } from "@openreel/core";
import type { PreviewWindow, PreviewWindowOrigin, WindowLoader } from "./preview-engine";
import {
  buildWindowTimes,
  posterFrameIndex,
  previewSourceKey,
  PREVIEW_FPS,
  type PreviewPartner,
  type PreviewSource,
} from "./source-selection";

/** Card preview resolution before devicePixelRatio. */
export const PREVIEW_BASE_WIDTH = 192;
export const PREVIEW_BASE_HEIGHT = 108;

export interface PreviewSize {
  readonly width: number;
  readonly height: number;
}

/** 192x108 at the device pixel ratio, capped at 2x so a 3x phone-class display does not triple the memory. */
export function previewSizeForDevice(pixelRatio: number, widen = 1): PreviewSize {
  const scale = Math.min(2, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1)) * widen;
  return { width: Math.round(PREVIEW_BASE_WIDTH * scale), height: Math.round(PREVIEW_BASE_HEIGHT * scale) };
}

const SAMPLE_SCENE_URL = `${import.meta.env.BASE_URL ?? "/"}effect-previews/sample-scene.jpg`;
/** The sample scene is a wide panorama; the window slides across it so hover has motion. */
const SAMPLE_VISIBLE_FRACTION = 2 / 3;
const SAMPLE_PAN_SECONDS = 2;

type FrameDeferred = { promise: Promise<ImageBitmap | null>; resolve: (bitmap: ImageBitmap | null) => void };

const deferred = (): FrameDeferred => {
  let resolve!: (bitmap: ImageBitmap | null) => void;
  const promise = new Promise<ImageBitmap | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/**
 * Where a transition card's incoming shot comes from. `first` is the frame the poster blends towards (cheap, one
 * decode); `rest` streams the following frames of the incoming window once a hover asks for them, so the incoming
 * shot moves while the card plays instead of freezing on its first frame.
 */
export interface PartnerFeed {
  first(): Promise<ImageBitmap | null>;
  rest?(
    count: number,
    fps: number,
    put: (index: number, bitmap: ImageBitmap) => void,
    stopped: () => boolean,
  ): Promise<void>;
}

const NO_PARTNER: PartnerFeed = { first: () => Promise.resolve(null) };

/** A window whose frames are produced one by one by `fill`; `frame(i)` resolves as soon as frame i exists. */
export class ProgressiveWindow implements PreviewWindow {
  readonly count: number;
  readonly animated: boolean;
  private readonly slots: FrameDeferred[];
  private readonly bitmaps: ImageBitmap[] = [];
  private partnerPromise: Promise<ImageBitmap | null> | null = null;
  private partnerSlots: FrameDeferred[] | null = null;
  private closed = false;

  constructor(
    readonly key: string,
    readonly origin: PreviewWindowOrigin,
    readonly times: readonly number[],
    readonly fps: number,
    readonly width: number,
    readonly height: number,
    readonly posterIndex: number,
    private readonly partnerFeed: PartnerFeed = NO_PARTNER,
  ) {
    this.count = times.length;
    this.animated = times.length > 1;
    this.slots = times.map(deferred);
  }

  frame(index: number): Promise<ImageBitmap | null> {
    const slot = this.slots[Math.min(Math.max(index, 0), this.count - 1)];
    return slot.promise;
  }

  partner(index = 0): Promise<ImageBitmap | null> {
    const first = this.firstPartner();
    const feed = this.partnerFeed;
    if (index <= 0 || !feed.rest || this.count <= 1) return first;
    if (!this.partnerSlots) {
      const slots = this.times.map(deferred);
      this.partnerSlots = slots;
      void first.then(async (head) => {
        let last = head;
        slots[0].resolve(head);
        try {
          await feed.rest?.(
            this.count,
            this.fps,
            (at, bitmap) => {
              if (this.closed) {
                bitmap.close();
                return;
              }
              this.bitmaps.push(bitmap);
              last = bitmap;
              slots[at].resolve(bitmap);
            },
            () => this.closed,
          );
        } catch (error) {
          if (!this.closed) console.warn("[effect-previews] incoming frames failed:", error);
        }
        // Frames that never arrived repeat the last good one so the loop never has holes.
        for (const slot of slots) slot.resolve(this.closed ? null : last);
      });
    }
    return this.partnerSlots[Math.min(index, this.count - 1)].promise;
  }

  private firstPartner(): Promise<ImageBitmap | null> {
    this.partnerPromise ??= this.partnerFeed
      .first()
      .then((bitmap) => {
        if (!bitmap) return null;
        if (this.closed) {
          bitmap.close();
          return null;
        }
        this.bitmaps.push(bitmap);
        return bitmap;
      })
      .catch((error: unknown) => {
        console.warn("[effect-previews] incoming shot failed:", error);
        return null;
      });
    return this.partnerPromise;
  }

  /** Stores a decoded frame; the window now owns (and later closes) the bitmap. */
  put(index: number, bitmap: ImageBitmap): void {
    if (this.closed) {
      bitmap.close();
      return;
    }
    this.bitmaps.push(bitmap);
    this.slots[index].resolve(bitmap);
  }

  /** Frames that never arrived resolve null (or the last good frame when `fallback` is given). */
  finish(fallback?: ImageBitmap | null): void {
    if (fallback) {
      if (this.closed) fallback.close();
      else this.bitmaps.push(fallback);
    }
    for (const slot of this.slots) slot.resolve(this.closed ? null : (fallback ?? null));
  }

  dispose(): void {
    this.closed = true;
    this.finish(null);
    for (const bitmap of this.bitmaps.splice(0)) {
      try {
        bitmap.close();
      } catch {
        /* already closed */
      }
    }
  }
}

/** The largest size with the source's own aspect that fits inside `size` (never cropped). */
export function containSize(size: PreviewSize, sourceWidth: number, sourceHeight: number): PreviewSize {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return size;
  const scale = Math.min(size.width / sourceWidth, size.height / sourceHeight);
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

/** The whole source at its own aspect, scaled to fit inside `size`. */
function drawNatural(source: ImageBitmap, size: PreviewSize): Promise<ImageBitmap> {
  const target = containSize(size, source.width, source.height);
  const canvas = new OffscreenCanvas(target.width, target.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, target.width, target.height);
  return createImageBitmap(canvas);
}

function drawCover(
  source: ImageBitmap,
  sourceWidth: number,
  sourceHeight: number,
  size: PreviewSize,
  crop?: { x: number; width: number },
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const cropX = crop?.x ?? 0;
  const cropW = crop?.width ?? sourceWidth;
  const scale = Math.max(size.width / cropW, size.height / sourceHeight);
  const drawW = cropW * scale;
  const drawH = sourceHeight * scale;
  ctx.drawImage(
    source,
    cropX,
    0,
    cropW,
    sourceHeight,
    (size.width - drawW) / 2,
    (size.height - drawH) / 2,
    drawW,
    drawH,
  );
  return createImageBitmap(canvas);
}

let sampleBlob: Promise<Blob> | null = null;
const loadSampleBlob = (): Promise<Blob> => {
  sampleBlob ??= fetch(SAMPLE_SCENE_URL).then((response) => {
    if (!response.ok) throw new Error(`sample scene ${response.status}`);
    return response.blob();
  });
  sampleBlob.catch(() => {
    sampleBlob = null;
  });
  return sampleBlob;
};

/**
 * The sample scene as an incoming shot. `rightmost` crops the far third of the panorama, disjoint from the
 * window the sample pans through at rest, so the sample card's own transitions still go between two scenes.
 */
async function loadSamplePartner(size: PreviewSize, rightmost: boolean): Promise<ImageBitmap> {
  const image = await createImageBitmap(await loadSampleBlob());
  try {
    if (!rightmost) return await drawCover(image, image.width, image.height, size);
    const width = image.width / 3;
    return await drawCover(image, image.width, image.height, size, { x: image.width - width, width });
  } finally {
    image.close();
  }
}

async function loadSampleWindow(size: PreviewSize, signal: AbortSignal): Promise<PreviewWindow> {
  const image = await createImageBitmap(await loadSampleBlob());
  try {
    const times = Array.from({ length: Math.round(SAMPLE_PAN_SECONDS * PREVIEW_FPS) }, (_, i) => i / PREVIEW_FPS);
    const window = new ProgressiveWindow("sample", "sample", times, PREVIEW_FPS, size.width, size.height, 0, {
      first: () => loadSamplePartner(size, true),
    });
    const visible = image.width * SAMPLE_VISIBLE_FRACTION;
    const travel = image.width - visible;
    for (let index = 0; index < times.length; index++) {
      if (signal.aborted) break;
      const t = times.length > 1 ? index / (times.length - 1) : 0;
      // Ease in/out so the loop restart is not a hard cut.
      const eased = (1 - Math.cos(t * Math.PI)) / 2;
      window.put(index, await drawCover(image, image.width, image.height, size, { x: travel * eased, width: visible }));
    }
    window.finish();
    return window;
  } finally {
    image.close();
  }
}

async function loadStillWindow(
  blobOrBitmap: Blob | ImageBitmap,
  size: PreviewSize,
  key: string,
  origin: PreviewWindowOrigin,
  partnerFeed?: PartnerFeed,
  natural = false,
): Promise<PreviewWindow> {
  const bitmap = blobOrBitmap instanceof Blob ? await createImageBitmap(blobOrBitmap) : blobOrBitmap;
  try {
    const frameSize = natural ? containSize(size, bitmap.width, bitmap.height) : size;
    const window = new ProgressiveWindow(key, origin, [0], PREVIEW_FPS, frameSize.width, frameSize.height, 0, partnerFeed);
    window.put(0, natural ? await drawNatural(bitmap, size) : await drawCover(bitmap, bitmap.width, bitmap.height, size));
    return window;
  } finally {
    bitmap.close();
  }
}

export interface MediaLookup {
  (mediaId: string): MediaItem | undefined;
}

/**
 * Decodes the window once, at card resolution. Video goes through the same
 * WebCodecs path the export uses (mediabunny); media the browser cannot decode
 * (desktop native-only codecs, missing blobs) degrades to the media's own
 * thumbnail, still real footage. With no footage at all the bundled sample
 * scene pans across for hover.
 */
export interface WindowLoaderOptions {
  /**
   * Frames keep the footage's own aspect (scaled to fit inside the card size) instead of being cover-cropped to the
   * card. The Overlays cards use it: they lay the sequence frame out themselves, so a 16:9 clip in a 9:16 sequence
   * is the letterboxed picture the Program monitor shows, not a centre crop.
   */
  readonly natural?: boolean;
}

export function createWindowLoader(
  getMedia: MediaLookup,
  getSize: () => PreviewSize,
  options: WindowLoaderOptions = {},
): WindowLoader {
  const natural = options.natural === true;
  /**
   * The incoming shot: the next clip's first frame when the project has one (its following frames stream in on
   * hover), else the sample scene.
   */
  const partnerFeed = (partner: PreviewPartner | null | undefined, size: PreviewSize): PartnerFeed => {
    const item = partner ? getMedia(partner.mediaId) : undefined;
    const first = async (): Promise<ImageBitmap | null> => {
      try {
        if (partner && item) {
          if (item.type === "image" && item.blob) {
            const bitmap = await createMediaImageBitmap(item);
            try {
              return await drawCover(bitmap, bitmap.width, bitmap.height, size);
            } finally {
              bitmap.close();
            }
          }
          if (item.type === "video" && item.blob && !item.nativeSource) {
            const frame = await decodeVideoFrame(item.blob, partner.time, size);
            if (frame) return frame;
          }
          if (item.thumbnailUrl) {
            const blob = await (await fetch(item.thumbnailUrl)).blob();
            const bitmap = await createImageBitmap(blob);
            try {
              return await drawCover(bitmap, bitmap.width, bitmap.height, size);
            } finally {
              bitmap.close();
            }
          }
        }
      } catch (error) {
        console.warn("[effect-previews] next clip unavailable, using the sample scene:", error);
      }
      return loadSamplePartner(size, false);
    };
    const playable = partner && item && item.type === "video" && item.blob && !item.nativeSource && partner.seconds > 0;
    if (!playable) return { first };
    const blob = item.blob as Blob;
    return {
      first,
      rest: (count, fps, put, stopped) =>
        decodeVideoFrames(blob, partnerTimes(partner, count, fps), size, put, stopped),
    };
  };
  return {
    async load(source: PreviewSource | null, signal: AbortSignal): Promise<PreviewWindow> {
      const size = getSize();
      if (!source) return loadSampleWindow(size, signal);
      const media = getMedia(source.mediaId);
      const key = previewSourceKey(source);
      try {
        if (media?.type === "image" && media.blob) {
          return await loadStillWindow(await createMediaImageBitmap(media), size, key, "still", partnerFeed(source.partner, size), natural);
        }
        if (media?.type === "video" && media.blob && !media.nativeSource) {
          const window = await loadVideoWindow(media.blob, source, size, key, signal, partnerFeed(source.partner, size), natural);
          if (window) return window;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        console.warn("[effect-previews] footage window failed, using thumbnail:", error);
      }
      if (media?.thumbnailUrl) {
        try {
          const blob = await (await fetch(media.thumbnailUrl)).blob();
          return await loadStillWindow(blob, size, key, "still", partnerFeed(source.partner, size), natural);
        } catch {
          /* fall through to the sample scene */
        }
      }
      return loadSampleWindow(size, signal);
    },
  };
}

async function loadVideoWindow(
  blob: Blob,
  source: PreviewSource,
  size: PreviewSize,
  key: string,
  signal: AbortSignal,
  partnerFeed: PartnerFeed,
  natural = false,
): Promise<PreviewWindow | null> {
  const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode()) || signal.aborted) return null;
    const times = buildWindowTimes(source);
    // Natural frames keep the track's own (display) aspect; cover frames fill the card.
    const frameSize = natural ? containSize(size, track.displayWidth, track.displayHeight) : size;
    const window = new ProgressiveWindow(
      key,
      "footage",
      times,
      PREVIEW_FPS,
      frameSize.width,
      frameSize.height,
      posterFrameIndex(source, times),
      partnerFeed,
    );
    // Hand the window out as soon as it exists: frames land progressively and cards await frame(i).
    void (async () => {
      try {
        const sink = new CanvasSink(track, {
          width: frameSize.width,
          height: frameSize.height,
          fit: natural ? "fill" : "cover",
          poolSize: 2,
        });
        let index = 0;
        let last: ImageBitmap | null = null;
        for await (const wrapped of sink.canvasesAtTimestamps(times)) {
          if (signal.aborted) break;
          // A null frame (before the first timestamp) repeats the previous one so the loop never has holes.
          const bitmap: ImageBitmap | null = wrapped ? await createImageBitmap(wrapped.canvas) : null;
          if (bitmap) {
            window.put(index, bitmap);
            last = bitmap;
          } else if (last) {
            window.put(index, await createImageBitmap(last));
          }
          index++;
        }
        window.finish(last ? await createImageBitmap(last) : null);
      } catch (error) {
        if (!signal.aborted) console.warn("[effect-previews] frame decode failed:", error);
        window.finish(null);
      } finally {
        input[Symbol.dispose]?.();
      }
    })();
    return window;
  } catch (error) {
    input[Symbol.dispose]?.();
    throw error;
  }
}

/** One frame of a video at card resolution (the incoming shot of transition cards). Null when it cannot be decoded. */
async function decodeVideoFrame(blob: Blob, time: number, size: PreviewSize): Promise<ImageBitmap | null> {
  const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new CanvasSink(track, { width: size.width, height: size.height, fit: "cover", poolSize: 1 });
    const wrapped = await sink.getCanvas(time);
    return wrapped ? await createImageBitmap(wrapped.canvas) : null;
  } finally {
    input[Symbol.dispose]?.();
  }
}

/** Source times of the incoming clip's window frames: `fps` apart from its first frame, never past its out point. */
export function partnerTimes(partner: PreviewPartner, count: number, fps: number): number[] {
  const last = partner.time + Math.max(0, partner.seconds - 1e-3);
  return Array.from({ length: count }, (_, index) => Math.min(partner.time + index / fps, last));
}

/** Frames 1..n-1 of `times` at card resolution, handed to `put` as they decode (frame 0 is the poster's partner). */
async function decodeVideoFrames(
  blob: Blob,
  times: readonly number[],
  size: PreviewSize,
  put: (index: number, bitmap: ImageBitmap) => void,
  stopped: () => boolean,
): Promise<void> {
  const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return;
    const sink = new CanvasSink(track, { width: size.width, height: size.height, fit: "cover", poolSize: 2 });
    let index = 1;
    for await (const wrapped of sink.canvasesAtTimestamps(times.slice(1))) {
      if (stopped()) break;
      if (wrapped) put(index, await createImageBitmap(wrapped.canvas));
      index++;
    }
  } finally {
    input[Symbol.dispose]?.();
  }
}
