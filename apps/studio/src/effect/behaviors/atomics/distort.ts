import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  type: z.enum(["wave", "pinch", "pixelate"]).default("wave"),
  strength: z.number().min(0).max(1).default(0.4),
});

export type DistortParams = z.infer<typeof Params>;

export const DISTORT: BehaviorDef<DistortParams> = {
  id: "atomic.distort",
  kind: "atomic",
  atomicKind: "distort",
  label: "Distort",
  iconName: "waves",
  acceptsSubjects: ["face", "subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { type: "wave", strength: 0.4 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const node = ctx.uniqueId("dist");
    const nodeType = params.type === "pixelate" ? "Pixelate" : "UVDistortion";
    return {
      nodes: [{ id: node, type: nodeType, config: { mode: params.type, strength: params.strength } }],
      edges: [],
      inputPorts: [{ node, port: "in" }],
      outputPort: { node, port: "out" },
    };
  },
};
