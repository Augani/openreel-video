import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import type { Track } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
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

export function SourcePatch({
  hasVideo,
  hasAudio,
}: {
  hasVideo: boolean;
  hasAudio: boolean;
}) {
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const videoTracks = tracks.filter((t) => t.type === "video" || t.type === "image");
  const audioTracks = tracks.filter((t) => t.type === "audio");
  if (!hasVideo && !hasAudio) return null;
  return (
    <div className="flex items-center gap-3" role="group" aria-label="Source patch" data-testid="source-patch">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-3">Patch</span>
      {hasVideo && <PatchSelect kind="video" label="Patch source video to track" tracks={videoTracks} />}
      {hasAudio && <PatchSelect kind="audio" label="Patch source audio to track" tracks={audioTracks} />}
    </div>
  );
}
