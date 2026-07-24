import type { FilterDoc } from "./types";
import { sceneToGraph } from "../effect/compile";
import type { SceneCompileResult } from "../effect/scene";

export function filterDocToGraph(doc: FilterDoc): SceneCompileResult {
  return sceneToGraph(
    {
      sampleClipId: doc.sampleClipId,
      subjects: [
        {
          id: "full",
          kind: "full_frame",
          name: "Full frame",
          visible: true,
          behaviors: doc.adjustments,
        },
      ],
    },
    { kind: "filter" },
  );
}
