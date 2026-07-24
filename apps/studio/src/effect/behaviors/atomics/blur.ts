import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  radius: z.number().min(0).max(64).default(16),
  quality: z.enum(["low", "medium", "high"]).default("medium"),
});

export type BlurParams = z.infer<typeof Params>;

export const BLUR: BehaviorDef<BlurParams> = {
  id: "atomic.blur",
  kind: "atomic",
  atomicKind: "blur",
  label: "Blur",
  iconName: "blur",
  acceptsSubjects: ["subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { radius: 16, quality: "medium" },
  thumbnailUrl: "",
  emit: (ctx, subject, params) => {
    const blur = ctx.uniqueId("blur");
    if (subject.kind === "subject_silhouette") {
      const invert = ctx.uniqueId("blur-invert");
      const compose = ctx.uniqueId("blur-compose");
      return {
        nodes: [
          { id: invert, type: "InvertMask" },
          { id: blur, type: "GaussianBlur", config: { radius: params.radius } },
          { id: compose, type: "Layer", config: { feather: 0.2 } },
        ],
        edges: [
          { fromNode: invert, fromPort: "out", toNode: compose, toPort: "mask" },
          { fromNode: blur, fromPort: "out", toNode: compose, toPort: "back" },
        ],
        inputPorts: [
          { node: blur, port: "in" },
          { node: compose, port: "front" },
        ],
        outputPort: { node: compose, port: "out" },
        detectionInputs: [{ node: invert, port: "in", require: "subject_mask" }],
      };
    }
    return {
      nodes: [{ id: blur, type: "GaussianBlur", config: { radius: params.radius } }],
      edges: [],
      inputPorts: [{ node: blur, port: "in" }],
      outputPort: { node: blur, port: "out" },
    };
  },
};
