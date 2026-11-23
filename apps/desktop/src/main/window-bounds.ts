export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_WINDOW_WIDTH = 1024;
export const MIN_WINDOW_HEIGHT = 700;

/**
 * The editor window opens filling the work area of the display it starts on (the screen minus the
 * menu bar and Dock or taskbar). It is an ordinary window, not macOS full screen, so it stays in the
 * current Space. The minimum size never exceeds a small screen's work area.
 */
export function initialWindowBounds(workArea: Rect): Rect & { minWidth: number; minHeight: number } {
  const width = Math.max(1, Math.floor(workArea.width));
  const height = Math.max(1, Math.floor(workArea.height));
  return {
    x: Math.floor(workArea.x),
    y: Math.floor(workArea.y),
    width,
    height,
    minWidth: Math.min(MIN_WINDOW_WIDTH, width),
    minHeight: Math.min(MIN_WINDOW_HEIGHT, height),
  };
}
