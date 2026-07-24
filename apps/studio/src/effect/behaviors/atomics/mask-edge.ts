import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  color: z.string().default("#FFFFFF"),
  thickness: z.number().min(0).max(1).default(0.3),
  style: z.enum(["solid", "dashed", "glow"]).default("solid"),
});

export type MaskEdgeParams = z.infer<typeof Params>;

export const MASK_EDGE: BehaviorDef<MaskEdgeParams> = {
  id: "atomic.mask-edge",
  kind: "atomic",
  atomicKind: "mask-edge",
  label: "Mask Edge",
  iconName: "crosshair",
  acceptsSubjects: ["face", "subject_silhouette"],
  paramSchema: Params,
  defaultParams: { color: "#FFFFFF", thickness: 0.3, style: "solid" },
  thumbnailUrl: "",
  emit: (ctx, subject, params) => {
    const edge = ctx.uniqueId("edge");
    const stroke = ctx.uniqueId("edge-stroke");
    const compose = ctx.uniqueId("edge-compose");
    const detectionInputs =
      subject.kind === "subject_silhouette"
        ? [{ node: edge, port: "in", require: "subject_mask" as const }]
        : [];
    return {
      nodes: [
        { id: edge, type: "MaskEdge", config: { width: params.thickness * 10 } },
        { id: stroke, type: "ColorTint", config: { color: params.color, strength: 1, glow: params.style === "glow" } },
        { id: compose, type: "Blend", config: { mode: "normal" } },
      ],
      edges: [
        { fromNode: edge, fromPort: "out", toNode: stroke, toPort: "in" },
        { fromNode: stroke, fromPort: "out", toNode: compose, toPort: "b" },
      ],
      inputPorts: [{ node: compose, port: "a" }],
      outputPort: { node: compose, port: "out" },
      detectionInputs,
    };
  },
};
