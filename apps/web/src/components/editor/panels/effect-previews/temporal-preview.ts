import { PRO_EFFECT_DEFAULTS, planEcho, posterizeTime, resolveEcho, type ResolvedEcho } from "@openreel/core";

/**
 * Echo and Posterize Time choose which frames of the clip are shown, so their cards walk the footage window
 * (real frames of the selected clip) instead of filtering one frame. The frame choice is the very math the
 * renderer uses (planEcho / posterizeTime); only the time scale is compensated for the card, like grain's boost:
 * at the real defaults (a 33 ms echo, 8 fps) the frames of a 2 s hover window are too close to tell apart.
 */

/** Window frames between the echoes of an Echo card (at 12 fps: a sixth of a second). */
export const ECHO_CARD_STRIDE = 2;
/** Window frames each held frame of a Posterize Time card lasts (12 fps held at 4 fps). */
export const POSTERIZE_CARD_HOLD = 3;

export const isTemporalCard = (type: string): boolean => type === "echo" || type === "posterize-time";

export interface TemporalWindow {
  readonly count: number;
  readonly fps: number;
  readonly posterIndex: number;
}

export interface TemporalCardPlan {
  /** Window frame shown as the current frame. */
  readonly frameIndex: number;
  /** Echo cards: the window frames drawn behind it, in compositing order, with their opacity. */
  readonly trail: readonly { readonly index: number; readonly weight: number }[];
  /** Echo cards: the resolved parameters (the user-facing defaults with the card-scale echo time). */
  readonly echo: ResolvedEcho | null;
}

const clampIndex = (index: number, count: number): number => Math.min(Math.max(index, 0), Math.max(count - 1, 0));

/**
 * `index` is the hover frame of the window, or a negative value for the poster. A poster rests a few frames into
 * the window so an Echo card has footage behind it to show; hover then plays from the window's first frame, where
 * the trail builds up exactly as it does at the start of a clip.
 */
export function planTemporalCard(
  type: string,
  params: Record<string, unknown> | undefined,
  window: TemporalWindow,
  index: number,
): TemporalCardPlan {
  const poster = index < 0;
  if (type === "posterize-time") {
    const at = poster ? window.posterIndex : index;
    const held = posterizeTime(at / window.fps, window.fps / POSTERIZE_CARD_HOLD);
    return { frameIndex: clampIndex(Math.round(held * window.fps), window.count), trail: [], echo: null };
  }
  const echo = resolveEcho({
    ...PRO_EFFECT_DEFAULTS.echo,
    ...(params ?? {}),
    echoTime: ECHO_CARD_STRIDE / window.fps,
  });
  const lead = echo.echoes * ECHO_CARD_STRIDE;
  const current = clampIndex(poster ? Math.max(window.posterIndex, lead) : index, window.count);
  const samples = planEcho(current / window.fps, window.count / window.fps, echo);
  return {
    frameIndex: current,
    trail: samples.map((sample) => ({ index: clampIndex(Math.round(sample.localTime * window.fps), window.count), weight: sample.weight })),
    echo,
  };
}
