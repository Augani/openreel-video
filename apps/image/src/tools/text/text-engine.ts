export type TextAlignment = 'left' | 'center' | 'right' | 'justify';
export type TextBaseline = 'top' | 'middle' | 'bottom' | 'alphabetic';
export type TextDirection = 'ltr' | 'rtl';
export type TextDecoration = 'none' | 'underline' | 'strikethrough' | 'both';
export type TextCase = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  color: string;
  opacity: number;
  letterSpacing: number;
  lineHeight: number;
  textAlign: TextAlignment;
  textBaseline: TextBaseline;
  textDecoration: TextDecoration;
  textCase: TextCase;
  textDirection: TextDirection;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  backgroundColor: string;
  backgroundPadding: number;
}

export interface TextRun {
  text: string;
  style: Partial<TextStyle>;
  startIndex: number;
  endIndex: number;
}

export interface TextParagraph {
  text: string;
  runs: TextRun[];
  alignment: TextAlignment;
  indent: number;
  spaceBefore: number;
  spaceAfter: number;
}

export interface TextDocument {
  paragraphs: TextParagraph[];
  defaultStyle: TextStyle;
  boundingBox: { width: number; height: number } | null;
  wrapMode: 'none' | 'word' | 'character';
}

export interface TextMetrics {
  width: number;
  height: number;
  lines: LineMetrics[];
  actualBoundingBox: { left: number; right: number; top: number; bottom: number };
}

export interface LineMetrics {
  text: string;
  width: number;
  height: number;
  baseline: number;
  runs: Array<{ text: string; style: TextStyle; x: number; width: number }>;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 24,
  fontWeight: 400,
  fontStyle: 'normal',
  color: '#000000',
  opacity: 1,
  letterSpacing: 0,
  lineHeight: 1.4,
  textAlign: 'left',
  textBaseline: 'alphabetic',
  textDecoration: 'none',
  textCase: 'none',
  textDirection: 'ltr',
  strokeColor: 'transparent',
  strokeWidth: 0,
  shadowColor: 'transparent',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  backgroundColor: 'transparent',
  backgroundPadding: 0,
};

export const FONT_WEIGHTS: Record<string, number> = {
  thin: 100,
  extraLight: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semiBold: 600,
  bold: 700,
  extraBold: 800,
  black: 900,
};

function applyTextCase(text: string, textCase: TextCase): string {
  switch (textCase) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/\b\w/g, (char) => char.toUpperCase());
    default:
      return text;
  }
}

function buildFontString(style: TextStyle): string {
  const fontStyle = style.fontStyle !== 'normal' ? style.fontStyle : '';
  const fontWeight = style.fontWeight !== 400 ? style.fontWeight.toString() : '';
  const fontSize = `${style.fontSize}px`;
  const fontFamily = style.fontFamily;

  return [fontStyle, fontWeight, fontSize, fontFamily].filter(Boolean).join(' ');
}

function mergeStyles(base: TextStyle, override: Partial<TextStyle>): TextStyle {
  return { ...base, ...override };
}

export function measureText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  style: TextStyle
): { width: number; height: number; ascent: number; descent: number } {
  ctx.font = buildFontString(style);
  ctx.textBaseline = style.textBaseline;

  const metrics = ctx.measureText(applyTextCase(text, style.textCase));
  const width = metrics.width + text.length * style.letterSpacing;
  const height = style.fontSize * style.lineHeight;
  const ascent = metrics.actualBoundingBoxAscent || style.fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || style.fontSize * 0.2;

  return { width, height, ascent, descent };
}

function wrapText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  maxWidth: number,
  wrapMode: 'none' | 'word' | 'character'
): string[] {
  if (wrapMode === 'none' || maxWidth <= 0) {
    return [text];
  }

  const lines: string[] = [];
  ctx.font = buildFontString(style);

  if (wrapMode === 'character') {
    let currentLine = '';
    for (const char of text) {
      const testLine = currentLine + char;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  const words = text.split(/(\s+)/);
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine + word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine.trim().length > 0) {
      lines.push(currentLine.trim());
      currentLine = word.trimStart();
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.length > 0 ? lines : [''];
}

export function layoutText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  document: TextDocument
): TextMetrics {
  const lines: LineMetrics[] = [];
  let maxWidth = 0;
  let totalHeight = 0;
  const boundingWidth = document.boundingBox?.width || Infinity;

  for (const paragraph of document.paragraphs) {
    totalHeight += paragraph.spaceBefore;
    const paragraphStyle = mergeStyles(document.defaultStyle, {});

    const wrappedLines = wrapText(ctx, paragraph.text, paragraphStyle, boundingWidth, document.wrapMode);

    for (const lineText of wrappedLines) {
      const lineRuns: Array<{ text: string; style: TextStyle; x: number; width: number }> = [];
      let lineWidth = paragraph.indent;
      let lineHeight = 0;
      let lineBaseline = 0;

      let charIndex = 0;
      const paragraphOffset = document.paragraphs.slice(0, document.paragraphs.indexOf(paragraph))
        .reduce((acc, p) => acc + p.text.length + 1, 0);

      for (let i = 0; i < lineText.length; ) {
        const globalIndex = paragraphOffset + charIndex;
        const applicableRun = paragraph.runs.find(
          (run) => globalIndex >= run.startIndex && globalIndex < run.endIndex
        );
        const runStyle = mergeStyles(
          document.defaultStyle,
          applicableRun?.style || {}
        );

        let runEnd = lineText.length;
        if (applicableRun) {
          const runLocalEnd = applicableRun.endIndex - paragraphOffset;
          runEnd = Math.min(runEnd, runLocalEnd - (charIndex - i));
        }

        const runText = lineText.slice(i, runEnd);
        const measurement = measureText(ctx, runText, runStyle);

        lineRuns.push({
          text: runText,
          style: runStyle,
          x: lineWidth,
          width: measurement.width,
        });

        lineWidth += measurement.width;
        lineHeight = Math.max(lineHeight, measurement.height);
        lineBaseline = Math.max(lineBaseline, measurement.ascent);

        charIndex += runText.length;
        i = runEnd;
      }

      let offsetX = 0;
      if (paragraph.alignment === 'center') {
        offsetX = (boundingWidth - lineWidth) / 2;
      } else if (paragraph.alignment === 'right') {
        offsetX = boundingWidth - lineWidth;
      }

      for (const run of lineRuns) {
        run.x += offsetX;
      }

      lines.push({
        text: lineText,
        width: lineWidth,
        height: lineHeight,
        baseline: lineBaseline,
        runs: lineRuns,
      });

      maxWidth = Math.max(maxWidth, lineWidth);
      totalHeight += lineHeight;
    }

    totalHeight += paragraph.spaceAfter;
  }

  return {
    width: maxWidth,
    height: totalHeight,
    lines,
    actualBoundingBox: {
      left: 0,
      right: maxWidth,
      top: 0,
      bottom: totalHeight,
    },
  };
}

export function renderText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  document: TextDocument,
  x: number,
  y: number
): void {
  const layout = layoutText(ctx, document);
  let currentY = y;

  ctx.save();

  for (const line of layout.lines) {
    for (const run of line.runs) {
      const style = run.style;
      const displayText = applyTextCase(run.text, style.textCase);
      const drawX = x + run.x;
      const drawY = currentY + line.baseline;

      ctx.font = buildFontString(style);
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = style.opacity;
      ctx.direction = style.textDirection;

      if (style.backgroundColor !== 'transparent') {
        const padding = style.backgroundPadding;
        ctx.fillStyle = style.backgroundColor;
        ctx.fillRect(
          drawX - padding,
          currentY - padding,
          run.width + padding * 2,
          line.height + padding * 2
        );
      }

      if (style.shadowColor !== 'transparent' && style.shadowBlur > 0) {
        ctx.shadowColor = style.shadowColor;
        ctx.shadowBlur = style.shadowBlur;
        ctx.shadowOffsetX = style.shadowOffsetX;
        ctx.shadowOffsetY = style.shadowOffsetY;
      }

      if (style.strokeWidth > 0 && style.strokeColor !== 'transparent') {
        ctx.strokeStyle = style.strokeColor;
        ctx.lineWidth = style.strokeWidth;
        ctx.lineJoin = 'round';

        if (style.letterSpacing !== 0) {
          let charX = drawX;
          for (const char of displayText) {
            ctx.strokeText(char, charX, drawY);
            charX += ctx.measureText(char).width + style.letterSpacing;
          }
        } else {
          ctx.strokeText(displayText, drawX, drawY);
        }
      }

      ctx.fillStyle = style.color;
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      if (style.letterSpacing !== 0) {
        let charX = drawX;
        for (const char of displayText) {
          ctx.fillText(char, charX, drawY);
          charX += ctx.measureText(char).width + style.letterSpacing;
        }
      } else {
        ctx.fillText(displayText, drawX, drawY);
      }

      if (style.textDecoration !== 'none') {
        ctx.strokeStyle = style.color;
        ctx.lineWidth = Math.max(1, style.fontSize / 16);

        if (style.textDecoration === 'underline' || style.textDecoration === 'both') {
          const underlineY = drawY + style.fontSize * 0.15;
          ctx.beginPath();
          ctx.moveTo(drawX, underlineY);
          ctx.lineTo(drawX + run.width, underlineY);
          ctx.stroke();
        }

        if (style.textDecoration === 'strikethrough' || style.textDecoration === 'both') {
          const strikeY = drawY - style.fontSize * 0.3;
          ctx.beginPath();
          ctx.moveTo(drawX, strikeY);
          ctx.lineTo(drawX + run.width, strikeY);
          ctx.stroke();
        }
      }
    }

    currentY += line.height;
  }

  ctx.restore();
}

export function createTextDocument(
  text: string,
  style?: Partial<TextStyle>,
  boundingBox?: { width: number; height: number }
): TextDocument {
  const paragraphs = text.split('\n').map((paragraphText) => ({
    text: paragraphText,
    runs: [],
    alignment: (style?.textAlign || 'left') as TextAlignment,
    indent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
  }));

  return {
    paragraphs,
    defaultStyle: { ...DEFAULT_TEXT_STYLE, ...style },
    boundingBox: boundingBox || null,
    wrapMode: boundingBox ? 'word' : 'none',
  };
}

export function textOnPath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  _path: Path2D,
  pathLength: number,
  startOffset: number = 0,
  spacing: number = 0
): void {
  ctx.save();
  ctx.font = buildFontString(style);
  ctx.fillStyle = style.color;
  ctx.globalAlpha = style.opacity;

  const chars = applyTextCase(text, style.textCase).split('');
  let currentOffset = startOffset;

  const canvas = ctx.canvas as HTMLCanvasElement;
  const tempCtx = canvas.getContext('2d');
  if (!tempCtx) {
    ctx.restore();
    return;
  }

  const step = 0.5;
  const pathPoints: Array<{ x: number; y: number; angle: number }> = [];

  for (let t = 0; t <= pathLength; t += step) {
    const fraction = t / pathLength;
    pathPoints.push({
      x: fraction * canvas.width,
      y: canvas.height / 2,
      angle: 0,
    });
  }

  for (const char of chars) {
    const charWidth = ctx.measureText(char).width + style.letterSpacing + spacing;

    if (currentOffset >= pathLength) break;

    const pointIndex = Math.min(
      Math.floor((currentOffset / pathLength) * pathPoints.length),
      pathPoints.length - 1
    );
    const point = pathPoints[pointIndex];

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle);
    ctx.fillText(char, 0, 0);
    ctx.restore();

    currentOffset += charWidth;
  }

  ctx.restore();
}
