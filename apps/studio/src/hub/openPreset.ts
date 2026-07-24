import { getBehavior, registerAllBehaviors } from "../effect/behaviors/registry";
import type { SubjectKind } from "../effect/scene";

registerAllBehaviors();

export type PresetOpenIntent =
  | {
      view: "effect";
      initial: { subjectKind: SubjectKind; behaviorId: string; behaviorParams: Record<string, unknown> };
    }
  | {
      view: "filter";
      initial: { behaviorId: string; behaviorParams: Record<string, unknown> };
    };

export function resolvePreset(presetId: string): PresetOpenIntent | null {
  const def = getBehavior(presetId);
  if (!def || def.kind !== "preset") return null;
  const subjectKind = def.acceptsSubjects[0];
  if (subjectKind === "full_frame") {
    return {
      view: "filter",
      initial: { behaviorId: presetId, behaviorParams: { ...(def.defaultParams as Record<string, unknown>) } },
    };
  }
  return {
    view: "effect",
    initial: {
      subjectKind,
      behaviorId: presetId,
      behaviorParams: { ...(def.defaultParams as Record<string, unknown>) },
    },
  };
}
