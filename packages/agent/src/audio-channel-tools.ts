import { SOURCE_LAYOUT_PRESETS } from "@openreel/core/audio/source-channels";
import type { RegisteredTool } from "./registry";
import type { JSONSchema } from "./types";

/**
 * Multichannel source patching for agents: the channel layout of a media item, a clip's channel map and the Source monitor's
 * A1..An patch. Definitions only; the handlers load on first call (audio-channel-impl.ts) so they stay out of the agent chunk.
 * The layout and the clip map are ONE undo step each; the patch is editor state (no undo step), like set_source_patch.
 */
const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const bool: JSONSchema = { type: "boolean" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const MAP_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["mono", "stereo", "5.1"] },
    sources: { type: "array", items: num, description: "Source channel per output channel: 0-based channel, -1 silent, -2 mix of all." },
  },
  required: ["format", "sources"],
};
const lazy =
  (name: string): RegisteredTool["handler"] =>
  async (args, host) => {
    const { HANDLERS } = await import("./audio-channel-impl");
    return HANDLERS[name](args, host);
  };

export const AUDIO_CHANNEL_TOOLS: RegisteredTool[] = [
  {
    name: "set_source_channel_layout",
    domain: "media",
    title: "Set source channel layout",
    description:
      'Set how a media item\'s audio is split into clips when placed (Modify > Audio Channels on a project item); each group is one audio clip and one patch indicator (A1..An). layout: "file" (own grouping per stream: mono/stereo/5.1 stream = one clip, other widths = one mono clip per channel), "mono", "stereo" (pairs) or "5.1". Or groups: [{stream, format: mono|stereo|5.1, sources: [source channel per output channel]}] (0-based; streams left out are not placed). Applies to mediaIds (or mediaId). One undo step.',
    inputSchema: obj({
      mediaId: str,
      mediaIds: { type: "array", items: str },
      layout: { type: "string", enum: [...SOURCE_LAYOUT_PRESETS] },
      groups: { type: "array", items: obj({ stream: num, format: { type: "string", enum: ["mono", "stereo", "5.1"] }, sources: { type: "array", items: num } }, ["format", "sources"]) },
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: lazy("set_source_channel_layout"),
  },
  {
    name: "get_source_channel_layout",
    domain: "read",
    title: "Get source channel layout",
    description: "Read a media item's audio streams (channels per stream) and the groups, one clip each, it expands to.",
    inputSchema: obj({ mediaId: str }, ["mediaId"]),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: lazy("get_source_channel_layout"),
  },
  {
    name: "set_clip_channel_map",
    domain: "clip",
    title: "Set clip channel map",
    description:
      'Set or clear what an audio clip plays from its file: map {format: mono|stereo|5.1, sources: [source channel per output channel; -1 silent, -2 mix of all]}, or clear: true. Applies to clipIds. One undo step.',
    inputSchema: obj({ clipIds: { type: "array", items: str }, clipId: str, map: MAP_SCHEMA, clear: bool }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: lazy("set_clip_channel_map"),
  },
  {
    name: "set_source_channel_patch",
    domain: "track",
    title: "Set source channel patch",
    description:
      "Patch audio channel group `channel` (1 = A1) of a multichannel source to an audio track (trackId, null = automatic) and/or switch it off (enabled false). insert_from_source / overwrite_from_source place one clip per enabled group. Editor state, no undo step. Live editor only.",
    inputSchema: obj({ channel: num, trackId: { type: ["string", "null"] }, enabled: bool }, ["channel"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: lazy("set_source_channel_patch"),
  },
];
