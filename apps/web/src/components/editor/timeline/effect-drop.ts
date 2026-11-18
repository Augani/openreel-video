import type { VideoEffectType } from "../../../bridges/effects-bridge";

export interface EditorEffectDropPayload {
  readonly effectType: VideoEffectType | "lut" | "stabilize";
  readonly effectParams?: Record<string, unknown>;
}

export function serializeEditorEffectDropPayload(
  payload: EditorEffectDropPayload,
): string {
  return JSON.stringify(payload);
}

export function parseEditorEffectDropPayload(
  customPayload: string | null,
  plainText: string,
): EditorEffectDropPayload | null {
  if (customPayload) {
    try {
      const parsed = JSON.parse(
        customPayload,
      ) as Partial<EditorEffectDropPayload>;
      if (typeof parsed.effectType === "string") {
        return {
          effectType:
            parsed.effectType as EditorEffectDropPayload["effectType"],
          effectParams:
            parsed.effectParams && typeof parsed.effectParams === "object"
              ? parsed.effectParams
              : undefined,
        };
      }
    } catch {
      // Fall through to the plain-text compatibility payload.
    }
  }
  if (!plainText.startsWith("effect:")) return null;
  return {
    effectType: plainText.slice(7) as EditorEffectDropPayload["effectType"],
  };
}
