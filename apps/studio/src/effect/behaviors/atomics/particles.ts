import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  source: z.enum(["edge", "landmark", "area"]).default("area"),
  sprite: z.string().default("sparkle.png"),
  rate: z.number().min(0).max(2000).default(120),
  gravity: z.number().min(-200).max(200).default(0),
  color: z.string().default("#FFFFFF"),
  lifetime: z.number().min(0.1).max(8).default(1.2),
});

export type ParticlesParams = z.infer<typeof Params>;

export const PARTICLES: BehaviorDef<ParticlesParams> = {
  id: "atomic.particles",
  kind: "atomic",
  atomicKind: "particles",
  label: "Particles",
  iconName: "sparkle",
  acceptsSubjects: ["face", "subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { source: "area", sprite: "sparkle.png", rate: 120, gravity: 0, color: "#FFFFFF", lifetime: 1.2 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const emit = ctx.uniqueId("part-emit");
    const field = ctx.uniqueId("part-field");
    const clamp = ctx.uniqueId("part-clamp");
    const render = ctx.uniqueId("part-render");
    const composite = ctx.uniqueId("part-comp");
    return {
      nodes: [
        { id: emit, type: "ParticleEmitter", config: { rate: params.rate, max: 2048, lifetime: params.lifetime, source: params.source } },
        { id: field, type: "ParticleField", config: { gravity: [0, params.gravity], turbulence: 0.1 } },
        { id: clamp, type: "BudgetClamp" },
        { id: render, type: "ParticleRenderer", config: { sprite: params.sprite, blend: "additive", tint: params.color } },
        { id: composite, type: "Blend", config: { mode: "additive" } },
      ],
      edges: [
        { fromNode: emit, fromPort: "state", toNode: field, toPort: "state" },
        { fromNode: field, fromPort: "state", toNode: clamp, toPort: "state" },
        { fromNode: clamp, fromPort: "out", toNode: render, toPort: "state" },
        { fromNode: render, fromPort: "tex", toNode: composite, toPort: "b" },
      ],
      inputPorts: [{ node: composite, port: "a" }],
      outputPort: { node: composite, port: "out" },
    };
  },
};
