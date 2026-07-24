import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  color: z.string().default("#FFE27A"),
  intensity: z.number().min(0).max(1).default(0.6),
  spread: z.number().min(0).max(1).default(0.4),
});

export type GlowParams = z.infer<typeof Params>;

export const GLOW: BehaviorDef<GlowParams> = {
  id: "atomic.glow",
  kind: "atomic",
  atomicKind: "glow",
  label: "Glow",
  iconName: "sparkle",
  acceptsSubjects: ["face", "subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { color: "#FFE27A", intensity: 0.6, spread: 0.4 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const blur = ctx.uniqueId("glow-blur");
    const tint = ctx.uniqueId("glow-tint");
    const screen = ctx.uniqueId("glow-screen");
    return {
      nodes: [
        { id: blur, type: "GaussianBlur", config: { radius: 8 + params.spread * 40 } },
        { id: tint, type: "ColorTint", config: { color: params.color, strength: params.intensity } },
        { id: screen, type: "Blend", config: { mode: "screen" } },
      ],
      edges: [
        { fromNode: blur, fromPort: "out", toNode: tint, toPort: "in" },
        { fromNode: tint, fromPort: "out", toNode: screen, toPort: "b" },
      ],
      inputPorts: [
        { node: blur, port: "in" },
        { node: screen, port: "a" },
      ],
      outputPort: { node: screen, port: "out" },
    };
  },
};
