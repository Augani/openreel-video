/** The repeated clip decorations intersecting the viewport, with some lookahead. */
export const getVisibleRepeatRange = (
  clipLeft: number,
  clipWidth: number,
  scrollX: number,
  viewportWidth: number,
  count: number,
  overscan = 120,
): { start: number; end: number } => {
  if (clipWidth <= 0 || viewportWidth <= 0 || count <= 0) {
    return { start: 0, end: 0 };
  }
  const localStart = Math.max(0, scrollX - overscan - clipLeft);
  const localEnd = Math.min(clipWidth, scrollX + viewportWidth + overscan - clipLeft);
  if (localEnd <= localStart) return { start: 0, end: 0 };

  const segmentWidth = clipWidth / count;
  return {
    start: Math.max(0, Math.floor(localStart / segmentWidth)),
    end: Math.min(count, Math.ceil(localEnd / segmentWidth)),
  };
};
