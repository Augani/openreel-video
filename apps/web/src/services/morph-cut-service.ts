import type { Clip, MediaItem, Transition } from "@openreel/core";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { getMorphCutRegistry } from "@openreel/core/video/morph-cut/registry";
import { renderCacheService } from "./render-cache-service";
import { projectHasMorphCut } from "./morph-cut-hook";

/**
 * Background analysis of Morph Cut transitions ("Analysing in background", like Premiere). Scans the live project
 * for Morph Cut transitions and asks the video engine to analyse each one (it decodes the two reference frames at
 * the cut and runs or reuses the cached analysis). Until a transition's analysis finishes it renders as a cross
 * dissolve. Jobs run one at a time so a project full of cuts does not saturate the machine.
 */
const DEBOUNCE_MS = 250;
const RETRY_MS = 1000;
const MAX_RETRIES = 30;

let timer: ReturnType<typeof setTimeout> | null = null;
let scanning = false;
let rescan = false;
let retries = 0;

export interface MorphCutTarget {
  readonly transition: Transition;
  readonly clipA: Clip;
  readonly clipB: Clip;
  readonly mediaA: MediaItem;
  readonly mediaB: MediaItem;
}

/** Every analysable Morph Cut of the project (both clips present with media). */
export function collectMorphCutTargets(project: ReturnType<typeof useProjectStore.getState>["project"]): { targets: MorphCutTarget[]; ids: Set<string> } {
  const targets: MorphCutTarget[] = [];
  const ids = new Set<string>();
  for (const track of project.timeline.tracks) {
    for (const transition of track.transitions ?? []) {
      if (transition.type !== "morphCut") continue;
      ids.add(transition.id);
      const clipA = track.clips.find((clip) => clip.id === transition.clipAId);
      const clipB = transition.clipBId ? track.clips.find((clip) => clip.id === transition.clipBId) : undefined;
      if (!clipA || !clipB) continue;
      const mediaA = project.mediaLibrary.items.find((item) => item.id === clipA.mediaId);
      const mediaB = project.mediaLibrary.items.find((item) => item.id === clipB.mediaId);
      if (!mediaA?.blob || !mediaB?.blob) continue;
      targets.push({ transition, clipA, clipB, mediaA, mediaB });
    }
  }
  return { targets, ids };
}

async function scan(): Promise<void> {
  const engine = useEngineStore.getState().getVideoEngine();
  const project = useProjectStore.getState().project;
  if (!engine) {
    if (retries++ < MAX_RETRIES) schedule(RETRY_MS);
    return;
  }
  retries = 0;
  const { targets } = collectMorphCutTargets(project);
  for (const target of targets) {
    await engine.analyseMorphCutTransition(target.transition, target.clipA, target.clipB, target.mediaA, target.mediaB, project.settings);
  }
}

function schedule(delay: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (scanning) {
      rescan = true;
      return;
    }
    scanning = true;
    void scan()
      .catch((error) => console.warn("[MorphCut] background analysis failed:", error))
      .finally(() => {
        scanning = false;
        if (rescan) {
          rescan = false;
          schedule(DEBOUNCE_MS);
        }
      });
  }, delay);
}

/** Debounced: asks for the live project to be scanned and every Morph Cut that is not analysed yet to be analysed. */
export function scheduleMorphCutScan(): void {
  schedule(DEBOUNCE_MS);
}

/** Analyse now and wait (tests, export preparation). */
export async function analyseMorphCutsNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (scanning) await new Promise((resolve) => setTimeout(resolve, 20));
  scanning = true;
  try {
    await scan();
  } finally {
    scanning = false;
  }
}

/**
 * Trims, moves and media replacements change the frames at a cut without touching the transition itself, so the
 * scan also follows the live project. Only projects that have a Morph Cut pay for it (a list scan per change).
 */
let subscribed = false;
function followProject(): void {
  if (subscribed) return;
  subscribed = true;
  useProjectStore.subscribe((state, previous) => {
    if (state.project === previous.project) return;
    if (state.project.timeline === previous.project.timeline && state.project.mediaLibrary === previous.project.mediaLibrary) return;
    if (!projectHasMorphCut(state.project)) return;
    scheduleMorphCutScan();
  });
}
followProject();

/** Event the program monitor listens to: the pixels a transition renders changed without a project edit. */
export const TRANSITION_RENDER_CHANGED_EVENT = "openreel:transition-render-changed";

/** The project time a transition's window covers (alignment and duration, like TransitionEngine.getTransitionWindow). */
export function transitionSpan(transition: Transition, clipA: Clip): { start: number; end: number } {
  const clipEnd = clipA.startTime + clipA.duration;
  const duration = Math.max(0, transition.duration);
  const start = transition.params.alignment === "start" ? clipEnd : transition.params.alignment === "end" ? clipEnd - duration : clipEnd - duration / 2;
  return { start, end: start + duration };
}

/**
 * A finished (or failed) analysis changes the pixels of its span from a cross dissolve to the morph (or leaves
 * the dissolve for good). Frames of that span already in the render cache were rendered as a dissolve and the
 * export would otherwise reuse them, so the span is dropped from the cache and the monitor re-renders.
 */
const lastSeen = new Map<string, string>();
function watchResults(): void {
  const registry = getMorphCutRegistry();
  registry.subscribe(() => {
    const project = useProjectStore.getState().project;
    const spans: Array<{ start: number; end: number }> = [];
    for (const track of project.timeline.tracks) {
      for (const transition of track.transitions ?? []) {
        if (transition.type !== "morphCut") continue;
        const state = registry.getState(transition.id);
        if (state.status !== "ready" && state.status !== "failed") continue;
        const stamp = `${state.status}|${state.key ?? ""}`;
        if (lastSeen.get(transition.id) === stamp) continue;
        lastSeen.set(transition.id, stamp);
        const clipA = track.clips.find((clip) => clip.id === transition.clipAId);
        if (clipA) spans.push(transitionSpan(transition, clipA));
      }
    }
    if (spans.length === 0) return;
    try {
      renderCacheService.instance.invalidateRanges(spans);
    } catch (error) {
      console.warn("[MorphCut] could not invalidate the render cache:", error);
    }
    window.dispatchEvent(new CustomEvent(TRANSITION_RENDER_CHANGED_EVENT));
  });
}
watchResults();
