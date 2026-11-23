import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import {
  describeSourceGroup,
  patchLabel,
  resolveSourceChannelGroups,
  sourceAudioShape,
  type MediaItem,
  type Track,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { openSourceChannelsFor } from "../../services/audio-channels";
import {
  useEditorWorkspaceStore,
  type TargetKind,
} from "../../stores/editor-workspace-store";

/**
 * Premiere-style source patch indicators for the Source monitor: which timeline
 * track receives the source's video and which receives its audio. "Auto" leaves
 * the choice to targeting, the selected track and the main track. Patching both
 * the video and the audio of a video source to different tracks places two
 * linked clips on Insert / Overwrite.
 *
 * A source that expands to several audio clips (an 8-mono WAV, a MOV with two stereo tracks, a layout from Modify >
 * Audio Channels) shows one indicator per audio clip, A1..An: each can be patched to any audio track, or switched off
 * so Insert / Overwrite skip it. The same indicators show in the timeline track headers.
 */
const AUTO = "__auto__";

function PatchSelect({
  kind,
  label,
  tracks,
}: {
  kind: TargetKind;
  label: string;
  tracks: Track[];
}) {
  const patched = useEditorWorkspaceStore((state) => state.targetTracks[kind]);
  const setSourcePatch = useEditorWorkspaceStore((state) => state.setSourcePatch);
  const value = patched && tracks.some((track) => track.id === patched) ? patched : AUTO;
  const letter = kind === "video" ? "V" : "A";
  return (
    <div className="flex items-center gap-1.5" data-source-patch={kind} data-patched={value === AUTO ? undefined : "true"}>
      <span
        aria-hidden
        className={`flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 text-[9px] font-black leading-none ${
          value === AUTO ? "border border-border text-fg-muted" : "bg-accent text-accent-fg"
        }`}
      >
        {letter}
      </span>
      <Select
        value={value}
        onValueChange={(next) => setSourcePatch(kind, next === AUTO ? null : next)}
      >
        <SelectTrigger
          aria-label={label}
          data-testid={`source-patch-${kind}`}
          className="h-6 w-[112px] px-2 text-[11px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>Auto</SelectItem>
          {tracks.map((track) => (
            <SelectItem key={track.id} value={track.id} disabled={track.locked}>
              {track.name}
              {track.locked ? " (locked)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ChannelPatch({
  channel,
  label,
  tracks,
}: {
  channel: number;
  label: string;
  tracks: Track[];
}) {
  const patched = useEditorWorkspaceStore((state) => (channel === 0 ? state.targetTracks.audio : state.channelPatches[channel]));
  const enabled = useEditorWorkspaceStore((state) => !state.disabledChannels.includes(channel));
  const setChannelPatch = useEditorWorkspaceStore((state) => state.setChannelPatch);
  const setChannelEnabled = useEditorWorkspaceStore((state) => state.setChannelEnabled);
  const value = patched && tracks.some((track) => track.id === patched) ? patched : AUTO;
  const name = patchLabel(channel);
  return (
    <div className="flex items-center gap-1.5" data-source-patch-channel={channel} data-enabled={enabled ? "true" : "false"} data-patched={value === AUTO ? undefined : "true"}>
      <button
        type="button"
        aria-pressed={enabled}
        aria-label={`${enabled ? "Disable" : "Enable"} source ${name}`}
        title={`${name}: ${label}. Click to ${enabled ? "switch off (Insert / Overwrite skip it)" : "switch on"}`}
        data-testid={`source-patch-channel-toggle-${channel}`}
        onClick={() => setChannelEnabled(channel, !enabled)}
        className={`flex h-[18px] min-w-[26px] items-center justify-center rounded px-1 text-[9px] font-black leading-none ${
          !enabled ? "border border-dashed border-border text-fg-3 line-through" : value === AUTO ? "border border-border text-fg-muted" : "bg-accent text-accent-fg"
        }`}
      >
        {name}
      </button>
      <Select value={value} disabled={!enabled} onValueChange={(next) => setChannelPatch(channel, next === AUTO ? null : next)}>
        <SelectTrigger aria-label={`Patch source ${name} to track`} title={label} data-testid={channel === 0 ? "source-patch-audio" : `source-patch-audio-${channel}`} className="h-6 w-[104px] px-2 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>Auto</SelectItem>
          {tracks.map((track) => (
            <SelectItem key={track.id} value={track.id} disabled={track.locked}>
              {track.name}
              {track.locked ? " (locked)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SourcePatch({
  hasVideo,
  hasAudio,
  media,
}: {
  hasVideo: boolean;
  hasAudio: boolean;
  media?: MediaItem | null;
}) {
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const videoTracks = tracks.filter((t) => t.type === "video" || t.type === "image");
  const audioTracks = tracks.filter((t) => t.type === "audio");
  const groups = hasAudio && media ? resolveSourceChannelGroups(media) : [];
  const streams = media ? sourceAudioShape(media).streams : 1;
  if (!hasVideo && !hasAudio) return null;
  if (groups.length > 1 && media) {
    return (
      <div className="flex w-full flex-col gap-1.5" role="group" aria-label="Source patch" data-testid="source-patch" data-multichannel={groups.length}>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-3">Patch</span>
          {hasVideo && <PatchSelect kind="video" label="Patch source video to track" tracks={videoTracks} />}
          <button
            type="button"
            data-testid="source-patch-channels"
            onClick={() => openSourceChannelsFor([media.id])}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-2 hover:border-border-strong"
            title="Modify > Audio Channels: how this source's channels group into audio clips"
          >
            {groups.length} audio clips
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-4" data-testid="source-patch-channels-grid">
          {groups.map((group, channel) => (
            <ChannelPatch key={channel} channel={channel} label={describeSourceGroup(group, streams)} tracks={audioTracks} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3" role="group" aria-label="Source patch" data-testid="source-patch">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-3">Patch</span>
      {hasVideo && <PatchSelect kind="video" label="Patch source video to track" tracks={videoTracks} />}
      {hasAudio && <PatchSelect kind="audio" label="Patch source audio to track" tracks={audioTracks} />}
      {hasAudio && media && (
        <button
          type="button"
          data-testid="source-patch-channels"
          onClick={() => openSourceChannelsFor([media.id])}
          className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-2 hover:border-border-strong"
          title="Modify > Audio Channels: how this source's channels group into audio clips"
        >
          Channels
        </button>
      )}
    </div>
  );
}
