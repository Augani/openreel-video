import * as React from "react";
import { useProjectStore } from "../../../stores/project-store";
import { KeyframableControl } from "./KeyframableControl";

export interface ClipVolumeSectionProps {
  clipId: string;
}

export const ClipVolumeSection: React.FC<ClipVolumeSectionProps> = ({
  clipId,
}) => {
  const volume = useProjectStore((s) => s.getClip(clipId)?.volume ?? 1);
  const setClipVolume = useProjectStore((s) => s.setClipVolume);

  return (
    <KeyframableControl
      clipId={clipId}
      property="audio.volume"
      displayScale={1}
      label="Volume"
      value={volume}
      onChange={(next) => setClipVolume(clipId, next)}
      min={0}
      max={2}
      step={0.01}
    />
  );
};
