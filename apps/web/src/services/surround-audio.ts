import { v4 as uuidv4 } from "uuid";
import { layoutSettingsPatch, type ChannelLayout, type SurroundPan } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * The sequence's audio channel layout (Stereo or 5.1). Layout and channel count
 * change together in one `project/updateSettings` action, so a single Undo
 * restores both.
 */
export function setSequenceChannelLayout(layout: ChannelLayout) {
  return useProjectStore.getState().updateSettings(layoutSettingsPatch(layout));
}

/** Position of a clip or a track in the 5.1 room; `null` removes it. One undoable action (a drag coalesces into one step). */
export function setSurroundPan(target: { clipId: string } | { trackId: string }, pan: SurroundPan | null) {
  return useProjectStore.getState().executeAction({
    id: uuidv4(),
    timestamp: Date.now(),
    type: "audio/setSurroundPan",
    params: { ...target, pan },
  });
}
