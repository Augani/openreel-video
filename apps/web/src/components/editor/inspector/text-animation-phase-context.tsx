import { createContext, useCallback, useContext } from "react";
import { resolveTextAnimationPhase, type TextAnimationParams, type TextAnimationPreset } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { updateTextAnimationPhase, type TextAnimationSide } from "../../../services/text-animation-phases";

const PhaseContext = createContext<TextAnimationSide>("entry");
export const TextAnimationPhaseProvider = PhaseContext.Provider;
/** The phase (entry / exit) the text animation inspector is editing. */
export const useTextAnimationSide = (): TextAnimationSide => useContext(PhaseContext);

/** Adapt the existing parameter forms to the selected phase without replacing the other phase. */
export function useTextAnimationPhaseActions() {
  const side = useContext(PhaseContext);
  const getClip = useProjectStore(state => state.getTextClip);
  const getTextClip = useCallback((id: string) => {
    const clip = getClip(id);
    return clip?.animation && side === "exit"
      ? { ...clip, animation: resolveTextAnimationPhase(clip.animation, false) }
      : clip;
  }, [getClip, side]);
  const applyTextAnimationPreset = useCallback((id: string, preset: TextAnimationPreset,
    inDuration = 0.5, outDuration = 0.5, params?: Partial<TextAnimationParams>) =>
    updateTextAnimationPhase(id, side, preset, inDuration, outDuration, params), [side]);
  return { getTextClip, applyTextAnimationPreset };
}
