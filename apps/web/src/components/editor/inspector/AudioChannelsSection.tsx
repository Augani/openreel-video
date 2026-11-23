import React, { useMemo } from "react";
import { describeChannelMap, resolveClipChannelMap } from "@openreel/core";
import { Button } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { buildClipIndex } from "../../../utils/clip-index";
import { openAudioChannelsForSelection, setClipChannelMap } from "../../../services/audio-channels";

/**
 * Modify > Audio Channels for the inspector: shows what the clips play from their file and opens the mapping
 * dialog. A multi-selection lists "Mixed" when the clips differ.
 */
export const AudioChannelsSection: React.FC<{ clipIds: readonly string[] }> = ({ clipIds }) => {
  const project = useProjectStore((state) => state.project);
  const rows = useMemo(() => {
    const index = buildClipIndex(project.timeline.tracks);
    const items = new Map(project.mediaLibrary.items.map((item) => [item.id, item] as const));
    return clipIds.flatMap((id) => {
      const clip = index.clips.get(id);
      const media = clip && items.get(clip.mediaId);
      return clip && media ? [{ clip, media }] : [];
    });
  }, [clipIds, project]);
  if (rows.length === 0) return null;
  const labels = new Set(rows.map(({ clip, media }) => describeChannelMap(resolveClipChannelMap(clip, media), media.metadata.channels || 2)));
  const label = labels.size === 1 ? [...labels][0] : "Mixed";
  const custom = rows.some(({ clip }) => clip.channelMap !== undefined);
  return (
    <div className="flex flex-col gap-2 p-1" data-testid="audio-channels-section">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs" data-testid="audio-channels-current">{label}</span>
        <div className="flex shrink-0 gap-1">
          {custom && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" data-testid="audio-channels-reset" onClick={() => { void setClipChannelMap(clipIds, null); }}>Reset</Button>
          )}
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" data-testid="audio-channels-open" onClick={() => openAudioChannelsForSelection(clipIds)}>Modify…</Button>
        </div>
      </div>
      <p className="text-[11px] text-fg-muted">Choose which source channels the clip plays: left only, swap, mono or 5.1.</p>
    </div>
  );
};
