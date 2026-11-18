import type { ActionHistory } from "@openreel/core";
import { EditingSession } from "./agent/editing-session";

export interface ClipRecipeStep {
  type: string;
  params: Record<string, unknown>;
  description: string;
}
export interface ClipRecipe {
  id: string;
  name: string;
  steps: ClipRecipeStep[];
}

// These adjustments refer only to their target clip. Cuts, media references and
// effect IDs require a different rebinding contract and cannot be recorded here.
const RECORDABLE = new Set([
  "transform/update",
  "audio/setVolume",
  "audio/setFade",
  "clip/setBlendMode",
  "clip/setBlendOpacity",
  "clip/setColorGrading",
]);

export function recentClipRecipeSteps(
  history: ActionHistory,
): ClipRecipeStep[] {
  const entries = history.getHistoryEntries();
  const target = entries.at(-1)?.action.params.clipId;
  if (typeof target !== "string") return [];
  const steps: ClipRecipeStep[] = [];
  for (const entry of entries.slice().reverse()) {
    if (
      steps.length === 6 ||
      !RECORDABLE.has(entry.action.type) ||
      entry.action.params.clipId !== target
    )
      break;
    const { clipId: _clipId, ...params } = entry.action.params;
    steps.unshift({
      type: entry.action.type,
      params: JSON.parse(JSON.stringify(params)),
      description: entry.description,
    });
  }
  return steps;
}

export async function applyClipRecipe(
  recipe: ClipRecipe,
  clipId: string,
): Promise<void> {
  if (
    !recipe.steps.length ||
    recipe.steps.some((step) => !RECORDABLE.has(step.type))
  )
    throw new Error("This recipe contains an unsupported adjustment.");
  const session = new EditingSession();
  const transaction = session.beginTransaction();
  const project = session.getProject();
  const track = project.timeline.tracks.find((candidate) =>
    candidate.clips.some((clip) => clip.id === clipId),
  );
  if (!track) throw new Error("Select a video, image or audio clip first.");
  if (track.locked)
    throw new Error("Unlock the selected track before applying a recipe.");
  for (const step of recipe.steps) {
    const result = await session.applyAction({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: step.type,
      params: { ...step.params, clipId },
    });
    if (!result.success)
      throw new Error(
        result.error?.message ?? "Could not apply this adjustment.",
      );
  }
  await session.commitTransaction(transaction, recipe.name);
}
