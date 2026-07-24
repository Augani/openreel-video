import type { Behavior } from "../effect/scene";

export interface FilterDoc {
  name: string;
  sampleClipId: string;
  adjustments: Behavior[];
}
