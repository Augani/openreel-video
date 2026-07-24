import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  mode: z.enum(["color", "image", "blur"]).default("color"),
  color: z.string().default("#0E0E0E"),
  imageRef: z.string().optional(),
  blurRadius: z.number().min(0).max(64).default(20),
  edgeSoftness: z.number().min(0).max(1).default(0.2),
});
export type BgReplaceParams = z.infer<typeof Params>;

export const BACKGROUND_REPLACE: BehaviorDef<BgReplaceParams> = {
  id: "preset.background-replace.v1",
  kind: "preset",
  label: "Background Replace",
  iconName: "image",
  acceptsSubjects: ["subject_silhouette"],
  paramSchema: Params,
  defaultParams: { mode: "color", color: "#0E0E0E", blurRadius: 20, edgeSoftness: 0.2 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const bg = ctx.uniqueId("bgr-bg");
    const compose = ctx.uniqueId("bgr-compose");
    let bgType: string;
    let bgConfig: Record<string, unknown>;
    if (params.mode === "image") {
      bgType = "ImageSource";
      bgConfig = { image: params.imageRef ?? "" };
    } else if (params.mode === "blur") {
      bgType = "GaussianBlur";
      bgConfig = { radius: params.blurRadius };
    } else {
      bgType = "ColorSource";
      bgConfig = { color: params.color };
    }
    const inputPorts =
      params.mode === "blur"
        ? [{ node: bg, port: "in" }, { node: compose, port: "front" }]
        : [{ node: compose, port: "front" }];
    return {
      nodes: [
        { id: bg, type: bgType, config: bgConfig },
        { id: compose, type: "Layer", config: { feather: params.edgeSoftness } },
      ],
      edges: [{ fromNode: bg, fromPort: "out", toNode: compose, toPort: "back" }],
      inputPorts,
      outputPort: { node: compose, port: "out" },
      detectionInputs: [{ node: compose, port: "mask", require: "subject_mask" }],
    };
  },
};
