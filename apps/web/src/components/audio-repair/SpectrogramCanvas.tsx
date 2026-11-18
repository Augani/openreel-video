import { memo, useEffect, useRef } from "react";
import type { Spectrogram } from "@openreel/core";

const MIN_HZ = 30;
const GUIDES = [100, 1000, 10000];

/** 256-entry dark-to-hot colour table (blue-black, violet, orange, white). */
const PALETTE: Uint8ClampedArray = (() => {
  const stops: Array<[number, number, number, number]> = [
    [0, 8, 10, 24],
    [0.3, 52, 36, 120],
    [0.55, 170, 52, 120],
    [0.8, 244, 150, 40],
    [1, 255, 248, 214],
  ];
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k += 1;
    const [t0, r0, g0, b0] = stops[k];
    const [t1, r1, g1, b1] = stops[k + 1];
    const f = (t - t0) / (t1 - t0);
    out[i * 3] = r0 + (r1 - r0) * f;
    out[i * 3 + 1] = g0 + (g1 - g0) * f;
    out[i * 3 + 2] = b0 + (b1 - b0) * f;
  }
  return out;
})();

interface SpectrogramCanvasProps {
  spectrogram: Spectrogram | null;
  height?: number;
  label: string;
}

/**
 * Read-only spectrogram: time on x, frequency on a log scale (30 Hz to
 * Nyquist) on y, level as colour over a 90 dB range. Hum shows as steady
 * horizontal lines, clicks as vertical stripes, sibilance as bright bursts at
 * the top.
 */
export const SpectrogramCanvas = memo(function SpectrogramCanvas({ spectrogram, height = 132, label }: SpectrogramCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(40, Math.floor(canvas.clientWidth));
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!spectrogram) return;
      const { frames, bins, data, sampleRate } = spectrogram;
      const w = canvas.width;
      const h = canvas.height;
      const image = ctx.createImageData(w, h);
      const nyquist = sampleRate / 2;
      const span = Math.log(nyquist / MIN_HZ);
      // Row -> bin lookup (top row = Nyquist).
      const rowBin = new Int32Array(h);
      for (let y = 0; y < h; y += 1) {
        const f = MIN_HZ * Math.exp(span * (1 - y / (h - 1)));
        rowBin[y] = Math.max(0, Math.min(bins - 1, Math.round((f / nyquist) * bins)));
      }
      for (let x = 0; x < w; x += 1) {
        const frame = Math.min(frames - 1, Math.floor((x / w) * frames));
        for (let y = 0; y < h; y += 1) {
          const v = data[frame * bins + rowBin[y]];
          const o = (y * w + x) * 4;
          image.data[o] = PALETTE[v * 3];
          image.data[o + 1] = PALETTE[v * 3 + 1];
          image.data[o + 2] = PALETTE[v * 3 + 2];
          image.data[o + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      ctx.font = `${9 * dpr}px ui-monospace, monospace`;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = dpr;
      for (const hz of GUIDES) {
        if (hz >= nyquist) continue;
        const y = (1 - Math.log(hz / MIN_HZ) / span) * (h - 1);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}`, 3 * dpr, y - 2 * dpr);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [spectrogram, height]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      data-testid="spectrogram"
      data-ready={spectrogram ? "true" : "false"}
      className="block w-full rounded border border-border bg-bg-1"
      style={{ height }}
    />
  );
});
