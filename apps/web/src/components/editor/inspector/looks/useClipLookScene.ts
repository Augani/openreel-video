import { useMemo } from "react";
import { useProjectStore } from "../../../../stores/project-store";
import type { ColorGradingSettings } from "../../../../bridges/effects-bridge";
import { clipEffectsForPreview, type PreviewClipEffect } from "./look-defs";

export interface ClipLookScene {
  /** The clip's grade today (runtime LUT tables). */
  grading: ColorGradingSettings;
  /** The clip's enabled effects, in render order. */
  effects: PreviewClipEffect[];
}

const NONE: ClipLookScene = { grading: {}, effects: [] };

/**
 * What a look card is applied on top of: the clip's own effects and grade. Cards render these under (or, for
 * the part the look replaces, instead of) their own change, so each shows what applying will produce on this clip.
 */
export function useClipLookScene(clipId: string | undefined): ClipLookScene {
  const modifiedAt = useProjectStore((s) => s.project.modifiedAt);
  const getColorGrading = useProjectStore((s) => s.getColorGrading);
  const getClip = useProjectStore((s) => s.getClip);
  return useMemo(() => {
    if (!clipId) return NONE;
    return {
      grading: getColorGrading(clipId),
      effects: clipEffectsForPreview(getClip(clipId)?.effects as Array<{ type: string; enabled?: boolean; params: Record<string, unknown> }> | undefined),
    };
    // modifiedAt: the store mutates clips in place of new references for some edits; it ticks on every project change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, getColorGrading, getClip, modifiedAt]);
}
