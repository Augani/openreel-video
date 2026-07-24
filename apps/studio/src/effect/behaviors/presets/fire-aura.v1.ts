import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  intensity: z.number().min(0).max(1).default(0.7),
  color: z.string().default("#FF7700"),
  flameHeight: z.number().min(0).max(1).default(0.6),
  heatDistortion: z.number().min(0).max(1).default(0.3),
  position: z.enum(["behind", "surround", "front"]).default("surround"),
});
export type FireAuraParams = z.infer<typeof Params>;

export const FIRE_AURA: BehaviorDef<FireAuraParams> = {
  id: "preset.fire-aura.v1",
  kind: "preset",
  label: "Fire Aura",
  iconName: "flame",
  acceptsSubjects: ["subject_silhouette"],
  paramSchema: Params,
  defaultParams: { intensity: 0.7, color: "#FF7700", flameHeight: 0.6, heatDistortion: 0.3, position: "surround" },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const edge = ctx.uniqueId("fire-edge");
    const emit = ctx.uniqueId("fire-emit");
    const field = ctx.uniqueId("fire-field");
    const clamp = ctx.uniqueId("fire-clamp");
    const render = ctx.uniqueId("fire-render");
    const glow = ctx.uniqueId("fire-glow");
    const layer = ctx.uniqueId("fire-layer");
    const flameTargetPort = params.position === "behind" ? "back" : "front";
    const upstreamTargetPort = params.position === "behind" ? "front" : "back";
    return {
      nodes: [
        { id: edge, type: "MaskEdgeEmitter", config: { width: 3, density: 200 } },
        { id: emit, type: "ParticleEmitter", config: { rate: 200 * params.intensity, lifetime: 1.2, velocity: [0, -200 * params.flameHeight], max: 2048 } },
        { id: field, type: "ParticleField", config: { gravity: [0, -50], turbulence: 0.35, wind: [8, -2] } },
        { id: clamp, type: "BudgetClamp" },
        { id: render, type: "ParticleRenderer", config: { sprite: "fire.png", blend: "additive", tint: params.color } },
        { id: glow, type: "GaussianBlur", config: { radius: 16 } },
        { id: layer, type: "Layer", config: { position: params.position, heatDistortion: params.heatDistortion } },
      ],
      edges: [
        { fromNode: edge, fromPort: "pts", toNode: emit, toPort: "spawn" },
        { fromNode: emit, fromPort: "state", toNode: field, toPort: "state" },
        { fromNode: field, fromPort: "state", toNode: clamp, toPort: "state" },
        { fromNode: clamp, fromPort: "out", toNode: render, toPort: "state" },
        { fromNode: render, fromPort: "tex", toNode: glow, toPort: "in" },
        { fromNode: glow, fromPort: "out", toNode: layer, toPort: flameTargetPort },
      ],
      inputPorts: [{ node: layer, port: upstreamTargetPort }],
      outputPort: { node: layer, port: "out" },
      detectionInputs: [
        { node: edge, port: "mask", require: "subject_mask" },
        { node: layer, port: "mask", require: "subject_mask" },
      ],
    };
  },
};
