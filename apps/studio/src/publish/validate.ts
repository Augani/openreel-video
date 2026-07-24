import type { Scene } from "../effect/scene";
import type { FilterDoc } from "../filter/types";
import { getBehavior } from "../effect/behaviors/registry";

export interface PublishInput {
  kind: "effect" | "filter";
  name: string;
  doc: Scene | FilterDoc;
}

export type ValidateResult = { ok: true } | { ok: false; errors: string[] };

export function validatePublishable(input: PublishInput): ValidateResult {
  const errors: string[] = [];
  if (input.name.trim().length === 0) errors.push("Project must have a name.");

  if (input.kind === "effect") {
    const scene = input.doc as Scene;
    const totalBehaviors = scene.subjects.reduce((sum, s) => sum + s.behaviors.length, 0);
    if (totalBehaviors === 0) errors.push("Effect must have at least one behavior.");
    for (const subject of scene.subjects) {
      for (const b of subject.behaviors) {
        const def = getBehavior(b.kind === "preset" ? b.presetId : `atomic.${b.atomicKind}`);
        if (!def) {
          errors.push(`Unknown behavior in ${subject.name}.`);
          continue;
        }
        const parsed = def.paramSchema.safeParse(b.params);
        if (!parsed.success) errors.push(`Behavior ${b.name} has invalid params.`);
        if (!def.acceptsSubjects.includes(subject.kind)) {
          errors.push(`Behavior ${b.name} cannot be applied to ${subject.kind}.`);
        }
      }
    }
  } else {
    const doc = input.doc as FilterDoc;
    if (doc.adjustments.length === 0) errors.push("Filter must have at least one adjustment.");
    for (const a of doc.adjustments) {
      const def = getBehavior(a.kind === "preset" ? a.presetId : `atomic.${a.atomicKind}`);
      if (!def) {
        errors.push(`Unknown adjustment: ${a.name}.`);
        continue;
      }
      if (!def.acceptsSubjects.includes("full_frame")) {
        errors.push(`Adjustment ${a.name} is not valid in a Filter (no full_frame support).`);
      }
      const parsed = def.paramSchema.safeParse(a.params);
      if (!parsed.success) errors.push(`Adjustment ${a.name} has invalid params.`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
