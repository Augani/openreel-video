import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleEngine } from "@openreel/core";
import { EditSharingPanel } from "./EditSharingPanel";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { useUIStore } from "../../../stores/ui-store";

beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine() });
  useProjectStore.getState().createNewProject("Sharing QA");
  useUIStore.setState({ selectedItems: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function selectTitle() {
  const store = useProjectStore.getState();
  const track = store.project.timeline.tracks.find(track => track.type === "text")!;
  const title = store.createTextClip(track.id, 4, "Selected title", 3)!;
  useUIStore.setState({ selectedItems: [{ id: title.id, type: "text-clip" }] });
}
function mount() {
  render(<EditSharingPanel disabled={false}/>);
  fireEvent.click(screen.getByRole("button", { name: "Edit JSON & reusable presets" }));
}

async function addMediaClip() {
  const store = useProjectStore.getState();
  useProjectStore.setState({ project: { ...store.project, mediaLibrary: { items: [{
    id: "media-qa", name: "fixture.mp4", type: "video", blob: new Blob(["fixture"]), fileHandle: null, thumbnailUrl: null, waveformData: null,
    metadata: { duration: 4, width: 640, height: 360, frameRate: 24, codec: "avc", sampleRate: 48000, channels: 2, fileSize: 7 },
  }] } } });
  const track = store.project.timeline.tracks.find(track => track.type === "video")!;
  await useProjectStore.getState().addClip(track.id, "media-qa", 0);
  const clip = useProjectStore.getState().project.timeline.tracks.find(item => item.id === track.id)!.clips[0];
  useUIStore.setState({ selectedItems: [{ id: clip.id, type: "clip" }] });
  return clip.id;
}

describe("portable edit sharing controls", () => {
  it.each([[1, 0.18, 0.18], [1, 18, 18], [2, 0.18, 18]])("applies preset v%s amount %s with one reversible edit", async (version, amount, expected) => {
    const clipId = await addMediaClip();
    const effects = () => useProjectStore.getState().project.timeline.tracks.flatMap(track => track.clips).find(clip => clip.id === clipId)!.effects;
    mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Edit or preset JSON" }), { target: { value: JSON.stringify({ format: "openreel-preset", version, name: "Grain look", effects: [{ id: "shared-grain", type: "grain", enabled: true, params: { amount, size: 1, colored: false } }] }) } });
    fireEvent.click(screen.getByRole("button", { name: "Apply preset JSON" }));
    await waitFor(() => expect(effects()).toHaveLength(1));
    expect(effects()[0]).toMatchObject({ type: "grain", params: { amount: expected, size: 1, colored: false } });
    expect(effects()[0].id).not.toBe("shared-grain");
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo edit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Undo edit" }));
    await waitFor(() => expect(effects()).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Redo edit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Redo edit" }));
    await waitFor(() => expect(effects()[0]?.params.amount).toBe(expected));
  });

  it("exports runtime grain as normalized preset v2 without changing the clip", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:preset"); static revokeObjectURL = revokeObjectURL; });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const clipId = await addMediaClip();
    await useProjectStore.getState().addVideoEffect(clipId, "grain", { amount: 18, colored: false });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Export preset" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Edit or preset JSON" })).not.toHaveValue(""));
    const exported = JSON.parse((screen.getByRole("textbox", { name: "Edit or preset JSON" }) as HTMLTextAreaElement).value);
    expect(exported.version).toBe(2);
    expect(exported.effects[0].params).toEqual({ amount: 0.18, colored: false });
    expect(useProjectStore.getState().project.timeline.tracks.flatMap(track => track.clips).find(clip => clip.id === clipId)!.effects[0].params.amount).toBe(18);
    expect(screen.queryByRole("alert")).toBeNull();
    // The download revokes its object URL a second later, on the URL implementation that created it (the global is restored before then).
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:preset"), { timeout: 2500 });
  });
  it.each(["undo", "redo"] as const)("does not report success when project %s fails", async direction => {
    selectTitle();
    if (direction === "redo") await useProjectStore.getState().undo();
    vi.spyOn(useProjectStore.getState(), direction).mockResolvedValue({ success: false, error: { code: "INVALID_PARAMS", message: "Could not restore the saved edit" } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: direction === "undo" ? "Undo edit" : "Redo edit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not restore the saved edit");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
