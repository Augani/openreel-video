import { z } from "zod";
import type { BehaviorDef } from "../registry";

const Params = z.object({
  height: z.number().min(0.05).max(0.25).default(0.12),
  color: z.string().default("#000000"),
});
export type CinematicBarsParams = z.infer<typeof Params>;

export const CINEMATIC_BARS: BehaviorDef<CinematicBarsParams> = {
  id: "preset.cinematic-bars.v1",
  kind: "preset",
  label: "Cinematic Bars",
  iconName: "monitor",
  acceptsSubjects: ["full_frame"],
  paramSchema: Params,
  defaultParams: { height: 0.12, color: "#000000" },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const bars = ctx.uniqueId("cb-bars");
    return {
      nodes: [{ id: bars, type: "LetterboxBars", config: { height: params.height, color: params.color } }],
      edges: [],
      inputPorts: [{ node: bars, port: "in" }],
      outputPort: { node: bars, port: "out" },
    };
  },
};
