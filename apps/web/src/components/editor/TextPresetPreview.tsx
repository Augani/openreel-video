import { memo, useEffect, useRef } from "react";
import { TitleEngine, type TextStyle } from "@openreel/core";
import { drawCover, usePlayheadBackdrop, type DrawableFrame } from "./playhead-backdrop";

const W = 320;
const H = 180;
/** Preview type is sized relative to the 1080-line frame, enlarged so a 110px card stays legible. */
const TITLE_ENLARGE = 2.4;
const FIT_WIDTH = 0.8;

export interface PreviewHighlight {
  /** Index of the word drawn in `color` on top of the line, as the caption word-highlight does. */
  readonly word: number;
  readonly color: string;
}

export interface PreviewLine {
  readonly text: string;
  readonly style: Partial<TextStyle>;
  /** Normalised anchor of the line inside the frame. */
  readonly x: number;
  readonly y: number;
  /** Left-aligned lines anchor their left edge at x (lower thirds); centred lines anchor their centre. */
  readonly align?: "left" | "center";
  /** Multiplier on the frame-relative size (lower-third lines are drawn larger than their 1080p size). */
  readonly boost?: number;
  readonly highlight?: PreviewHighlight;
}

let engine: TitleEngine | null = null;
const sharedEngine = (): TitleEngine => (engine ??= new TitleEngine());

async function ensureFont(style: Partial<TextStyle>): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load || !style.fontFamily) return;
  try {
    await document.fonts.load(`${style.fontWeight ?? 400} 32px "${style.fontFamily}"`);
  } catch {
    // The renderer falls back to the stack's next family.
  }
}

/** Scale-to-fit size for a preview line: never wider than the card, never taller than a third of it. */
export function fitPreviewStyle(
  measureWidth: (style: TextStyle) => number,
  style: TextStyle,
  boost: number,
  floor = 0,
): TextStyle {
  const base = ((style.fontSize * H) / 1080) * boost;
  let ratio = Math.min(Math.max(base, floor), H * 0.3) / style.fontSize;
  const scaled = (r: number): TextStyle => ({
    ...style,
    fontSize: style.fontSize * r,
    letterSpacing: style.letterSpacing * r,
    strokeWidth: (style.strokeWidth ?? 0) * r,
    shadowBlur: style.shadowBlur === undefined ? undefined : style.shadowBlur * r,
    shadowOffsetX: style.shadowOffsetX === undefined ? undefined : style.shadowOffsetX * r,
    shadowOffsetY: style.shadowOffsetY === undefined ? undefined : style.shadowOffsetY * r,
  });
  const width = measureWidth(scaled(ratio));
  if (width > W * FIT_WIDTH && width > 0) ratio *= (W * FIT_WIDTH) / width;
  return scaled(ratio);
}

async function drawPreview(canvas: HTMLCanvasElement, lines: readonly PreviewLine[], backdrop: DrawableFrame | null, isLive: () => boolean): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await Promise.all(lines.map((line) => ensureFont(line.style)));
  if (!isLive()) return;
  canvas.width = W;
  canvas.height = H;
  if (backdrop) {
    drawCover(ctx, backdrop, W, H);
    ctx.fillStyle = "rgba(8,9,11,0.38)";
    ctx.fillRect(0, 0, W, H);
  } else {
    const fill = ctx.createLinearGradient(0, 0, W, H);
    fill.addColorStop(0, "#20232a");
    fill.addColorStop(1, "#111317");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, W, H);
  }
  const titles = sharedEngine();
  for (const line of lines) {
    const clip = titles.createTextClip({
      trackId: "preview",
      startTime: 0,
      duration: 5,
      text: line.text,
      style: { ...line.style, textAlign: line.align === "left" ? "left" : "center", verticalAlign: "middle" },
    });
    const style = fitPreviewStyle(
      (candidate) => titles.measureText(line.text, candidate).width,
      clip.style,
      line.boost ?? TITLE_ENLARGE,
      line.boost === undefined ? H * 0.14 : 0,
    );
    const measured = titles.measureText(line.text, style).width;
    const x = line.align === "left" ? line.x + measured / 2 / W : line.x;
    const layer = titles.renderText(
      { ...clip, style: { ...style, textAlign: "center" }, transform: { ...clip.transform, position: { x, y: line.y } } },
      W,
      H,
      0.5,
    );
    ctx.drawImage(layer.canvas as HTMLCanvasElement, 0, 0);
    if (line.highlight) {
      const words = line.text.split(" ");
      const index = Math.min(Math.max(0, line.highlight.word), words.length - 1);
      const lead = index === 0 ? 0 : titles.measureText(`${words.slice(0, index).join(" ")} `, style).width;
      const word = words[index];
      const wordWidth = titles.measureText(word, style).width;
      const left = x * W - measured / 2;
      const overlay = titles.renderText(
        {
          ...clip,
          text: word,
          style: { ...style, textAlign: "center", color: line.highlight.color, backgroundColor: undefined, strokeWidth: 0, shadowBlur: 0 },
          transform: { ...clip.transform, position: { x: (left + lead + wordWidth / 2) / W, y: line.y } },
        },
        W,
        H,
        0.5,
      );
      ctx.drawImage(overlay.canvas as HTMLCanvasElement, 0, 0);
    }
  }
}

/** A title preset rendered by the real title engine over the footage under the playhead. */
export const TextPresetPreview = memo(function TextPresetPreview({ lines, className }: { lines: readonly PreviewLine[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const backdrop = usePlayheadBackdrop();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let live = true;
    void drawPreview(canvas, lines, backdrop, () => live).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [lines, backdrop]);
  return <canvas ref={ref} width={W} height={H} aria-hidden="true" className={className ?? "workspace-preset-canvas"} />;
});
