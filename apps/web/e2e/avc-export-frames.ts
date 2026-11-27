import { expect, type Page } from "@playwright/test";
import { exportTo } from "./motion-track-flow";

type CaptureWindow = Window & {
  avcFrameCapture?: {
    images: Map<number, Uint8ClampedArray>;
    restore(): void;
  };
};

/**
 * Keep the frames actually submitted by the editor. Software AVC encoders quantize
 * detailed textures even at 12 Mbps. Comparing both sides of that encoder lets us
 * test the compositor at pixel precision and the delivered MP4 at codec precision.
 */
export async function exportWithFrameCapture(page: Page, outPath: string, frames: readonly number[], fps: number, width: number, height: number) {
  await page.evaluate(({ frames, fps, width, height }) => {
    const wanted = new Set(frames);
    const images = new Map<number, Uint8ClampedArray>();
    const original = VideoEncoder.prototype.encode;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    VideoEncoder.prototype.encode = function(frame, options) {
      const index = Math.round(frame.timestamp * fps / 1e6);
      if (frame.displayWidth === width && frame.displayHeight === height && wanted.has(index)) {
        ctx.drawImage(frame, 0, 0);
        images.set(index, ctx.getImageData(0, 0, width, height).data);
      }
      return original.call(this, frame, options);
    };
    (window as CaptureWindow).avcFrameCapture = { images, restore: () => { VideoEncoder.prototype.encode = original; } };
  }, { frames, fps, width, height });
  try {
    await exportTo(page, outPath);
  } finally {
    await page.evaluate(() => (window as CaptureWindow).avcFrameCapture?.restore());
  }
}

export async function checkedEncoderInput(page: Page, frame: number, decoded: Buffer): Promise<Buffer> {
  const base64 = await page.evaluate(index => {
    const capture = (window as CaptureWindow).avcFrameCapture;
    const rgba = capture?.images.get(index);
    if (!capture || !rgba) throw new Error(`No encoder input captured for frame ${index}`);
    capture.images.delete(index);
    const rgb = new Uint8Array(rgba.length / 4 * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) {
      rgb[j++] = rgba[i];
      rgb[j++] = rgba[i + 1];
      rgb[j++] = rgba[i + 2];
    }
    let binary = "";
    for (let i = 0; i < rgb.length; i += 32768) binary += String.fromCharCode(...rgb.subarray(i, i + 32768));
    return btoa(binary);
  }, frame);
  const input = Buffer.from(base64, "base64");
  expect(input.length).toBe(decoded.length);
  let squaredError = 0;
  for (let i = 0; i < decoded.length; i++) squaredError += (input[i] - decoded[i]) ** 2;
  const psnr = 10 * Math.log10(255 ** 2 / (squaredError / decoded.length));
  expect(psnr, `decoded AVC frame ${frame} vs submitted pixels (dB)`).toBeGreaterThan(30);
  return input;
}
