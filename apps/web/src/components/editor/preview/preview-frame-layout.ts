interface PreviewSize {
  width: number;
  height: number;
}

/** Scrollbars belong to zoomed content, not to the unzoomed fit calculation. */
export function previewViewportSize(element: HTMLElement, content: PreviewSize): PreviewSize {
  const style = getComputedStyle(element);
  const borderX = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
  const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  return {
    width: content.width + Math.max(0, element.offsetWidth - element.clientWidth - borderX),
    height: content.height + Math.max(0, element.offsetHeight - element.clientHeight - borderY),
  };
}

export function previewFrameSize(viewport: PreviewSize, canvas: PreviewSize, zoom: number, phone: boolean): PreviewSize {
  if (viewport.width <= 0 || viewport.height <= 0) return { width: 0, height: 0 };
  const aspectRatio = canvas.width / canvas.height;
  let width = Math.max(1, viewport.width);
  let height = width / aspectRatio;
  // The authored phone viewport rounds to whole CSS pixels. Its frame may
  // retain a subpixel remainder that the phone stage deliberately clips.
  if ((phone ? Math.round(height) : height) > viewport.height) {
    height = Math.max(1, viewport.height);
    width = height * aspectRatio;
  }
  return { width: width * zoom, height: height * zoom };
}
