export interface GifFrame {
  imageData: ImageData;
  delay: number;
  disposalType: number;
}

export interface DecodedGif {
  width: number;
  height: number;
  frames: GifFrame[];
  totalDuration: number;
}

export interface GifFrameCache {
  frames: ImageBitmap[];
  delays: number[];
  totalDuration: number;
}

export async function decodeGif(blob: Blob): Promise<DecodedGif | null> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const dataView = new DataView(arrayBuffer);

    const signature = String.fromCharCode(
      dataView.getUint8(0),
      dataView.getUint8(1),
      dataView.getUint8(2),
    );
    if (signature !== "GIF") {
      return null;
    }

    const width = dataView.getUint16(6, true);
    const height = dataView.getUint16(8, true);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const frames: GifFrame[] = [];
    let offset = 13;
    const packedField = dataView.getUint8(10);
    const hasGlobalColorTable = (packedField & 0x80) !== 0;
    const globalColorTableSize = hasGlobalColorTable
      ? 3 * Math.pow(2, (packedField & 0x07) + 1)
      : 0;

    offset += globalColorTableSize;

    let frameDelay = 100;
    let disposalType = 0;

    while (offset < arrayBuffer.byteLength) {
      const blockType = dataView.getUint8(offset);
      offset++;

      if (blockType === 0x21) {
        const extensionType = dataView.getUint8(offset);
        offset++;

        if (extensionType === 0xf9) {
          offset++;
          const flags = dataView.getUint8(offset);
          disposalType = (flags >> 2) & 0x07;
          frameDelay = dataView.getUint16(offset + 1, true) * 10;
          if (frameDelay === 0) frameDelay = 100;
          offset += 5;
        } else {
          while (true) {
            const blockSize = dataView.getUint8(offset);
            offset++;
            if (blockSize === 0) break;
            offset += blockSize;
          }
        }
      } else if (blockType === 0x2c) {
        offset += 4;
        offset += 4;
        const packedByte = dataView.getUint8(offset + 8);
        offset += 9;

        const hasLocalColorTable = (packedByte & 0x80) !== 0;
        const localColorTableSize = hasLocalColorTable
          ? 3 * Math.pow(2, (packedByte & 0x07) + 1)
          : 0;

        if (hasLocalColorTable) {
          offset += localColorTableSize;
        }

        offset++;

        while (true) {
          const subBlockSize = dataView.getUint8(offset);
          offset++;
          if (subBlockSize === 0) break;
          offset += subBlockSize;
        }

        const imageData = ctx.getImageData(0, 0, width, height);
        frames.push({
          imageData,
          delay: frameDelay,
          disposalType,
        });

        frameDelay = 100;
        disposalType = 0;
      } else if (blockType === 0x3b) {
        break;
      } else {
        break;
      }
    }

    if (frames.length === 0) {
      const img = await createImageBitmap(blob);
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, width, height);
      frames.push({
        imageData,
        delay: 100,
        disposalType: 0,
      });
      img.close();
    }

    const totalDuration = frames.reduce((sum, f) => sum + f.delay, 0);

    return { width, height, frames, totalDuration };
  } catch {
    return null;
  }
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
