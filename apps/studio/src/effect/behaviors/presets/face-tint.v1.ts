import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  color: z.string().default("#FFB088"),
  strength: z.number().min(0).max(1).default(0.4),
  skinOnly: z.boolean().default(true),
});
export type FaceTintParams = z.infer<typeof Params>;

export const FACE_TINT: BehaviorDef<FaceTintParams> = {
  id: "preset.face-tint.v1",
  kind: "preset",
  label: "Face Tint",
  iconName: "palette",
  acceptsSubjects: ["face"],
  paramSchema: Params,
  defaultParams: { color: "#FFB088", strength: 0.4, skinOnly: true },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const mask = ctx.uniqueId("ft-mask");
    const tint = ctx.uniqueId("ft-tint");
    const compose = ctx.uniqueId("ft-comp");
    return {
      nodes: [
        { id: mask, type: params.skinOnly ? "FaceSkinMask" : "FaceMask" },
        { id: tint, type: "ColorTint", config: { color: params.color, strength: params.strength } },
        { id: compose, type: "Blend", config: { mode: "multiply" } },
      ],
      edges: [
        { fromNode: mask, fromPort: "out", toNode: tint, toPort: "mask" },
        { fromNode: tint, fromPort: "out", toNode: compose, toPort: "b" },
      ],
      inputPorts: [
        { node: tint, port: "in" },
        { node: compose, port: "a" },
      ],
      outputPort: { node: compose, port: "out" },
      detectionInputs: [{ node: mask, port: "landmarks", require: "face_landmarks" }],
    };
  },
};
