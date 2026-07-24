import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  style: z.enum(["gold", "diamond", "holo"]).default("gold"),
  amount: z.number().min(0).max(1).default(0.6),
  size: z.number().min(0).max(1).default(0.4),
  color: z.string().default("#FFE27A"),
  anchor: z.enum(["eyes", "eye_left", "eye_right", "nose", "mouth", "forehead"]).default("eyes"),
});
export type SparklesFaceParams = z.infer<typeof Params>;

const SPRITE: Record<SparklesFaceParams["style"], string> = {
  gold: "sparkle-gold.png",
  diamond: "sparkle-diamond.png",
  holo: "sparkle-holo.png",
};

export const SPARKLES_FACE: BehaviorDef<SparklesFaceParams> = {
  id: "preset.sparkles.face.v1",
  kind: "preset",
  label: "Sparkles",
  iconName: "sparkle",
  acceptsSubjects: ["face"],
  paramSchema: Params,
  defaultParams: { style: "gold", amount: 0.6, size: 0.4, color: "#FFE27A", anchor: "eyes" },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const lmEmit = ctx.uniqueId("spk-lm");
    const emit = ctx.uniqueId("spk-emit");
    const clamp = ctx.uniqueId("spk-clamp");
    const render = ctx.uniqueId("spk-render");
    const glow = ctx.uniqueId("spk-glow");
    const compose = ctx.uniqueId("spk-comp");
    return {
      nodes: [
        { id: lmEmit, type: "LandmarkEmitter", config: { anchor: params.anchor } },
        { id: emit, type: "ParticleEmitter", config: { rate: 80 * params.amount, max: 1024, size: params.size } },
        { id: clamp, type: "BudgetClamp" },
        { id: render, type: "ParticleRenderer", config: { sprite: SPRITE[params.style], blend: "additive", tint: params.color } },
        { id: glow, type: "GaussianBlur", config: { radius: 6 } },
        { id: compose, type: "Blend", config: { mode: "additive" } },
      ],
      edges: [
        { fromNode: lmEmit, fromPort: "pts", toNode: emit, toPort: "spawn" },
        { fromNode: emit, fromPort: "state", toNode: clamp, toPort: "state" },
        { fromNode: clamp, fromPort: "out", toNode: render, toPort: "state" },
        { fromNode: render, fromPort: "tex", toNode: glow, toPort: "in" },
        { fromNode: glow, fromPort: "out", toNode: compose, toPort: "b" },
      ],
      inputPorts: [{ node: compose, port: "a" }],
      outputPort: { node: compose, port: "out" },
      detectionInputs: [{ node: lmEmit, port: "buf", require: "face_landmarks" }],
    };
  },
};
