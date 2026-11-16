import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { openContextMenu } from "../../../test/open-context-menu";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { TitleEngine } from "@openreel/core";
import { useEngineStore } from "../../../stores/engine-store";
import { GraphicsClipContextMenu } from "./GraphicsClipContextMenu";

describe("caption context-menu selection", () => {
  afterEach(() => { cleanup(); useUIStore.getState().clearSelection(); });
  it("does not let the real caption menu click clear its new selection", async () => {
    useEngineStore.setState({ titleEngine: new TitleEngine() });
    useProjectStore.getState().createNewProject("Caption menu");
    const state = useProjectStore.getState();
    const track = state.project.timeline.tracks[0];
    state.createTextClip(track.id, 0, "First", 2, undefined, { captionSource: "test" });
    useProjectStore.getState().createTextClip(track.id, 2, "Second", 2);
    const clips = useProjectStore.getState().getAllTextClips();
    openContextMenu(<GraphicsClipContextMenu clip={clips[0]} clipType="text" />, () => useUIStore.getState().clearSelection());
    fireEvent.click(screen.getByRole("menuitem", { name: "Select All Captions" }));
    expect(useUIStore.getState().selectedItems.map(item => item.id)).toEqual(clips.map(clip => clip.id));
  });
});
