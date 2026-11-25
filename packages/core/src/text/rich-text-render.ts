import { layoutRichText, type LaidLine, type LaidSegment, type RichLayout, type RunMeasurer } from "./rich-text-layout";
import {
  fillAnchorColor,
  normalizeStops,
  resolveBackgroundBox,
  resolveStrokes,
  type ResolvedRunStyle,
} from "./rich-text";
import type { TextFill, TextRun, TextStyle } from "./types";
import type { CharacterAnimationState as CharacterState } from "./text-animation";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const SMALL_CAPS_SCALE = 0.8;
const NO_LIGATURE_TRACKING = "0.001px";

/** A drawable piece of a segment: plain text, small-cap lowercase, or tabular figures. */
interface Chunk { readonly text: string; readonly scale: number; readonly upper: boolean; readonly tabular: boolean }

const nativeSmallCaps = (ctx: Ctx): boolean => "fontVariantCaps" in ctx;

function chunkSegment(text: string, style: ResolvedRunStyle, ctx: Ctx): Chunk[] {
  const synthCaps = style.smallCaps && !nativeSmallCaps(ctx);
  const chunks: Chunk[] = [];
  for (const character of Array.from(text)) {
    const tabular = style.tabularFigures && /[0-9]/.test(character);
    const lower = synthCaps && character !== character.toUpperCase();
    const last = chunks[chunks.length - 1];
    if (last && last.tabular === tabular && (last.upper === lower) && !tabular) {
      chunks[chunks.length - 1] = { ...last, text: last.text + character };
    } else if (last && tabular && last.tabular) {
      chunks[chunks.length - 1] = { ...last, text: last.text + character };
    } else chunks.push({ text: character, scale: lower ? SMALL_CAPS_SCALE : 1, upper: lower, tabular });
  }
  return chunks;
}

function fontFor(style: ResolvedRunStyle, scale = 1): string {
  const weight = typeof style.fontWeight === "number" ? String(style.fontWeight) : style.fontWeight;
  return `${style.fontStyle} ${weight} ${style.fontSize * scale}px "${style.fontFamily}"`;
}

/** Set every canvas text property a run controls; `font` first because it resets the others. */
function applyRunFont(ctx: Ctx, style: ResolvedRunStyle, scale = 1): void {
  ctx.font = fontFor(style, scale);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const spacing = !style.ligatures && style.letterSpacing === 0 ? NO_LIGATURE_TRACKING : `${style.letterSpacing}px`;
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D).letterSpacing = spacing;
  if ("fontVariantCaps" in ctx) (ctx as CanvasRenderingContext2D).fontVariantCaps = style.smallCaps ? "small-caps" : "normal";
}

function tabularAdvance(ctx: Ctx): number {
  let max = 0;
  for (let digit = 0; digit <= 9; digit++) max = Math.max(max, ctx.measureText(String(digit)).width);
  return max;
}

function chunkText(chunk: Chunk): string {
  return chunk.upper ? chunk.text.toUpperCase() : chunk.text;
}

function chunkWidth(ctx: Ctx, chunk: Chunk, style: ResolvedRunStyle): number {
  applyRunFont(ctx, style, chunk.scale);
  // The advance is measured with the run tracking already applied.
  if (chunk.tabular) return tabularAdvance(ctx) * Array.from(chunk.text).length;
  return ctx.measureText(chunkText(chunk)).width;
}

/** Measurer backed by a canvas context, honouring small caps and tabular figures. */
export function createCanvasMeasurer(ctx: Ctx): RunMeasurer {
  return (text, style) => {
    let width = 0;
    for (const chunk of chunkSegment(text, style, ctx)) width += chunkWidth(ctx, chunk, style);
    applyRunFont(ctx, style);
    const sample = ctx.measureText("Mg") as TextMetrics;
    const ascent = sample.fontBoundingBoxAscent ?? style.fontSize * 0.8;
    const descent = sample.fontBoundingBoxDescent ?? style.fontSize * 0.2;
    return { width, ascent, descent };
  };
}

export function layoutRichTextOnCanvas(
  ctx: Ctx,
  runs: readonly TextRun[],
  style: TextStyle,
  maxWidth?: number,
): RichLayout {
  return layoutRichText(runs, style, createCanvasMeasurer(ctx), maxWidth);
}

export interface BlockBounds { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }

/** Left edge of a line in block space: lines align around x = 0. */
export function lineStartX(line: LaidLine, align: TextStyle["textAlign"]): number {
  return align === "center" ? -line.width / 2 : align === "right" ? -line.width : 0;
}

/** Top of the block in local space. Matches the plain renderer's vertical anchoring. */
export function blockTop(layout: RichLayout, vAlign: TextStyle["verticalAlign"]): number {
  const first = layout.lines[0]?.height ?? 0;
  if (vAlign === "top") return -first / 2;
  if (vAlign === "bottom") return -layout.height - first / 2;
  return -layout.height / 2;
}

export function blockBounds(layout: RichLayout, style: TextStyle): BlockBounds {
  let left = Infinity;
  let right = -Infinity;
  for (const line of layout.lines) {
    const x = lineStartX(line, style.textAlign);
    left = Math.min(left, x);
    right = Math.max(right, x + line.width);
  }
  if (!Number.isFinite(left)) { left = 0; right = 0; }
  const top = blockTop(layout, style.verticalAlign);
  return { left, right, top, bottom: top + layout.height };
}

/** Canvas paint for a fill over the text block. `origin` is the translation applied around a glyph. */
export function createFillPaint(
  ctx: Ctx,
  fill: TextFill,
  bounds: BlockBounds,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): string | CanvasGradient {
  if (fill.type === "solid") return fill.color;
  const stops = normalizeStops(fill.stops);
  if (stops.length === 0) return "#ffffff";
  const w = Math.max(1, bounds.right - bounds.left);
  const h = Math.max(1, bounds.bottom - bounds.top);
  const cx = (bounds.left + bounds.right) / 2 - origin.x;
  const cy = (bounds.top + bounds.bottom) / 2 - origin.y;
  let gradient: CanvasGradient;
  if (fill.type === "linear") {
    const angle = (fill.angle * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    gradient = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  } else {
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.hypot(w, h) / 2));
  }
  for (const stop of stops) gradient.addColorStop(stop.offset, stop.color);
  return gradient;
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  if (r === 0 || typeof ctx.arcTo !== "function") { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface RichDrawOptions {
  readonly layout: RichLayout;
  readonly style: TextStyle;
  readonly opacity: number;
  readonly characterStates?: readonly CharacterState[];
}

type Pass = { kind: "fill" } | { kind: "stroke"; color: string; width: number; join: CanvasLineJoin };

function setShadow(ctx: Ctx, style: TextStyle, on: boolean): void {
  if (on && style.shadowColor) {
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = style.shadowBlur ?? 0;
    ctx.shadowOffsetX = style.shadowOffsetX ?? 0;
    ctx.shadowOffsetY = style.shadowOffsetY ?? 0;
  } else {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
}

function drawUnderline(ctx: Ctx, seg: LaidSegment, x: number, baselineY: number, paint: string | CanvasGradient): void {
  const size = seg.style.fontSize;
  const thickness = Math.max(1, size * 0.06);
  ctx.fillStyle = paint;
  ctx.fillRect(x, baselineY + size * 0.12, seg.width, thickness);
}

/**
 * Paint the laid-out block: background box, then the shadowed first pass,
 * remaining strokes and fill, then strokes that sit over the fill. Both
 * preview and export run exactly this function.
 */
export function drawRichText(ctx: Ctx, options: RichDrawOptions): void {
  const { layout, style, opacity, characterStates } = options;
  const bounds = blockBounds(layout, style);
  const box = resolveBackgroundBox(style);
  const strokes = resolveStrokes(style);

  ctx.save();
  setShadow(ctx, style, false);
  if (box) {
    ctx.fillStyle = box.color;
    const legacy = !style.backgroundBox;
    // The legacy background is the block width plus 10px a side, spanning the lines; boxes add their padding to the same bounds.
    const w = bounds.right - bounds.left + box.paddingX * 2;
    const h = layout.height + box.paddingY * 2;
    const x = legacy ? -((bounds.right - bounds.left) / 2) - box.paddingX : bounds.left - box.paddingX;
    roundedRect(ctx, x, bounds.top - box.paddingY, w, h, box.radius);
    ctx.fill();
  }
  ctx.restore();

  const passes: Pass[] = [
    ...strokes.filter((s) => s.position !== "over").map((s): Pass => ({ kind: "stroke", color: s.color, width: s.width, join: s.join ?? "round" })),
    { kind: "fill" },
    ...strokes.filter((s) => s.position === "over").map((s): Pass => ({ kind: "stroke", color: s.color, width: s.width, join: s.join ?? "round" })),
  ];

  passes.forEach((pass, passIndex) => {
    const shadowHere = passIndex === 0;
    for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex++) {
      const line = layout.lines[lineIndex];
      const lineX = lineStartX(line, style.textAlign);
      const lineTop = bounds.top + line.top;
      for (const seg of line.segments) {
        const baselineY = lineTop + line.baseline - seg.style.baselineShift;
        drawSegment(ctx, seg, lineX + seg.x, baselineY, pass, { style, bounds, opacity, characterStates, shadow: shadowHere });
      }
    }
  });
}

function drawSegment(
  ctx: Ctx,
  seg: LaidSegment,
  x: number,
  baselineY: number,
  pass: Pass,
  env: { style: TextStyle; bounds: BlockBounds; opacity: number; characterStates?: readonly CharacterState[]; shadow: boolean },
): void {
  const { style, bounds, characterStates } = env;
  const paintFor = (origin: { x: number; y: number }) =>
    pass.kind === "fill" ? createFillPaint(ctx, seg.style.fill, bounds, origin) : pass.color;
  const strokeSetup = () => {
    if (pass.kind === "stroke") { ctx.lineWidth = pass.width; ctx.lineJoin = pass.join; }
  };

  if (characterStates && characterStates.length > 0) {
    // Per-character animation: advance each glyph by its measured prefix so kerning survives.
    const chars = Array.from(seg.text);
    const nativeUnits: number[] = [];
    let cursor = 0;
    for (const character of chars) { nativeUnits.push(seg.start + cursor); cursor += character.length; }
    let prefix = "";
    const measure = createCanvasMeasurer(ctx);
    chars.forEach((character, i) => {
      const state = characterStates[nativeUnits[i]];
      const start = measure(prefix, seg.style).width;
      const width = measure(prefix + character, seg.style).width - start;
      prefix += character;
      if (!state) return;
      const glyphChunks = chunkSegment(character, seg.style, ctx)[0];
      ctx.save();
      ctx.globalAlpha = env.opacity * state.opacity;
      const tx = x + start + state.offsetX + width / 2;
      const ty = baselineY + state.offsetY;
      ctx.translate(tx, ty);
      ctx.rotate((state.rotation * Math.PI) / 180);
      ctx.scale(state.scale, state.scale);
      applyRunFont(ctx, seg.style, glyphChunks?.scale ?? 1);
      setShadow(ctx, style, env.shadow);
      strokeSetup();
      const paint = paintFor({ x: tx, y: ty });
      const text = glyphChunks ? chunkText(glyphChunks) : character;
      if (pass.kind === "fill") { ctx.fillStyle = paint; ctx.fillText(text, -width / 2, 0); }
      else { ctx.strokeStyle = paint; ctx.strokeText(text, -width / 2, 0); }
      ctx.restore();
    });
    return;
  }

  const paint = paintFor({ x: 0, y: 0 });
  ctx.save();
  setShadow(ctx, style, env.shadow);
  strokeSetup();
  let cx = x;
  for (const chunk of chunkSegment(seg.text, seg.style, ctx)) {
    applyRunFont(ctx, seg.style, chunk.scale);
    const text = chunkText(chunk);
    if (chunk.tabular) {
      const cell = tabularAdvance(ctx);
      Array.from(text).forEach((digit, i) => {
        const glyph = ctx.measureText(digit).width;
        const gx = cx + i * cell + (cell - glyph) / 2;
        if (pass.kind === "fill") { ctx.fillStyle = paint; ctx.fillText(digit, gx, baselineY); }
        else { ctx.strokeStyle = paint; ctx.strokeText(digit, gx, baselineY); }
      });
    } else if (pass.kind === "fill") { ctx.fillStyle = paint; ctx.fillText(text, cx, baselineY); }
    else { ctx.strokeStyle = paint; ctx.strokeText(text, cx, baselineY); }
    cx += chunkWidth(ctx, chunk, seg.style);
  }
  ctx.restore();
  if (pass.kind === "fill" && (seg.style.underline)) {
    ctx.save();
    setShadow(ctx, style, false);
    drawUnderline(ctx, seg, x, baselineY, seg.style.fill.type === "solid" ? seg.style.fill.color : fillAnchorColor(seg.style.fill));
    ctx.restore();
  }
}
