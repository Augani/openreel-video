import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  mode: z.enum(["color", "image", "none"]).default("color"),
  color: z.string().default("#000000"),
  imageRef: z.string().optional(),
  edgeSoftness: z.number().min(0).max(1).default(0.2),
});

export type ReplaceParams = z.infer<typeof Params>;

export const REPLACE: BehaviorDef<ReplaceParams> = {
  id: "atomic.replace",
  kind: "atomic",
  atomicKind: "replace",
  label: "Replace",
  iconName: "image",
  acceptsSubjects: ["subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { mode: "color", color: "#000000", edgeSoftness: 0.2 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const bg = ctx.uniqueId("rep-bg");
    const compose = ctx.uniqueId("rep-compose");
    return {
      nodes: [
        { id: bg, type: params.mode === "image" ? "ImageSource" : "ColorSource", config: { color: params.color, image: params.imageRef ?? "" } },
        { id: compose, type: "Layer", config: { feather: params.edgeSoftness } },
      ],
      edges: [{ fromNode: bg, fromPort: "out", toNode: compose, toPort: "back" }],
      inputPorts: [{ node: compose, port: "front" }],
      outputPort: { node: compose, port: "out" },
      detectionInputs: [{ node: compose, port: "mask", require: "subject_mask" }],
    };
  },
};
