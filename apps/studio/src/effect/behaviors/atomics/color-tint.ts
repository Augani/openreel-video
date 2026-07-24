import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  color: z.string().default("#FF7700"),
  blend: z.enum(["multiply", "screen", "overlay", "soft-light"]).default("multiply"),
  strength: z.number().min(0).max(1).default(0.5),
});

export type ColorTintParams = z.infer<typeof Params>;

export const COLOR_TINT: BehaviorDef<ColorTintParams> = {
  id: "atomic.color-tint",
  kind: "atomic",
  atomicKind: "color-tint",
  label: "Color Tint",
  iconName: "palette",
  acceptsSubjects: ["face", "subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { color: "#FF7700", blend: "multiply", strength: 0.5 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const tint = ctx.uniqueId("ct-tint");
    const blend = ctx.uniqueId("ct-blend");
    return {
      nodes: [
        { id: tint, type: "ColorTint", config: { color: params.color, strength: params.strength } },
        { id: blend, type: "Blend", config: { mode: params.blend } },
      ],
      edges: [{ fromNode: tint, fromPort: "out", toNode: blend, toPort: "b" }],
      inputPorts: [{ node: tint, port: "in" }, { node: blend, port: "a" }],
      outputPort: { node: blend, port: "out" },
    };
  },
};
