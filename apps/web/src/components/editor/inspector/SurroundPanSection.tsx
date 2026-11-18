import React from "react";
import { getChannelLayout, resolveSurroundPan } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { SurroundPanner } from "../../audio-mixer/SurroundPanner";
import { setSurroundPan } from "../../../services/surround-audio";

/**
 * Clip-level surround position (5.1 sequences). A clip without its own position
 * follows its track's; moving the puck gives the clip its own, and "Follow track"
 * removes it again. 5.1 sources are not panned (they already are a layout).
 */
export const SurroundPanSection: React.FC<{ clipId: string }> = ({ clipId }) => {
  const surround = useProjectStore((state) => getChannelLayout(state.project.settings) === "5.1");
  const located = useProjectStore((state) => {
    for (const track of state.project.timeline.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (clip) return { clip, track };
    }
    return undefined;
  });
  const sourceChannels = useProjectStore((state) => {
    const clip = state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    return state.project.mediaLibrary.items.find((item) => item.id === clip?.mediaId)?.metadata.channels;
  });
  if (!surround || !located) return null;
  const { clip, track } = located;
  const own = clip.surroundPan !== undefined;
  return (
    <div className="flex flex-col gap-2 p-1" data-testid="clip-surround-section">
      <SurroundPanner
        label={`${clip.id} surround pan`}
        testId={`surround-clip-${clip.id}`}
        pan={resolveSurroundPan(clip, track)}
        source={own ? "Clip" : "Track"}
        onChange={(next) => void setSurroundPan({ clipId: clip.id }, next)}
        onReset={own ? () => void setSurroundPan({ clipId: clip.id }, null) : undefined}
      />
      {sourceChannels !== undefined && sourceChannels >= 3 && (
        <p className="text-[10px] text-fg-muted" data-testid="clip-surround-passthrough">
          This source has {sourceChannels} channels. A 5.1 source plays on its own channels and is not positioned by the panner.
        </p>
      )}
    </div>
  );
};
