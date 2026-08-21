import type { Clip, Effect, Transform } from "../types/timeline";
import { evaluateKeyframesAt } from "../animation/evaluate-keyframes";

export function animateTransform(clip: Clip, localTime: number): Transform {
  const base = clip.transform;
  if (!clip.keyframes?.length) return base;
  const v = evaluateKeyframesAt(clip.keyframes, localTime);
  const num = (p: string, fallback: number) => {
    if (v.has(p)) return v.get(p) as number;
    const bare = p.startsWith("transform.") ? p.slice("transform.".length) : p;
    if (bare !== p && v.has(bare)) return v.get(bare) as number;
    return fallback;
  };
  return {
    position: { x: num("transform.position.x", base.position.x), y: num("transform.position.y", base.position.y) },
    scale: { x: num("transform.scale.x", base.scale.x), y: num("transform.scale.y", base.scale.y) },
    rotation: num("transform.rotation", base.rotation),
    opacity: num("transform.opacity", base.opacity),
    anchor: { x: num("transform.anchor.x", base.anchor.x), y: num("transform.anchor.y", base.anchor.y) },
    borderRadius: (v.has("transform.borderRadius") || v.has("borderRadius"))
      ? num("transform.borderRadius", base.borderRadius ?? 0)
      : base.borderRadius,
    fitMode: base.fitMode,
    rotate3d: base.rotate3d,
    perspective: base.perspective,
    transformStyle: base.transformStyle,
    crop: base.crop
      ? {
          x: num("transform.crop.x", base.crop.x),
          y: num("transform.crop.y", base.crop.y),
          width: num("transform.crop.width", base.crop.width),
          height: num("transform.crop.height", base.crop.height),
        }
      : base.crop,
  };
}

const LEGACY_EFFECT_PARAM: Record<string, string> = {
  brightness: "value", contrast: "value", saturation: "value", blur: "radius",
};

export function animateEffects(clip: Clip, localTime: number): Effect[] {
  const base = clip.effects || [];
  if (!clip.keyframes?.length) return base;
  const v = evaluateKeyframesAt(clip.keyframes, localTime);
  const byId = new Map<string, Record<string, number>>();
  const byType = new Map<string, { paramKey: string; value: number }>();
  for (const [property, value] of v) {
    if (!property.startsWith("effect.")) continue;
    const parts = property.split(".");
    if (parts.length >= 3) {
      const effectId = parts[1];
      const paramKey = parts.slice(2).join(".");
      const m = byId.get(effectId) ?? {};
      m[paramKey] = value;
      byId.set(effectId, m);
    } else if (parts.length === 2) {
      const type = parts[1];
      byType.set(type, { paramKey: LEGACY_EFFECT_PARAM[type] ?? "value", value });
    }
  }
  if (byId.size === 0 && byType.size === 0) return base;
  const seenType = new Set<string>();
  const patched = base.map((effect) => {
    let params = effect.params;
    if (byId.has(effect.id)) params = { ...params, ...byId.get(effect.id) };
    const legacy = byType.get(effect.type);
    if (legacy) { params = { ...params, [legacy.paramKey]: legacy.value }; seenType.add(effect.type); }
    return params === effect.params ? effect : { ...effect, params };
  });
  for (const [type, { paramKey, value }] of byType) {
    if (seenType.has(type)) continue;
    patched.push({ id: `kf-synth-${clip.id}-${type}`, type, enabled: true, params: { [paramKey]: value } } as Effect);
  }
  return patched;
}
