import type { Clip } from "@openreel/core/types/timeline";
import type { Project } from "@openreel/core/types/project";
import { TRANSITION_TYPES, type TransitionType } from "@openreel/core/types/effects";
import { getDefaultTransitionParams } from "@openreel/core/video/transition-default-params";
import { validateTransitionParams } from "@openreel/core/video/transition-defaults";
import {
  buildTransitionAtCut,
  createTransitionPreset,
  defaultFromPreset,
  resolveDefaultTransition,
  type TransitionPreset,
} from "@openreel/core/video/transition-presets";
import { MASK_TRANSITION_TYPES } from "@openreel/core/video/transition-masks";
import { getMorphCutRegistry } from "@openreel/core/video/morph-cut/registry";
import type { EditingHost } from "./host";
import type { ToolResult } from "./types";

/**
 * Transition presets and defaults for the agent: list every transition with its parameters, save / delete
 * named presets, set the default transition, and apply a preset or the default at a cut. Adding and editing a
 * single transition (with its parameters) is add_transition / update_transition in the registry.
 */

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "ERROR"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const COMMON_PARAMS = {
  alignment: "start | center | end: where the window sits on the cut",
  startPct: "0-100, the part of the effect the transition starts at",
  endPct: "0-100, the part of the effect it ends at",
  curve: "linear | ease | ease-in | ease-out | ease-in-out",
};
const GEOMETRY_PARAMS = {
  direction: "left | right | up | down (cubeSpin, flipOver, checkerWipe, randomWipe)",
  orientation: "horizontal | vertical (bandWipe, barnDoor, split)",
  corner: "topLeft | topRight | bottomLeft | bottomRight (inset, pagePeel)",
  tiles: "2-64 squares / blocks / strips across (checkerboard, checkerWipe, randomBlocks, randomWipe)",
  seed: "0-999999, same seed = same pattern (randomBlocks, randomWipe)",
  borderWidth: "px, also on cubeSpin, flipOver, split",
  quality: "low | medium | high analysis detail (morphCut only; a change re-analyses the cut)",
};
const MORPH_CUT_NOTE =
  "morphCut hides a jump cut inside one continuous shot (a talking head): it needs a cut between two clips, analyses the two frames at the cut in the background and renders as a cross dissolve until that finishes (or for good, with a message, when the shots differ too much). Check get_morph_cut_status before exporting.";
const MASK_PARAMS = {
  feather: "0-1 soft edge",
  borderWidth: "0-100 px coloured border strip",
  borderColor: "#rrggbb",
  reverse: "true closes the shape / runs the field backwards",
};

const presetsOf = (project: Project): readonly TransitionPreset[] => project.transitionPresets ?? [];

/** The app-wide library, or a clear failure where the host has none (headless hosts). */
function libraryOf(host: EditingHost) {
  return host.transitionLibrary ?? null;
}
const NO_LIBRARY = "The app-wide preset library is only available in the editor";

/** A preset by id from the project, else from the app-wide library. */
async function findPreset(host: EditingHost, id: unknown): Promise<{ preset: TransitionPreset; scope: "project" | "library" } | undefined> {
  const local = presetsOf(host.getProject()).find((candidate) => candidate.id === id);
  if (local) return { preset: local, scope: "project" };
  const shared = (await libraryOf(host)?.list())?.find((candidate) => candidate.id === id);
  return shared ? { preset: shared, scope: "library" } : undefined;
}

function findClip(project: Project, id: unknown): Clip | undefined {
  if (typeof id !== "string") return undefined;
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === id);
    if (clip) return clip;
  }
  return undefined;
}

async function dispatch(host: EditingHost, type: string, params: Record<string, unknown>): Promise<ToolResult | null> {
  const result = await host.applyAction({ type, id: genId(), timestamp: Date.now(), params });
  return result.success ? null : fail(result.error?.message ?? `${type} failed`, result.error?.code ?? "ACTION_FAILED");
}

/** Places a transition made from `source` at the cut between two clips (clipB omitted: the outro of clipA). */
async function placeAtCut(
  host: EditingHost,
  source: { type: TransitionType; duration: number; params: Record<string, unknown> },
  args: Record<string, unknown>,
  label: string,
): Promise<ToolResult> {
  host.requireOpenProject();
  const project = host.getProject();
  const first = findClip(project, args.clipAId);
  if (!first) return fail(`Clip "${String(args.clipAId)}" not found`, "INVALID_PARAMS");
  const second = args.clipBId === undefined ? undefined : findClip(project, args.clipBId);
  if (args.clipBId !== undefined && !second) return fail(`Clip "${String(args.clipBId)}" not found`, "INVALID_PARAMS");
  const [clipA, clipB] = second && second.startTime < first.startTime ? [second, first] : [first, second];
  if (source.type === "morphCut" && !clipB) return fail("Morph Cut needs a cut between two clips (pass clipBId)", "INVALID_PARAMS");
  if (clipB) {
    if (clipA.trackId !== clipB.trackId) return fail("The clips are on different tracks", "TRANSITION_DIFFERENT_TRACKS");
    if (Math.abs(clipA.startTime + clipA.duration - clipB.startTime) > 0.01) {
      return fail("The clips are not adjacent: a transition needs a cut", "TRANSITION_NOT_ADJACENT");
    }
  }
  const transition = buildTransitionAtCut(
    { ...source, params: { ...getDefaultTransitionParams(source.type), ...source.params } },
    clipA,
    clipB,
    `transition-${genId()}`,
    typeof args.duration === "number" && args.duration > 0 ? { duration: args.duration } : {},
  );
  const error = await dispatch(host, "transition/set", { transition });
  return error ?? ok(`${label} applied`, { transitionId: transition.id, type: transition.type, duration: transition.duration });
}


export const listTransitions = async (_args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> => {
      host.requireOpenProject();
      const library = (await libraryOf(host)?.list()) ?? [];
      const project = host.getProject();
      const maskTypes = new Set<string>(MASK_TRANSITION_TYPES);
      return ok(`${TRANSITION_TYPES.length} transition types, ${presetsOf(project).length} presets`, {
        types: TRANSITION_TYPES.map((type) => ({
          type,
          defaults: getDefaultTransitionParams(type),
          maskTransition: maskTypes.has(type),
        })),
        commonParams: COMMON_PARAMS,
        morphCut: MORPH_CUT_NOTE,
        maskTransitionParams: MASK_PARAMS,
        typeParams: GEOMETRY_PARAMS,
        presets: presetsOf(project).map(({ id, name, type, duration, params }) => ({ id, name, type, duration, params })),
        libraryPresets: library.map(({ id, name, type, duration, params }) => ({ id, name, type, duration, params })),
        defaultTransition: resolveDefaultTransition(project),
      });
    };

export const saveTransitionPreset = async (args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> => {
      host.requireOpenProject();
      const project = host.getProject();
      const toLibrary = args.scope === "library";
      const library = libraryOf(host);
      if (toLibrary && !library) return fail(NO_LIBRARY, "UNSUPPORTED");
      let source: { type: string; duration: number; params: Record<string, unknown> } | undefined;
      if (typeof args.transitionId === "string") {
        const existing = project.timeline.tracks.flatMap((track) => track.transitions).find((candidate) => candidate.id === args.transitionId);
        if (!existing) return fail(`Transition "${args.transitionId}" not found`, "INVALID_PARAMS");
        source = { type: existing.type, duration: existing.duration, params: existing.params };
      } else if (typeof args.type === "string" && typeof args.duration === "number") {
        const problem = validateTransitionParams(args.params);
        if (problem) return fail(problem, "INVALID_PARAMS");
        source = { type: args.type, duration: args.duration, params: (args.params as Record<string, unknown> | undefined) ?? {} };
      }
      if (!source) return fail("Pass transitionId, or type and duration", "INVALID_PARAMS");
      const created = createTransitionPreset({
        id: `tpreset-${genId()}`,
        name: typeof args.name === "string" ? args.name : "",
        ...source,
        params: { ...getDefaultTransitionParams(source.type as TransitionType), ...source.params },
      });
      if (!created.ok) return fail(created.error, "INVALID_PARAMS");
      if (toLibrary) {
        const saved = await library!.save(created.value.name, { type: created.value.type, duration: created.value.duration, params: created.value.params });
        return saved.ok ? ok(`preset "${created.value.name}" saved to the library`, { presetId: saved.id, scope: "library" }) : fail(saved.error, "INVALID_PARAMS");
      }
      if (presetsOf(project).some((preset) => preset.name.toLowerCase() === created.value.name.toLowerCase())) {
        return fail(`A preset named "${created.value.name}" already exists`, "INVALID_PARAMS");
      }
      const error = await dispatch(host, "transitionPreset/setLibrary", { presets: [...presetsOf(project), created.value] });
      return error ?? ok(`preset "${created.value.name}" saved`, { presetId: created.value.id });
    };

export const deleteTransitionPreset = async (args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> => {
      host.requireOpenProject();
      const project = host.getProject();
      const preset = presetsOf(project).find((candidate) => candidate.id === args.presetId);
      if (!preset) {
        const shared = (await libraryOf(host)?.list())?.find((candidate) => candidate.id === args.presetId);
        if (shared) {
          const removed = await libraryOf(host)!.remove(shared.id);
          return removed.ok ? ok(`preset "${shared.name}" deleted from the library`) : fail(removed.error);
        }
        return fail(`Preset "${String(args.presetId)}" not found`, "INVALID_PARAMS");
      }
      const current = project.defaultTransition;
      const detached = current?.presetId === preset.id ? (({ presetId: _unlinked, ...rest }) => rest)(current) : undefined;
      const error = await dispatch(host, "transitionPreset/setLibrary", {
        presets: presetsOf(project).filter((candidate) => candidate.id !== preset.id),
        ...(detached ? { defaultTransition: detached } : {}),
      });
      return error ?? ok(`preset "${preset.name}" deleted`);
    };

export const setDefaultTransition = async (args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> => {
      host.requireOpenProject();
      if (args.reset === true) {
        const error = await dispatch(host, "transitionPreset/setLibrary", { defaultTransition: null });
        return error ?? ok("default transition reset to Cross dissolve");
      }
      if (typeof args.presetId === "string") {
        const found = await findPreset(host, args.presetId);
        if (!found) return fail(`Preset "${args.presetId}" not found`, "INVALID_PARAMS");
        const preset = found.preset;
        const error = await dispatch(host, "transitionPreset/setLibrary", { defaultTransition: defaultFromPreset(preset, found.scope === "library" ? "global" : "project") });
        return error ?? ok(`default transition is now "${preset.name}"`);
      }
      if (typeof args.type === "string" && (TRANSITION_TYPES as readonly string[]).includes(args.type) && typeof args.duration === "number" && args.duration > 0 && args.duration <= 30) {
        const problem = validateTransitionParams(args.params);
        if (problem) return fail(problem, "INVALID_PARAMS");
        const params = { ...getDefaultTransitionParams(args.type as TransitionType), ...((args.params as Record<string, unknown> | undefined) ?? {}) };
        const error = await dispatch(host, "transitionPreset/setLibrary", { defaultTransition: { type: args.type, duration: args.duration, params } });
        return error ?? ok(`default transition is now ${args.type}`);
      }
      return fail("Pass presetId, or type and duration (0-30 s), or reset true", "INVALID_PARAMS");
    };

export const applyTransitionPreset = async (args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> => {
      host.requireOpenProject();
      const found = await findPreset(host, args.presetId);
      if (!found) return fail(`Preset "${String(args.presetId)}" not found`, "INVALID_PARAMS");
      return placeAtCut(host, found.preset, args, `preset "${found.preset.name}"`);
    };

export const applyDefaultTransition = async (args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> => {
      host.requireOpenProject();
      const fallback = resolveDefaultTransition(host.getProject());
      return placeAtCut(host, fallback, args, "default transition");
    };


export const exportTransitionPresets = async (_args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> => {
  const library = libraryOf(host);
  if (!library) return fail(NO_LIBRARY, "UNSUPPORTED");
  const text = await library.exportJson();
  return ok(`exported the preset library (${text.length} characters)`, { json: text });
};

export const importTransitionPresets = async (args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> => {
  const library = libraryOf(host);
  if (!library) return fail(NO_LIBRARY, "UNSUPPORTED");
  if (typeof args.json !== "string") return fail("Pass json: the text of an exported preset file", "INVALID_PARAMS");
  const result = await library.importJson(args.json);
  return result.ok ? ok(`imported ${result.added} preset(s), ${result.skipped} skipped`, { added: result.added, skipped: result.skipped }) : fail(result.error, "INVALID_PARAMS");
};

/** Every Morph Cut of the project with the state of its background analysis. */
export const getMorphCutStatus = async (_args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> => {
  host.requireOpenProject();
  const registry = getMorphCutRegistry();
  const rows = host
    .getProject()
    .timeline.tracks.flatMap((track) =>
      (track.transitions ?? [])
        .filter((transition) => transition.type === "morphCut")
        .map((transition) => {
          const state = registry.getState(transition.id);
          return {
            transitionId: transition.id,
            clipAId: transition.clipAId,
            clipBId: transition.clipBId,
            status: state.status,
            progress: state.progress,
            message: state.message || undefined,
            confidence: state.confidence,
            rendersAs: state.status === "ready" ? "morph" : "cross dissolve",
          };
        }),
    );
  return ok(rows.length === 0 ? "No Morph Cut transitions in this project" : `${rows.length} Morph Cut transition(s)`, { transitions: rows });
};
