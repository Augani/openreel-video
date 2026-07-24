import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  spacing: z.number().min(0.1).max(0.45).default(0.3),
  echoOpacity: z.number().min(0).max(1).default(0.7),
});
export type CloneThreeParams = z.infer<typeof Params>;

export const CLONE_THREE: BehaviorDef<CloneThreeParams> = {
  id: "preset.clone.three.v1",
  kind: "preset",
  label: "Three of Me",
  iconName: "copy",
  acceptsSubjects: ["subject_silhouette"],
  paramSchema: Params,
  defaultParams: { spacing: 0.3, echoOpacity: 0.7 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const cut = ctx.uniqueId("clone-cut");
    const tl = ctx.uniqueId("clone-tl");
    const tr = ctx.uniqueId("clone-tr");
    const b1 = ctx.uniqueId("clone-b1");
    const b2 = ctx.uniqueId("clone-b2");
    return {
      nodes: [
        { id: cut, type: "Cutout" },
        { id: tl, type: "Transform", config: { x: -params.spacing, opacity: params.echoOpacity } },
        { id: tr, type: "Transform", config: { x: params.spacing, opacity: params.echoOpacity } },
        { id: b1, type: "Blend", config: { mode: "normal" } },
        { id: b2, type: "Blend", config: { mode: "normal" } },
      ],
      edges: [
        { fromNode: cut, fromPort: "out", toNode: tl, toPort: "in" },
        { fromNode: cut, fromPort: "out", toNode: tr, toPort: "in" },
        { fromNode: tl, fromPort: "out", toNode: b1, toPort: "b" },
        { fromNode: tr, fromPort: "out", toNode: b2, toPort: "b" },
        { fromNode: b1, fromPort: "out", toNode: b2, toPort: "a" },
      ],
      inputPorts: [
        { node: cut, port: "src" },
        { node: b1, port: "a" },
      ],
      outputPort: { node: b2, port: "out" },
      detectionInputs: [{ node: cut, port: "mask", require: "subject_mask" }],
    };
  },
};
