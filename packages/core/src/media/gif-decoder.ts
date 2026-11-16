export interface GifFrameCache {
  frames: ImageBitmap[];
  delays: number[];
  totalDuration: number;
}

export async function createGifFrameCache(
  blob: Blob,
): Promise<GifFrameCache | null> {
  try {
    const img = await createImageBitmap(blob);
    const width = img.width;
    const height = img.height;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      img.close();
      return null;
    }

    ctx.drawImage(img, 0, 0);
    const frames = [img];
    const delays = [100];

    return {
      frames,
      delays,
      totalDuration: delays.reduce((sum, d) => sum + d, 0),
    };
  } catch {
    return null;
  }
}

export function getGifFrameAtTime(
  cache: GifFrameCache,
  timeMs: number,
): number {
  if (cache.frames.length <= 1) return 0;

  const loopedTime = timeMs % cache.totalDuration;
  let accumulated = 0;

  for (let i = 0; i < cache.delays.length; i++) {
    accumulated += cache.delays[i];
    if (loopedTime < accumulated) {
      return i;
    }
  }

  return cache.frames.length - 1;
}

export function isAnimatedGif(blob: Blob): boolean {
  return blob.type === "image/gif";
}
