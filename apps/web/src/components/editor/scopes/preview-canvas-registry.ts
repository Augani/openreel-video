/** Lets the Scopes panel read the program (preview) canvas without prop drilling. */
let previewCanvas: HTMLCanvasElement | null = null;

export function registerPreviewCanvas(canvas: HTMLCanvasElement | null): void {
  previewCanvas = canvas;
}

export function getPreviewCanvas(): HTMLCanvasElement | null {
  return previewCanvas;
}
