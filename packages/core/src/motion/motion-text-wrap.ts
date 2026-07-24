export type MotionTextMeasure = (text: string) => number;

export function wrapMotionTextLines(
  text: string,
  maxWidth: number,
  measure: MotionTextMeasure,
): string[] {
  const explicitLines = text.split("\n");
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    return explicitLines;
  }

  const wrapped: string[] = [];
  for (const explicitLine of explicitLines) {
    wrapped.push(...wrapSingleLine(explicitLine, maxWidth, measure));
  }
  return wrapped;
}

function wrapSingleLine(
  line: string,
  maxWidth: number,
  measure: MotionTextMeasure,
): string[] {
  if (line.length === 0) {
    return [""];
  }

  const words = line.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measure(candidate) <= maxWidth || current.length === 0) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }

  if (current.length > 0 || lines.length === 0) {
    lines.push(current);
  }
  return lines;
}
