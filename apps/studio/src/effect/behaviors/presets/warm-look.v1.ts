import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  warmth: z.number().min(0).max(1).default(0.4),
  vignette: z.number().min(0).max(1).default(0.4),
  grain: z.number().min(0).max(1).default(0.1),
});
export type WarmLookParams = z.infer<typeof Params>;

export const WARM_LOOK: BehaviorDef<WarmLookParams> = {
  id: "preset.warm-look.v1",
  kind: "preset",
  label: "Warm Look",
  iconName: "sun",
  acceptsSubjects: ["full_frame"],
  paramSchema: Params,
  defaultParams: { warmth: 0.4, vignette: 0.4, grain: 0.1 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const lut = ctx.uniqueId("warm-lut");
    const vig = ctx.uniqueId("warm-vig");
    const grain = ctx.uniqueId("warm-grain");
    return {
      nodes: [
        { id: lut, type: "LUT", config: { name: "warm", amount: params.warmth } },
        { id: vig, type: "Vignette", config: { softness: params.vignette } },
        { id: grain, type: "Grain", config: { strength: params.grain } },
      ],
      edges: [
        { fromNode: lut, fromPort: "out", toNode: vig, toPort: "in" },
        { fromNode: vig, fromPort: "out", toNode: grain, toPort: "in" },
      ],
      inputPorts: [{ node: lut, port: "in" }],
      outputPort: { node: grain, port: "out" },
    };
  },
};
