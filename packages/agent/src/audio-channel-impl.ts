import {
  buildSourceGroups,
  describeSourceGroup,
  isSourceLayoutPreset,
  patchLabel,
  resolveSourceChannelGroups,
  sameSourceLayout,
  sanitizeSourceLayout,
  sourceAudioShape,
  type SourceChannelGroup,
} from "@openreel/core/audio/source-channels";
import { sanitizeChannelMap } from "@openreel/core/audio/channel-map";
import type { MediaItemPatch } from "@openreel/core/actions/handlers/media-organize";
import { createEmptyTrack, resolveMultichannelSourceTracks, type TrackChoice } from "@openreel/core/editing/track-targeting";
import type { NewTrackPlacement } from "@openreel/core/editing/premiere-edits";
import { planSourceEdit, sourceDropError, type AudioChannelPlacement, type SourceComponent } from "@openreel/core/editing/source-edit";
import type { Project } from "@openreel/core/types/project";
import type { Track } from "@openreel/core/types/timeline";
import { commitPlan, round } from "./pro-edit-tools";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { ToolResult } from "./types";

/**
 * Multichannel source patching for agents: the channel layout of a media item (the audio clips an Insert / Overwrite /
 * Add to timeline makes out of it), a clip's channel map, and the Source monitor's A1..An patch indicators. The layout and
 * the clip map are ONE undo step each; the patch is editor state (no undo step), like set_source_patch.
 */

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const guarded =
  (run: (args: Record<string, unknown>, host: EditingHost) => Promise<ToolResult> | ToolResult): RegisteredTool["handler"] =>
  async (args, host) => {
    try {
      host.requireOpenProject();
      return await run(args, host);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Invalid request");
    }
  };

const describe = (groups: readonly SourceChannelGroup[], streams: number) =>
  groups.map((group, index) => ({ patch: patchLabel(index), stream: group.stream, format: group.map.format, sources: [...group.map.sources], description: describeSourceGroup(group, streams) }));

export const HANDLERS: Record<string, RegisteredTool["handler"]> = {
  set_source_channel_layout: guarded(async (args, host) => {
      const project = host.getProject();
      const wanted = Array.isArray(args.mediaIds) ? (args.mediaIds as unknown[]).filter((id): id is string => typeof id === "string") : [];
      if (typeof args.mediaId === "string") wanted.push(args.mediaId);
      if (!wanted.length) return fail("Give mediaId or mediaIds.");
      if (args.layout === undefined && args.groups === undefined) return fail('Give layout ("file", "mono", "stereo" or "5.1") or groups.');
      if (args.layout !== undefined && !isSourceLayoutPreset(args.layout)) return fail('layout must be "file", "mono", "stereo" or "5.1".');
      const custom =
        args.groups === undefined
          ? undefined
          : sanitizeSourceLayout(
              (Array.isArray(args.groups) ? args.groups : []).map((entry) => {
                const { stream, format, sources } = (entry ?? {}) as { stream?: unknown; format?: unknown; sources?: unknown };
                return { stream: stream ?? 0, map: { format, sources } };
              }),
            );
      if (args.groups !== undefined && !custom) return fail("groups needs at least one valid { stream, format, sources } entry.");
      const itemPatches: Record<string, MediaItemPatch> = {};
      const result: { mediaId: string; name: string; groups: ReturnType<typeof describe> }[] = [];
      for (const id of new Set(wanted)) {
        const item = project.mediaLibrary.items.find((candidate) => candidate.id === id);
        if (!item) return fail(`Media ID was not found: ${id}; use list_media`, "NOT_FOUND");
        if (item.type === "image") return fail(`"${item.name}" is an image; it has no audio channels.`);
        const shape = sourceAudioShape(item);
        const groups = custom ?? buildSourceGroups(args.layout as "file", shape);
        const own = buildSourceGroups("file", shape);
        // The file's own grouping is stored as "no layout", so a later file with more channels is not pinned to this one.
        itemPatches[id] = { channelLayout: sameSourceLayout(groups, own) ? null : groups } as MediaItemPatch;
        result.push({ mediaId: id, name: item.name, groups: describe(custom ? resolveAfter(item, custom) : groups, shape.streams) });
      }
      const outcome = await host.applyAction({ type: "media/organize", id: genId(), timestamp: Date.now(), params: { label: "Audio channels", itemPatches } });
      if (!outcome.success) return fail(outcome.error?.message ?? "The layout could not be set", outcome.error?.code ?? "ACTION_FAILED");
      return ok(
        `Set the channel layout of ${result.length} media item(s): ${result.map((r) => `${r.name} -> ${r.groups.length} audio clip(s)`).join(", ")}`,
        { items: result },
      );
    }),
  get_source_channel_layout: guarded((args, host) => {
      const item = host.getProject().mediaLibrary.items.find((candidate) => candidate.id === args.mediaId);
      if (!item) return fail("Media ID was not found; use list_media", "NOT_FOUND");
      const shape = sourceAudioShape(item);
      const groups = resolveSourceChannelGroups(item);
      return ok(`"${item.name}": ${shape.streams} audio stream(s), ${groups.length} audio clip(s) when placed`, {
        mediaId: item.id,
        streams: shape.streams,
        streamChannels: [...shape.streamChannels],
        custom: Boolean(item.channelLayout),
        groups: describe(groups, shape.streams),
      });
    }),
  set_clip_channel_map: guarded(async (args, host) => {
      const clipIds = Array.isArray(args.clipIds) ? (args.clipIds as unknown[]).filter((id): id is string => typeof id === "string") : [];
      if (typeof args.clipId === "string") clipIds.push(args.clipId);
      if (!clipIds.length) return fail("Give clipId or clipIds.");
      let map: ReturnType<typeof sanitizeChannelMap> | null = null;
      if (args.clear !== true) {
        map = sanitizeChannelMap(args.map) ?? null;
        if (!map) return fail("Give map { format: mono | stereo | 5.1, sources: [...] } or clear: true.");
      }
      const outcome = await host.applyAction({ type: "audio/setChannelMap", id: genId(), timestamp: Date.now(), params: { clipIds, map } });
      if (!outcome.success) return fail(outcome.error?.message ?? "The channel map could not be set", outcome.error?.code ?? "ACTION_FAILED");
      return ok(map ? `Set a ${map.format} channel map on ${clipIds.length} clip(s)` : `Cleared the channel map of ${clipIds.length} clip(s)`, { clipIds, map });
    }),
  set_source_channel_patch: guarded((args, host) => {
      const targeting = host.targeting;
      if (!targeting?.setChannelPatch || !targeting.setChannelEnabled) return fail("The source channel patch needs the live editor.", "UNSUPPORTED");
      if (typeof args.channel !== "number" || !Number.isInteger(args.channel) || args.channel < 1 || args.channel > 32) return fail("channel must be a whole number from 1 (A1) to 32.");
      const channel = args.channel - 1;
      if (args.trackId === undefined && args.enabled === undefined) return fail("Give trackId and/or enabled.");
      if (args.trackId !== undefined) {
        if (args.trackId === null) targeting.setChannelPatch(channel, null);
        else {
          const track = host.getProject().timeline.tracks.find((candidate) => candidate.id === args.trackId);
          if (!track) return fail("Track ID was not found; use list_tracks", "NOT_FOUND");
          if (track.type !== "audio" || track.locked) return fail("A source audio channel can only be patched to an unlocked audio track.");
          targeting.setChannelPatch(channel, track.id);
        }
      }
      if (typeof args.enabled === "boolean") targeting.setChannelEnabled(channel, args.enabled);
      const now = targeting.getState();
      return ok(`Source channel A${args.channel}: ${now.disabledChannels?.includes(channel) ? "off" : "on"}, patched to ${(channel === 0 ? now.sourcePatch.audio : now.channelPatches?.[channel]) ?? "automatic"}`, {
        channel: args.channel,
        enabled: !now.disabledChannels?.includes(channel),
        trackId: (channel === 0 ? now.sourcePatch.audio : now.channelPatches?.[channel]) ?? null,
      });
    }),
};

/** The groups a custom layout resolves to once fitted to the file's streams and channels. */
function resolveAfter(item: Parameters<typeof resolveSourceChannelGroups>[0], custom: readonly SourceChannelGroup[]): SourceChannelGroup[] {
  return resolveSourceChannelGroups({ ...item, channelLayout: custom });
}

/**
 * Insert / Overwrite of a source whose audio expands to several channel-group clips (multichannel source patching): the
 * picture on its track and one audio clip per ENABLED group, each on the track patched to it (the Source monitor's A1..An, set
 * with set_source_channel_patch), else the next free audio track, else a new one. Same resolver as the editor's Insert.
 */
export async function sourceEditMultichannel(
  mode: "insert" | "overwrite",
  host: EditingHost,
  media: Project["mediaLibrary"]["items"][number],
  options: {
    component: SourceComponent;
    trackId?: string;
    sourceIn?: number | null;
    sourceOut?: number | null;
    playhead: number;
    sequenceIn?: number;
    sequenceOut?: number;
  },
): Promise<ToolResult> {
  const project = host.getProject();
  const groups = resolveSourceChannelGroups(media);
  const state = host.targeting?.getState();
  const wantsPicture = media.type === "video" && options.component !== "audio";
  const explicit = typeof options.trackId === "string" ? project.timeline.tracks.find((t) => t.id === options.trackId) : undefined;
  if (typeof options.trackId === "string") {
    if (!explicit) return fail("Track ID was not found; use list_tracks", "NOT_FOUND");
    const refusal = sourceDropError(explicit, media, options.component);
    if (refusal) return fail(refusal, "INVALID_PARAMS");
  }
  const firstAudio = !wantsPicture && explicit ? explicit.id : state?.sourcePatch.audio;
  const resolved = resolveMultichannelSourceTracks(project, {
    mediaType: media.type === "audio" ? "audio" : "video",
    component: options.component,
    groupCount: groups.length,
    patch: {
      video: wantsPicture && explicit ? explicit.id : state?.sourcePatch.video,
      audio: firstAudio,
      channels: groups.map((_, channel) => (channel === 0 ? firstAudio : state?.channelPatches?.[channel])),
      disabledChannels: groups.map((_, channel) => state?.disabledChannels?.includes(channel) === true),
    },
    targetedTrackIds: state?.targetedTrackIds,
  });
  // New tracks are created one after another so they get distinct names and positions.
  let working = project;
  const realize = (choice: TrackChoice): { track: Track; created?: NewTrackPlacement } => {
    if (choice.kind === "existing") return { track: choice.track };
    const created = createEmptyTrack(working, choice.trackType, genId());
    const tracks = [...working.timeline.tracks];
    tracks.splice(created.index, 0, created.track);
    working = { ...working, timeline: { ...working.timeline, tracks } };
    return { track: created.track, created };
  };
  const primary = resolved.primary ? realize(resolved.primary) : undefined;
  const audio = resolved.audio.map(({ channel, choice }) => ({ channel, group: groups[channel], ...realize(choice) }));
  if (!audio.length && !wantsPicture) return fail("Every audio channel of this source is switched off in the source patch.", "INVALID_PARAMS");
  const first = primary ?? audio[0];
  const clipId = genId();
  const audioChannels: AudioChannelPlacement[] = audio.map((entry, index) => ({
    trackId: entry.track.id,
    clipId: !wantsPicture && index === 0 ? clipId : genId(),
    channel: entry.channel,
    group: entry.group,
    newTrack: entry.created,
  }));
  let planned: ReturnType<typeof planSourceEdit>["resolved"] | undefined;
  const outcome = await commitPlan(host, (current) => {
    const edit = planSourceEdit(current, {
      mode,
      media,
      trackId: first.track.id,
      clipId,
      operationId: genId(),
      sourceIn: options.sourceIn,
      sourceOut: options.sourceOut,
      playhead: options.playhead,
      sequenceIn: options.sequenceIn,
      sequenceOut: options.sequenceOut,
      component: options.component,
      newTrack: primary?.created,
      audioChannels,
    });
    planned = edit.resolved;
    return edit.plan;
  });
  if (!outcome.ok) return outcome.error;
  if (!outcome.plan.edits.length || !planned) return fail("Nothing to place.", "NO_CHANGE");
  const insert = mode === "insert";
  return ok(
    `${insert ? "Inserted" : "Overwrote with"} "${media.name}" ${round(planned.sourceIn)}-${round(planned.sourceOut)}s at ${round(planned.at)}s: ${wantsPicture ? "picture plus " : ""}${audioChannels.length} audio clip(s), one per enabled channel group (${planned.rule}; one undo step)`,
    {
      clipId,
      trackId: first.track.id,
      audioClips: audioChannels.map((entry) => ({ clipId: entry.clipId, trackId: entry.trackId, patch: `A${entry.channel + 1}` })),
      rule: planned.rule,
      startTime: round(planned.at),
      duration: round(planned.duration),
      sourceIn: round(planned.sourceIn),
      sourceOut: round(planned.sourceOut),
    },
  );
}

