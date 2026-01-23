const createSvgCursor = (svg: string, hotspotX: number, hotspotY: number): string => {
  const encoded = encodeURIComponent(svg);
  return `url("data:image/svg+xml,${encoded}") ${hotspotX} ${hotspotY}, crosshair`;
};

const brushSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></g></svg>`;

const eraserSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></g></svg>`;

const bucketSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h12"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/></g></svg>`;

const gradientSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></g></svg>`;

const stampSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="M5 22h14"/><path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/></g></svg>`;

const healingSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="M18 11h-4a1 1 0 0 0-1 1v.5c0 .3.1.5.2.7l2.3 2.3c.2.2.5.4.8.4H18c1.1 0 2-.9 2-2v-1c0-1.1-.9-2-2-2z"/><path d="M6 13h4a1 1 0 0 1 1 1v.5c0 .3-.1.5-.2.7l-2.3 2.3c-.2.2-.5.4-.8.4H6c-1.1 0-2-.9-2-2v-1c0-1.1.9-2 2-2z"/><path d="M12 2v4"/><path d="M12 18v4"/><circle cx="12" cy="12" r="2"/></g></svg>`;

const spotHealSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></g></svg>`;

const dodgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></g></svg>`;

const burnSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></g></svg>`;

const spongeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></g></svg>`;

const blurSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><circle cx="12" cy="12" r="10" opacity="0.3"/><circle cx="12" cy="12" r="6" opacity="0.6"/><circle cx="12" cy="12" r="2"/></g></svg>`;

const sharpenSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><polygon points="12 2 19 21 12 17 5 21 12 2"/></g></svg>`;

const smudgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></g></svg>`;

const eyedropperSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></g></svg>`;

const wandSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></g></svg>`;

const lassoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="M7 22a5 5 0 0 1-2-4"/><path d="M7 16.93c.96.43 1.96.74 2.99.91"/><path d="M3.34 14A6.8 6.8 0 0 1 2 10c0-4.42 4.48-8 10-8s10 3.58 10 8a7.19 7.19 0 0 1-.33 2"/><path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M14.33 22h-.09a.35.35 0 0 1-.24-.32v-10a.34.34 0 0 1 .33-.34c.08 0 .15.03.21.08l7.34 6a.33.33 0 0 1-.21.59h-4.49l-2.57 3.85a.35.35 0 0 1-.28.14z"/></g></svg>`;

const cropSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></g></svg>`;

const moveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="M12 2v20M2 12h20M5 5l2 2M5 19l2-2M19 5l-2 2M19 19l-2-2"/></g></svg>`;

const warpSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></g></svg>`;

const perspectiveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="M4 4l4 16h8l4-16z"/><path d="M6 8h12"/><path d="M7 12h10"/><path d="M8 16h8"/></g></svg>`;

const liquifySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></g></svg>`;

const penSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/></g></svg>`;

const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></g></svg>`;

const shapeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><rect width="14" height="14" x="5" y="5" rx="2"/></g></svg>`;

const zoomInSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></g></svg>`;

const marqueeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 2"/></g></svg>`;

const ellipseMarqueeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="white" flood-opacity="1"/></filter><g filter="url(#s)"><ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="4 2"/></g></svg>`;

export const toolCursors: Record<string, string> = {
  'select': 'default',
  'hand': 'grab',
  'hand-grabbing': 'grabbing',
  'zoom': createSvgCursor(zoomInSvg, 11, 11),
  'eyedropper': createSvgCursor(eyedropperSvg, 1, 22),
  'text': createSvgCursor(textSvg, 12, 14),
  'pen': createSvgCursor(penSvg, 2, 22),
  'shape': createSvgCursor(shapeSvg, 12, 12),
  'crop': createSvgCursor(cropSvg, 6, 6),
  'marquee-rect': createSvgCursor(marqueeSvg, 12, 12),
  'marquee-ellipse': createSvgCursor(ellipseMarqueeSvg, 12, 12),
  'lasso': createSvgCursor(lassoSvg, 5, 18),
  'lasso-polygon': createSvgCursor(lassoSvg, 5, 18),
  'magic-wand': createSvgCursor(wandSvg, 5, 5),
  'brush': createSvgCursor(brushSvg, 4, 20),
  'eraser': createSvgCursor(eraserSvg, 4, 20),
  'paint-bucket': createSvgCursor(bucketSvg, 14, 20),
  'gradient': createSvgCursor(gradientSvg, 12, 12),
  'clone-stamp': createSvgCursor(stampSvg, 12, 18),
  'healing-brush': createSvgCursor(healingSvg, 12, 12),
  'spot-healing': createSvgCursor(spotHealSvg, 12, 12),
  'dodge': createSvgCursor(dodgeSvg, 12, 12),
  'burn': createSvgCursor(burnSvg, 12, 12),
  'sponge': createSvgCursor(spongeSvg, 12, 20),
  'blur': createSvgCursor(blurSvg, 12, 12),
  'sharpen': createSvgCursor(sharpenSvg, 12, 4),
  'smudge': createSvgCursor(smudgeSvg, 8, 2),
  'free-transform': createSvgCursor(moveSvg, 12, 12),
  'warp': createSvgCursor(warpSvg, 12, 12),
  'perspective': createSvgCursor(perspectiveSvg, 12, 12),
  'liquify': createSvgCursor(liquifySvg, 12, 12),
};

export const getToolCursor = (tool: string, isDragging?: boolean, dragMode?: string): string => {
  if (tool === 'hand') {
    return isDragging && dragMode === 'pan' ? 'grabbing' : 'grab';
  }

  if (isDragging && dragMode === 'paint') {
    return toolCursors[tool] || 'crosshair';
  }

  return toolCursors[tool] || 'crosshair';
};
