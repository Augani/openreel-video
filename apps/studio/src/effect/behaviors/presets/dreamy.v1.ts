import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  glow: z.number().min(0).max(1).default(0.5),
  bloom: z.number().min(0).max(1).default(0.5),
  softContrast: z.number().min(0).max(1).default(0.4),
});
export type DreamyParams = z.infer<typeof Params>;

export const DREAMY: BehaviorDef<DreamyParams> = {
  id: "preset.dreamy.v1",
  kind: "preset",
  label: "Dreamy",
  iconName: "droplet",
  acceptsSubjects: ["full_frame"],
  paramSchema: Params,
  defaultParams: { glow: 0.5, bloom: 0.5, softContrast: 0.4 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const blur = ctx.uniqueId("dr-blur");
    const screen = ctx.uniqueId("dr-screen");
    const curve = ctx.uniqueId("dr-curve");
    return {
      nodes: [
        { id: blur, type: "GaussianBlur", config: { radius: 8 + params.glow * 24 } },
        { id: screen, type: "Blend", config: { mode: "screen", strength: params.bloom } },
        { id: curve, type: "Curves", config: { gamma: 1 + params.softContrast * 0.3 } },
      ],
      edges: [
        { fromNode: blur, fromPort: "out", toNode: screen, toPort: "b" },
        { fromNode: screen, fromPort: "out", toNode: curve, toPort: "in" },
      ],
      inputPorts: [
        { node: blur, port: "in" },
        { node: screen, port: "a" },
      ],
      outputPort: { node: curve, port: "out" },
    };
  },
};
