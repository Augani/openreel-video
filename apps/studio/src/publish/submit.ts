import { studioApi } from "../lib/api";
import { sceneToGraph } from "../effect/compile";
import { filterDocToGraph } from "../filter/compile";
import type { Scene } from "../effect/scene";
import type { FilterDoc } from "../filter/types";

export interface SubmitInput {
  kind: "effect" | "filter";
  name: string;
  description?: string;
  tags?: string[];
  license?: string;
  visibility?: "public" | "unlisted";
  doc: Scene | FilterDoc;
}

export type SubmitResult =
  | { ok: true; submissionId: string }
  | { ok: false; error: string };

export async function publish(input: SubmitInput): Promise<SubmitResult> {
  const compile = input.kind === "effect"
    ? sceneToGraph(input.doc as Scene, { kind: "effect" })
    : filterDocToGraph(input.doc as FilterDoc);

  if (!compile.ok) return { ok: false, error: compile.errors.join("; ") };

  try {
    const draft = await studioApi.createDraft(input.kind, input.name, compile.graph, {
      kind: input.kind,
      title: input.name,
      description: input.description ?? "",
      tags: input.tags ?? [],
      license: input.license ?? "MIT",
      visibility: input.visibility ?? "public",
    });
    const submission = await studioApi.submitDraft(draft.id);
    return { ok: true, submissionId: submission.submission.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
