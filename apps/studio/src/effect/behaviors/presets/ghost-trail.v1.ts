import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  length: z.number().min(2).max(16).default(6),
  fade: z.number().min(0.5).max(0.98).default(0.85),
  tint: z.string().default("#88BBFF"),
});
export type GhostTrailParams = z.infer<typeof Params>;

export const GHOST_TRAIL: BehaviorDef<GhostTrailParams> = {
  id: "preset.ghost-trail.v1",
  kind: "preset",
  label: "Ghost Trail",
  iconName: "history",
  acceptsSubjects: ["subject_silhouette"],
  paramSchema: Params,
  defaultParams: { length: 6, fade: 0.85, tint: "#88BBFF" },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const trail = ctx.uniqueId("gt-trail");
    const tint = ctx.uniqueId("gt-tint");
    const compose = ctx.uniqueId("gt-comp");
    return {
      nodes: [
        { id: trail, type: "Trail", config: { length: params.length, fade: params.fade } },
        { id: tint, type: "ColorTint", config: { color: params.tint, strength: 0.4 } },
        { id: compose, type: "Layer", config: { feather: 0.1 } },
      ],
      edges: [
        { fromNode: trail, fromPort: "out", toNode: tint, toPort: "in" },
        { fromNode: tint, fromPort: "out", toNode: compose, toPort: "back" },
      ],
      inputPorts: [
        { node: trail, port: "in" },
        { node: compose, port: "front" },
      ],
      outputPort: { node: compose, port: "out" },
      detectionInputs: [{ node: compose, port: "mask", require: "subject_mask" }],
    };
  },
};
