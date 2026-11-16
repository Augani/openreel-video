import type { Project, Sequence } from "@openreel/core/types/project";
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import {
  activateSequence,
  countSequenceInstances,
  createSequence,
  createSequenceFromMedia,
  ensureSequences,
  listSequences,
  nestClips,
  sequenceContentDuration,
  type SequenceEditResult,
} from "@openreel/core/timeline/sequences";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Multi-sequence tools. Each call computes the next project with the pure
 * functions in core/timeline/sequences and commits it as ONE
 * `project/applyEditSnapshot` action, so it is exactly one undo step and goes
 * through the same code the editor's sequence tabs use.
 */
export const str: JSONSchema = { type: "string" };
export const num: JSONSchema = { type: "number" };
export const bool: JSONSchema = { type: "boolean" };
export const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
export const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
export const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function describeSequence(project: Project, sequence: Sequence) {
  return {
    id: sequence.id,
    name: sequence.name,
    active: sequence.id === project.activeSequenceId,
    open: (project.openSequenceIds ?? []).includes(sequence.id),
    width: sequence.settings.width,
    height: sequence.settings.height,
    fps: sequence.settings.frameRate,
    sampleRate: sequence.settings.sampleRate,
    durationSec: sequenceContentDuration(sequence.timeline),
    trackCount: sequence.timeline.tracks.length,
    clipCount: sequence.timeline.tracks.reduce((sum, track) => sum + track.clips.length, 0),
    nestedInstances: countSequenceInstances(project, sequence.id),
  };
}

function resolveSequence(project: Project, ref: unknown): Sequence {
  if (typeof ref !== "string" || !ref) throw new Error("sequence must be a sequence id or name.");
  const all = listSequences(project);
  const byId = all.find((s) => s.id === ref);
  if (byId) return byId;
  const byName = all.filter((s) => s.name.toLowerCase() === ref.toLowerCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new Error(`More than one sequence is named "${ref}"; use its id.`);
  throw new Error(`No sequence "${ref}". Use list_sequences to see ids.`);
}

type Committed = { readonly failure: ToolResult } | { readonly failure?: undefined; readonly result: Extract<SequenceEditResult, { ok: true }> };

/**
 * Compute and commit one sequence edit. On the live editor this goes through the
 * same command the UI uses, so switching sequences parks the In/Out range and
 * playhead exactly like a tab click; headless hosts commit the snapshot directly.
 */
export async function commit(host: EditingHost, label: string, build: (project: Project) => SequenceEditResult): Promise<Committed> {
  if (host.sequenceCommands) {
    const result = await host.sequenceCommands.commit(label, build);
    return result.ok ? { result } : { failure: fail(result.message) };
  }
  const result = build(ensureSequences(host.getProject()));
  if (!result.ok) return { failure: fail(result.message) };
  const applied = await host.applyAction({
    type: "project/applyEditSnapshot",
    id: genId(),
    timestamp: Date.now(),
    params: { snapshot: editSnapshot(result.project) },
  });
  return applied.success ? { result } : { failure: fail(applied.error?.message ?? "The change failed", applied.error?.code ?? "ACTION_FAILED") };
}

export const guarded =
  (run: (args: Record<string, unknown>, host: EditingHost) => Promise<ToolResult> | ToolResult): RegisteredTool["handler"] =>
  async (args, host) => {
    try {
      host.requireOpenProject();
      return await run(args, host);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Invalid request");
    }
  };

const positive = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !(value > 0) || !Number.isFinite(value)) throw new Error(`${name} must be a positive number.`);
  return value;
};

export const SEQUENCE_TOOLS: RegisteredTool[] = [
  {
    name: "list_sequences",
    domain: "project",
    title: "List sequences",
    description:
      "List the project's sequences (timelines) with id, name, canvas settings, duration, which one is active (the one every other tool edits), which have an open tab, and how many times each is nested in other sequences.",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((_args, host) => {
      const project = ensureSequences(host.getProject());
      const sequences = listSequences(project).map((s) => describeSequence(project, s));
      return ok(`${sequences.length} sequence(s)`, { activeSequenceId: project.activeSequenceId, sequences });
    }),
  },
  {
    name: "create_sequence",
    domain: "project",
    title: "Create sequence",
    description:
      'Create a new sequence and open it (it becomes the active timeline). Give "name" and optional "width", "height", "fps", "sampleRate" (default: the current sequence\'s settings), or "fromMediaId" to match a media item\'s size and frame rate with that clip placed at 0 (New Sequence From Clip). Pass "activate": false to leave the current sequence open. One undo step.',
    inputSchema: obj({ name: str, width: num, height: num, fps: num, sampleRate: num, fromMediaId: str, activate: bool }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = ensureSequences(host.getProject());
      const name = typeof args.name === "string" ? args.name : undefined;
      let build: (p: Project) => SequenceEditResult;
      if (typeof args.fromMediaId === "string") {
        const mediaId = args.fromMediaId;
        build = (p) => createSequenceFromMedia(p, mediaId, name);
      } else {
        const width = positive(args.width, "width");
        const height = positive(args.height, "height");
        const frameRate = positive(args.fps, "fps");
        const sampleRate = positive(args.sampleRate, "sampleRate");
        build = (p) => createSequence(p, {
          name,
          settings: {
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
            ...(frameRate ? { frameRate } : {}),
            ...(sampleRate ? { sampleRate } : {}),
          },
          activate: args.activate !== false,
        });
      }
      void project;
      const committed = await commit(host, "New sequence", build);
      if (committed.failure) return committed.failure;
      const { result } = committed;
      const next = ensureSequences(host.getProject());
      const created = result.sequenceId ? listSequences(next).find((s) => s.id === result.sequenceId) : undefined;
      return ok(`Created sequence "${created?.name ?? name ?? "Sequence"}"`, created ? describeSequence(next, created) : undefined);
    }),
  },
  {
    name: "open_sequence",
    domain: "project",
    title: "Open sequence",
    description:
      'Open a sequence (id or name) in its own tab and make it the active timeline: every later edit, preview and export acts on it. Use to edit inside a nest ("clipId" of a nest clip also works). Undoing steps back to the previously open sequence.',
    inputSchema: obj({ sequence: str, clipId: str }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = ensureSequences(host.getProject());
      let target: Sequence;
      if (typeof args.clipId === "string" && args.sequence === undefined) {
        const clip = project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === args.clipId);
        if (!clip) throw new Error(`Clip not found: ${args.clipId}`);
        const id =
          typeof clip.metadata?.compoundClipId === "string"
            ? clip.metadata.compoundClipId
            : clip.mediaId.startsWith("compound:")
              ? clip.mediaId.slice("compound:".length)
              : null;
        if (!id) throw new Error("That clip is not a nested sequence.");
        target = resolveSequence(project, id);
      } else {
        target = resolveSequence(project, args.sequence);
      }
      if (target.id === project.activeSequenceId && (project.openSequenceIds ?? []).includes(target.id)) {
        return ok(`"${target.name}" is already the active sequence`, describeSequence(project, target));
      }
      const committed = await commit(host, "Open sequence", (p) => activateSequence(p, target.id));
      if (committed.failure) return committed.failure;
      const next = ensureSequences(host.getProject());
      return ok(`Opened sequence "${target.name}"`, describeSequence(next, listSequences(next).find((s) => s.id === target.id) ?? target));
    }),
  },
  {
    name: "nest_clips",
    domain: "project",
    title: "Nest clips",
    description:
      'Nest the given items (clip ids from list_clips on the active sequence; text/shape/sticker/SVG overlay and adjustment-layer ids also work) into a new sequence and replace them with one nest clip over the same span (Premiere\'s "Nest..."). Linked audio, transitions between the nested clips, masks, keyframes, effects, and the captions and markers inside the span travel with them. Optional "name". Editing inside the nest later updates every instance. Refused when a selected track is locked or the nest would overlap other clips. One undo step.',
    inputSchema: obj({ clipIds: { type: "array", items: str }, name: str }, ["clipIds"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      if (!Array.isArray(args.clipIds) || args.clipIds.some((id) => typeof id !== "string"))
        throw new Error("clipIds must be an array of clip id strings.");
      const project = ensureSequences(host.getProject());
      void project;
      const nestName = typeof args.name === "string" ? args.name : undefined;
      const ids = args.clipIds as string[];
      const committed = await commit(host, "Nest clips", (p) => nestClips(p, ids, nestName));
      if (committed.failure) return committed.failure;
      const { result } = committed;
      const next = ensureSequences(host.getProject());
      const created = result.sequenceId ? listSequences(next).find((s) => s.id === result.sequenceId) : undefined;
      return ok(`Nested ${ids.length} clip(s) into "${created?.name}"`, {
        sequence: created ? describeSequence(next, created) : undefined,
        nestClipId: result.clipId,
      });
    }),
  },
];
