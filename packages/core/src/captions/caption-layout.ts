import type { CueSettings, Subtitle, SubtitleStyle } from "../types/timeline";

/**
 * One layout for burned-in captions, shared by the preview canvas and the
 * export renderer so both place, wrap and decorate a cue identically.
 * Position comes from the cue's WebVTT settings when present, otherwise from
 * `style.position`; `style.safeMargin` keeps the box inside the safe area.
 */

export interface CaptionLayoutLine {
  readonly text: string;
  /** Left edge of the line's text, canvas px. */
  readonly x: number;
  /** Vertical centre of the line, canvas px. */
  readonly y: number;
  readonly width: number;
}

export interface CaptionLayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CaptionLayout {
  readonly lines: CaptionLayoutLine[];
  /** One background box per line, padded. */
  readonly boxes: CaptionLayoutBox[];
  readonly fontSize: number;
  readonly lineHeight: number;
}

export const DEFAULT_CAPTION_FONT_SIZE = 24;

/** The caption look an imported cue starts from before a format overrides individual properties. */
export const DEFAULT_CAPTION_STYLE: SubtitleStyle = {
  fontFamily: "Inter",
  fontSize: DEFAULT_CAPTION_FONT_SIZE,
  color: "#ffffff",
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  position: "bottom",
};

const GENERIC_CSS_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

/** CSS font shorthand for a caption. Generic families must not be quoted or the browser treats them as a missing font name (serif fallback). */
export function captionFont(fontSize: number, fontFamily: string | undefined): string {
  const family = (fontFamily || "Inter").trim();
  const css = GENERIC_CSS_FAMILIES.has(family.toLowerCase()) ? family.toLowerCase() : `"${family}"`;
  return `bold ${fontSize}px ${css}, sans-serif`;
}
const LINE_HEIGHT_RATIO = 1.3;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function wrapCaptionLines(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const paragraph = raw.trim();
    if (!paragraph) continue;
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

type Align = "left" | "center" | "right";

function resolveAlign(cue: CueSettings | undefined): Align {
  switch (cue?.align) {
    case "start":
    case "left":
      return "left";
    case "end":
    case "right":
      return "right";
    default:
      return "center";
  }
}

export function layoutCaption(
  subtitle: Pick<Subtitle, "text" | "style" | "cueSettings">,
  canvasWidth: number,
  canvasHeight: number,
  measure: (text: string) => number,
  textOverride?: string,
): CaptionLayout {
  const style: Partial<SubtitleStyle> = subtitle.style ?? {};
  const cue = subtitle.cueSettings;
  const fontSize = style.fontSize || DEFAULT_CAPTION_FONT_SIZE;
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const padX = style.boxPaddingX ?? 10;
  const padY = style.boxPaddingY ?? 0;
  const safe = style.safeMargin === undefined ? undefined : clamp(style.safeMargin, 0, 0.25);
  const marginX = safe === undefined ? 0 : safe * canvasWidth;
  const marginY = safe === undefined ? fontSize * 2 : safe * canvasHeight;

  const sizePct = cue?.size === undefined ? 100 : clamp(cue.size, 1, 100);
  const availableWidth = canvasWidth - 2 * marginX;
  const maxWidth = Math.max(fontSize, (availableWidth * sizePct) / 100 - 2 * padX);
  const lineTexts = wrapCaptionLines(textOverride ?? subtitle.text, maxWidth, measure);
  const lineWidths = lineTexts.map(measure);
  const rowHeight = lineHeight + 2 * padY;
  const totalHeight = lineTexts.length * rowHeight;

  // Horizontal: the cue box is `size`% of the frame wide, anchored by position.
  const align = resolveAlign(cue);
  const boxWidth = (availableWidth * sizePct) / 100;
  const position = cue?.position ?? (align === "left" ? 0 : align === "right" ? 100 : 50);
  const positionAlign =
    cue?.positionAlign ?? (align === "left" ? "line-left" : align === "right" ? "line-right" : "center");
  const anchorX = marginX + (availableWidth * clamp(position, 0, 100)) / 100;
  const boxLeft =
    positionAlign === "line-left" ? anchorX : positionAlign === "line-right" ? anchorX - boxWidth : anchorX - boxWidth / 2;
  const clampedLeft = clamp(boxLeft, marginX, Math.max(marginX, canvasWidth - marginX - boxWidth));

  // Vertical: top of the text block.
  let top: number;
  if (cue?.line !== undefined) {
    const lineAlign = cue.lineAlign ?? "start";
    const alignShift = lineAlign === "center" ? totalHeight / 2 : lineAlign === "end" ? totalHeight : 0;
    if (cue.snapToLines === false) {
      top = (canvasHeight * cue.line) / 100 - alignShift;
    } else if (cue.line >= 0) {
      top = marginY + cue.line * rowHeight - alignShift;
    } else {
      top = canvasHeight - marginY + (cue.line + 1) * rowHeight - totalHeight - alignShift;
    }
  } else {
    const where = style.position ?? "bottom";
    top =
      where === "top"
        ? marginY
        : where === "center"
          ? (canvasHeight - totalHeight) / 2
          : canvasHeight - marginY - totalHeight;
  }
  top = clamp(top, 0, Math.max(0, canvasHeight - totalHeight));

  const lines: CaptionLayoutLine[] = [];
  const boxes: CaptionLayoutBox[] = [];
  lineTexts.forEach((text, i) => {
    const width = lineWidths[i];
    const x =
      align === "left"
        ? clampedLeft + padX
        : align === "right"
          ? clampedLeft + boxWidth - padX - width
          : clampedLeft + boxWidth / 2 - width / 2;
    const rowTop = top + i * rowHeight;
    lines.push({ text, x, y: rowTop + rowHeight / 2, width });
    boxes.push({ x: x - padX, y: rowTop, width: width + 2 * padX, height: rowHeight });
  });
  return { lines, boxes, fontSize, lineHeight };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function fillCaptionBox(ctx: Ctx2D, box: CaptionLayoutBox, style: Partial<SubtitleStyle>): void {
  const color = style.backgroundColor ?? "rgba(0, 0, 0, 0.7)";
  if (!color || color === "transparent") return;
  ctx.fillStyle = color;
  const radius = style.boxRadius ?? 0;
  if (radius > 0 && "roundRect" in ctx) {
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.width, box.height, radius);
    ctx.fill();
  } else {
    ctx.fillRect(box.x, box.y, box.width, box.height);
  }
}

/** Stroke then fill, with the style's shadow. Caller sets font/textAlign/baseline. */
export function drawCaptionText(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  style: Partial<SubtitleStyle>,
): void {
  ctx.save();
  if (style.shadowColor) {
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = style.shadowBlur ?? 0;
    ctx.shadowOffsetX = style.shadowOffsetX ?? 0;
    ctx.shadowOffsetY = style.shadowOffsetY ?? 0;
  }
  if (style.strokeColor && (style.strokeWidth ?? 0) > 0) {
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWidth as number;
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Draw a whole cue (export path). */
export function drawCaption(ctx: Ctx2D, subtitle: Subtitle, canvasWidth: number, canvasHeight: number): void {
  if (!subtitle.text || subtitle.text.trim().length === 0) return;
  const style: Partial<SubtitleStyle> = subtitle.style ?? {};
  const fontSize = style.fontSize || DEFAULT_CAPTION_FONT_SIZE;
  ctx.save();
  ctx.font = captionFont(fontSize, style.fontFamily);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const layout = layoutCaption(subtitle, canvasWidth, canvasHeight, (t) => ctx.measureText(t).width);
  layout.boxes.forEach((box) => fillCaptionBox(ctx, box, style));
  layout.lines.forEach((line) => drawCaptionText(ctx, line.text, line.x, line.y, style.color || "#ffffff", style));
  ctx.restore();
}
