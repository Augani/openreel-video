import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  color: z.string().default("#88FFEE"),
  pulse: z.number().min(0).max(2).default(0.6),
  thickness: z.number().min(0).max(1).default(0.5),
  softness: z.number().min(0).max(1).default(0.5),
});
export type AuraGlowParams = z.infer<typeof Params>;

export const AURA_GLOW: BehaviorDef<AuraGlowParams> = {
  id: "preset.aura-glow.v1",
  kind: "preset",
  label: "Aura Glow",
  iconName: "sparkle",
  acceptsSubjects: ["subject_silhouette"],
  paramSchema: Params,
  defaultParams: { color: "#88FFEE", pulse: 0.6, thickness: 0.5, softness: 0.5 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const edge = ctx.uniqueId("aura-edge");
    const blur = ctx.uniqueId("aura-blur");
    const tint = ctx.uniqueId("aura-tint");
    const pulse = ctx.uniqueId("aura-pulse");
    const compose = ctx.uniqueId("aura-comp");
    return {
      nodes: [
        { id: edge, type: "MaskEdge", config: { width: params.thickness * 10 } },
        { id: blur, type: "GaussianBlur", config: { radius: 8 + params.softness * 32 } },
        { id: tint, type: "ColorTint", config: { color: params.color, strength: 1 } },
        { id: pulse, type: "PulseModulator", config: { speed: params.pulse } },
        { id: compose, type: "Blend", config: { mode: "additive" } },
      ],
      edges: [
        { fromNode: edge, fromPort: "out", toNode: blur, toPort: "in" },
        { fromNode: blur, fromPort: "out", toNode: tint, toPort: "in" },
        { fromNode: tint, fromPort: "out", toNode: pulse, toPort: "in" },
        { fromNode: pulse, fromPort: "out", toNode: compose, toPort: "b" },
      ],
      inputPorts: [{ node: compose, port: "a" }],
      outputPort: { node: compose, port: "out" },
      detectionInputs: [{ node: edge, port: "in", require: "subject_mask" }],
    };
  },
};
