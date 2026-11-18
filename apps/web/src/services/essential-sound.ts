import {
  createTaggedEffect,
  DEFAULT_ESSENTIAL_SOUND_OPTIONS,
  essentialTag,
  isUserEdited,
  normalizeEssentialOptions,
  planClipNormalization,
  planEssentialSound,
  planLiveDucking,
  reconcileEssentialEffects,
  resolveAudibleAudioTarget,
  resolveAudioType,
  sameLane,
  type LiveDuckingConfig,
  type Action,
  type AudioType,
  type AutomationPoint,
  type Clip,
  type EssentialSoundBlock,
  type EssentialSoundOptions,
  type EssentialSoundState,
  type Project,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { measureTimelineClipLoudness } from "./loudness";

/**
 * Essential Sound orchestration. Turns the pure plan from @openreel/core into
 * the ordinary undoable actions (effects, clip gain, volume automation), all
 * inside ONE history group, so a single undo puts every clip back.
 */

export type EssentialStep = "measuring" | "effects" | "loudness" | "ducking" | "done";

export interface EssentialProgress {
  readonly clipId: string;
  readonly index: number;
  readonly total: number;
  readonly step: EssentialStep;
}

export interface EssentialSoundResult {
  readonly clipId: string;
  readonly audioType: AudioType;
  readonly silent: boolean;
  /** Integrated loudness before the panel first touched the clip, and after matching. */
  readonly beforeLufs: number | null;
  readonly afterLufs: number | null;
  readonly clamped: boolean;
  readonly duckingReason: string | null;
  readonly notes: string[];
}

export class EssentialSoundLockedTrackError extends Error {
  constructor(trackName: string) {
    super(`The track "${trackName}" is locked. Unlock it to use Essential Sound.`);
    this.name = "EssentialSoundLockedTrackError";
  }
}

const SILENT_MESSAGE = "Silent clip: there is no audio to match.";
export const ESSENTIAL_SILENT_MESSAGE = SILENT_MESSAGE;

const store = () => useProjectStore.getState();

const findClip = (project: Project, clipId: string): Clip | undefined => {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
};

const cloneLane = (lane: readonly AutomationPoint[] | undefined): AutomationPoint[] | undefined =>
  lane && lane.length > 0 ? lane.map((point) => ({ ...point })) : undefined;

/** Edits applied by the open group, so a failure knows whether there is anything to roll back. */
let appliedInGroup = 0;

async function run(action: Omit<Action, "id" | "timestamp">): Promise<void> {
  const result = await store().executeAction({ id: crypto.randomUUID(), timestamp: Date.now(), ...action } as Action);
  if (!result.success) throw new Error(result.error?.message ?? `The ${action.type} edit could not be applied.`);
  appliedInGroup += 1;
}

const setVolume = (clipId: string, volume: number) => run({ type: "audio/setVolume", params: { clipId, volume } });
const setLane = (clipId: string, points: AutomationPoint[] | undefined) =>
  run({ type: "audio/addAutomation", params: { clipId, points: points ?? null } });

/** The clip that actually carries the audio (a muted video clip hands over to its linked audio clip). */
export function essentialTarget(clipId: string): Clip | null {
  const project = store().project;
  const clip = findClip(project, clipId);
  return clip ? resolveAudibleAudioTarget(clip, project.timeline) : null;
}

function assertUnlocked(clip: Clip): void {
  const track = store().project.timeline.tracks.find((candidate) => candidate.id === clip.trackId);
  if (track?.locked) throw new EssentialSoundLockedTrackError(track.name);
}

const setLiveDucking = (clipId: string, config: LiveDuckingConfig | null) =>
  run({ type: "audio/setLiveDucking", params: { clipId, config } });

/**
 * Put back what the panel's ducking replaced. A live duck is simply switched
 * off; a duck baked to keyframes by an older version is restored to the lane
 * it replaced, unless the user changed that lane since.
 */
async function releaseDucking(clipId: string, state: EssentialSoundState | undefined, notes: string[]): Promise<boolean> {
  const ducking = state?.ducking;
  if (!ducking) return true;
  const clip = findClip(store().project, clipId);
  if (!clip) return true;
  if (ducking.live) {
    if (clip.metadata?.liveDucking) await setLiveDucking(clipId, null);
    return true;
  }
  if (!ducking.appliedVolumeLane) return true;
  if (!sameLane(clip.automation?.volume, ducking.appliedVolumeLane)) {
    notes.push("Kept your edited volume automation.");
    return false;
  }
  await setLane(clipId, ducking.previousVolumeLane);
  return true;
}

/** Put back the clip gain the panel replaced, unless the user changed it since. */
async function releaseLoudness(clipId: string, state: EssentialSoundState | undefined, notes: string[]): Promise<boolean> {
  const loudness = state?.loudness;
  if (!loudness) return true;
  const clip = findClip(store().project, clipId);
  if (!clip) return true;
  const laneUntouched = sameLane(clip.automation?.volume, loudness.appliedVolumeLane);
  if (clip.volume !== loudness.appliedVolume || !laneUntouched) {
    notes.push("Kept your edited clip volume.");
    return false;
  }
  if (loudness.previousVolumeLane || loudness.appliedVolumeLane) await setLane(clipId, loudness.previousVolumeLane);
  if (clip.volume !== loudness.previousVolume) await setVolume(clipId, loudness.previousVolume);
  return true;
}

async function reconcileChain(
  clipId: string,
  plan: ReturnType<typeof planEssentialSound>,
  blocks: readonly Extract<EssentialSoundBlock, "repair" | "clarity">[],
  notes: string[],
): Promise<void> {
  for (const block of blocks) {
    const enabled = plan.options[block];
    const clip = findClip(store().project, clipId);
    if (!clip) return;
    const planned = plan.effectChain.filter((effect) => effect.block === block);
    // An option that was switched off is an explicit request to remove what the panel added.
    const diff = reconcileEssentialEffects(clip.audioEffects ?? [], planned, [block], { force: !enabled });
    for (const id of diff.remove) await run({ type: "audio/removeEffect", params: { clipId, effectId: id } });
    for (const { effectId, planned: want } of diff.replace) {
      const current = (findClip(store().project, clipId)?.audioEffects ?? []).find((effect) => effect.id === effectId);
      const next = createTaggedEffect(want, effectId);
      await run({
        type: "audio/replaceEffect",
        params: { clipId, effectId, effect: { ...next, enabled: current?.enabled ?? true } },
      });
    }
    for (const want of diff.add) {
      await run({ type: "audio/addEffect", params: { clipId, effect: createTaggedEffect(want, `essential-${block}-${want.key}-${crypto.randomUUID().slice(0, 8)}`) } });
    }
    if (diff.keptUserEdited.length > 0) notes.push(`Kept your edits to ${diff.keptUserEdited.length} ${block} effect${diff.keptUserEdited.length === 1 ? "" : "s"}.`);
  }
}

async function applyToClip(
  clipId: string,
  audioType: AudioType,
  requested: EssentialSoundOptions,
  index: number,
  total: number,
  rematch: boolean,
  onProgress?: (progress: EssentialProgress) => void,
): Promise<EssentialSoundResult> {
  const progress = (step: EssentialStep) => onProgress?.({ clipId, index, total, step });
  const first = findClip(store().project, clipId);
  if (!first) throw new Error("Clip not found");
  assertUnlocked(first);
  const notes: string[] = [];
  const prevState = first.metadata?.essentialSound;
  const options = normalizeEssentialOptions(requested);

  // 1. Lay the duck down first so measurements hear the clip itself.
  const duckingReleased = await releaseDucking(clipId, prevState, notes);

  // 2. Repair and clarity effects, reconciled against what the panel added before.
  progress("effects");
  const plan = planEssentialSound(audioType, options);
  await reconcileChain(clipId, plan, ["repair", "clarity"], notes);

  // 3. Loudness.
  let loudnessState = prevState?.loudness;
  let silent = false;
  let beforeLufs: number | null = prevState?.loudness?.beforeLufs ?? null;
  let afterLufs: number | null = null;
  let clamped = false;
  if (options.loudness && plan.loudnessTarget !== null && !rematch && prevState?.loudness) {
    // Already matched and the user did not ask to match again: keep the gain.
    afterLufs = prevState.loudness.afterLufs ?? null;
    clamped = prevState.loudness.clamped;
  } else if (options.loudness && plan.loudnessTarget !== null) {
    progress("measuring");
    const projectId = store().project.id;
    const clip = findClip(store().project, clipId)!;
    const { measured, source } = await measureTimelineClipLoudness(clip.id);
    if (store().project.id !== projectId) throw new Error("The project changed while the clip was being measured.");
    if (!Number.isFinite(measured.integrated)) {
      silent = true;
      notes.push(SILENT_MESSAGE);
    } else {
      progress("loudness");
      const current = findClip(store().project, clipId)!;
      const normalization = planClipNormalization(current, measured, plan.loudnessTarget);
      if (normalization.action) {
        if (current !== source) throw new Error("The clip changed while it was being measured. Run Auto-Match again.");
        const keepOriginal = loudnessState;
        const previousVolume = keepOriginal?.previousVolume ?? current.volume;
        const previousLane = keepOriginal ? keepOriginal.previousVolumeLane : cloneLane(current.automation?.volume);
        if (beforeLufs === null) beforeLufs = measured.integrated;
        await run(normalization.action);
        const after = findClip(store().project, clipId)!;
        afterLufs = normalization.resultingLufs;
        clamped = normalization.clamped;
        loudnessState = {
          targetLufs: plan.loudnessTarget,
          ...(beforeLufs !== null ? { beforeLufs } : {}),
          afterLufs,
          clamped,
          previousVolume,
          ...(previousLane ? { previousVolumeLane: previousLane } : {}),
          appliedVolume: after.volume,
          ...(cloneLane(after.automation?.volume) ? { appliedVolumeLane: cloneLane(after.automation?.volume) } : {}),
        };
        if (clamped) notes.push("The +12 dB clip gain limit stopped the clip short of the target.");
      }
    }
  } else if (prevState?.loudness) {
    const restored = await releaseLoudness(clipId, prevState, notes);
    loudnessState = restored ? undefined : prevState.loudness;
    beforeLufs = restored ? null : beforeLufs;
  }

  // 4. Ducking under Dialogue: live, so it follows the dialogue clips when they move or trim.
  let duckingState: EssentialSoundState["ducking"];
  let duckingReason: string | null = plan.ducking.reason ?? null;
  if (!duckingReleased) {
    duckingState = prevState?.ducking;
  } else {
    const project = store().project;
    const clip = findClip(project, clipId)!;
    const planned = planLiveDucking(plan.ducking, clip, project.timeline);
    duckingReason = planned.reason ?? null;
    if (planned.config) {
      progress("ducking");
      if (JSON.stringify(clip.metadata?.liveDucking) !== JSON.stringify(planned.config)) {
        await setLiveDucking(clipId, planned.config);
      }
      duckingState = { live: true };
      if (!planned.active) notes.push("No dialogue plays under this clip yet; it will duck as soon as a Dialogue clip does.");
    }
  }

  // 5. Remember what we did, and tag the clip.
  const nextState: EssentialSoundState = {
    options,
    ...(loudnessState ? { loudness: loudnessState } : {}),
    ...(duckingState ? { ducking: duckingState } : {}),
  };
  await run({ type: "audio/setEssentialSound", params: { clipId, audioType, state: nextState } });
  progress("done");
  return { clipId, audioType, silent, beforeLufs, afterLufs, clamped, duckingReason, notes };
}

async function inGroup<T>(label: string, work: () => Promise<T>): Promise<T> {
  const history = store().actionExecutor.getHistory();
  appliedInGroup = 0;
  store().beginHistoryGroup(label);
  try {
    return await work();
  } catch (error) {
    store().endHistoryGroup();
    // A failure half-way must not leave half the preset behind.
    if (appliedInGroup > 0) await store().undo();
    throw error;
  } finally {
    if (history.getCurrentGroupId()) store().endHistoryGroup();
    window.dispatchEvent(new CustomEvent("openreel:preview-invalidate", { detail: { audioOnly: true } }));
  }
}

/** Options currently in effect on a clip (what the panel shows), or the defaults. */
export function essentialOptionsOf(clip: Clip | null | undefined): EssentialSoundOptions {
  return normalizeEssentialOptions(clip?.metadata?.essentialSound?.options ?? DEFAULT_ESSENTIAL_SOUND_OPTIONS);
}

/** Options with every block off: tagging only labels the clip. */
export const TAG_ONLY_OPTIONS: EssentialSoundOptions = {
  ...DEFAULT_ESSENTIAL_SOUND_OPTIONS,
  loudness: false,
  repair: false,
  clarity: false,
  ducking: false,
};

/**
 * Tag the clips as `audioType` and apply `options` (merged over what each clip
 * already has) as one undo step. Applying the same options twice changes
 * nothing; switching an option off removes only what the panel added.
 */
export async function applyEssentialSound(
  clipIds: readonly string[],
  audioType: AudioType,
  patch: Partial<EssentialSoundOptions>,
  { rematch = patch.loudness === true, onProgress }: { rematch?: boolean; onProgress?: (progress: EssentialProgress) => void } = {},
): Promise<EssentialSoundResult[]> {
  const targets = [...new Set(clipIds.map((id) => essentialTarget(id)?.id).filter((id): id is string => !!id))];
  if (targets.length === 0) throw new Error("Select a clip with audio first.");
  return inGroup("Essential Sound", async () => {
    const results: EssentialSoundResult[] = [];
    for (const [index, id] of targets.entries()) {
      const existing = findClip(store().project, id);
      // Re-tagging keeps the clip's option choices, but turns off blocks the new type cannot use.
      const base = existing?.metadata?.essentialSound ? essentialOptionsOf(existing) : TAG_ONLY_OPTIONS;
      const options = normalizeEssentialOptions({ ...base, ...patch });
      // A different type has a different loudness target, so it is matched again.
      results.push(await applyToClip(id, audioType, options, index, targets.length, rematch || existing?.audioType !== audioType, onProgress));
    }
    return results;
  });
}

/** Remove everything the panel added to the clips and drop the tag: back to the pre-panel chain. */
export async function clearEssentialSound(clipIds: readonly string[]): Promise<string[]> {
  const targets = [...new Set(clipIds.map((id) => essentialTarget(id)?.id).filter((id): id is string => !!id))];
  const kept: string[] = [];
  await inGroup("Clear audio type", async () => {
    for (const id of targets) {
      const clip = findClip(store().project, id);
      if (!clip) continue;
      assertUnlocked(clip);
      const notes: string[] = [];
      const state = clip.metadata?.essentialSound;
      await releaseDucking(id, state, notes);
      await releaseLoudness(id, state, notes);
      for (const effect of clip.audioEffects ?? []) {
        if (!essentialTag(effect)) continue;
        await run({ type: "audio/removeEffect", params: { clipId: id, effectId: effect.id } });
      }
      await run({ type: "audio/setEssentialSound", params: { clipId: id, audioType: null, state: null } });
      kept.push(...notes);
    }
  });
  return kept;
}

/** Tag only (no processing): the chip and the panel appear, every block starts off. */
export const tagAudioType = (clipIds: readonly string[], audioType: AudioType) =>
  applyEssentialSound(clipIds, audioType, {});

export interface EssentialSoundStatus {
  readonly audioType: AudioType | null;
  /** True when the tag came from the track role rather than the clip. */
  readonly inferred: boolean;
  readonly state: EssentialSoundState | null;
  readonly editedEffects: number;
}

export function essentialSoundStatus(clip: Clip | null | undefined, project: Project): EssentialSoundStatus {
  if (!clip) return { audioType: null, inferred: false, state: null, editedEffects: 0 };
  const audioType = resolveAudioType(clip, project.timeline.tracks);
  return {
    audioType,
    inferred: !clip.audioType && audioType !== null,
    state: clip.metadata?.essentialSound ?? null,
    editedEffects: (clip.audioEffects ?? []).filter(isUserEdited).length,
  };
}
