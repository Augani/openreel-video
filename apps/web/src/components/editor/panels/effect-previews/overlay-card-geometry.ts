// Kept free of engine imports: the Overlays tab (editor chunk) sizes its cards with this.

/** Narrowest (5:8) and widest (16:9) card aspect: a vertical project gets a tall card, never taller than 1.6x its width. */
export const OVERLAY_CARD_MIN_ASPECT = 5 / 8;
export const OVERLAY_CARD_MAX_ASPECT = 16 / 9;

/** Aspect (width / height) of the overlay card for a sequence: the sequence's own, kept within 5:8 .. 16:9. */
export function overlayCardAspect(sequence: { width: number; height: number }): number {
  const aspect = sequence.width / sequence.height;
  if (!(aspect > 0)) return OVERLAY_CARD_MAX_ASPECT;
  return Math.min(OVERLAY_CARD_MAX_ASPECT, Math.max(OVERLAY_CARD_MIN_ASPECT, aspect));
}
