import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILTER_PRESETS, type Clip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";
import { applyFilterPreset, clearFilterEffects, filterPresetEffectsForPreview, resolveFilterPreset, setFilterPresetIntensity } from "../../../services/filter-preset-application";
import { FilterPresetsPanel } from "./FilterPresetsPanel";
import { createEditPreset, parseEditPreset } from "@openreel/core/editing/portable-project";
import { EditingSession } from "../../../services/agent/editing-session";
import { executeEditingTool } from "../../../services/agent/editing-tools";

vi.mock("../../../bridges/effects-bridge", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../bridges/effects-bridge")>()),
  getEffectsBridge: () => ({ isInitialized: () => false }),
}));

const originalEffects = [{ id: "existing-blur", type: "blur", enabled: false, params: { radius: 22 } }];
function seedProject(type: "video" | "image" | "audio" = "video") {
  const store = useProjectStore.getState();
  store.createNewProject("Filter workflow");
  const project = useProjectStore.getState().project;
  const clip: Clip = { id: "clip", mediaId: "media", trackId: "main", startTime: 0, duration: 5, inPoint: 0, outPoint: 5, volume: 0.8,
    effects: structuredClone(originalEffects), audioEffects: [], keyframes: [],
    transform: { position: { x: 12, y: -24 }, scale: { x: 1.08, y: 1.08 }, anchor: { x: 0.5, y: 0.5 }, rotation: 3, opacity: 0.9 },
    colorGrading: { temperature: 12, lut: { size: 2, intensity: 0.6, data: Array.from({ length: 24 }, (_, index) => index * 10) } },
  };
  useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [{ id: "media", type, name: "source", blob: new Blob(["fixture"]), fileHandle: null, thumbnailUrl: null, waveformData: null,
    metadata: { duration: 5, width: 640, height: 360, frameRate: 24, codec: "avc", sampleRate: 48000, channels: 2, fileSize: 7 },
  }] }, timeline: { ...project.timeline, duration: 10, tracks: [{ id: "main", name: "Main", type: type === "image" ? "video" : type, locked: false, hidden: false, muted: false, solo: false, transitions: [], clips: [clip, { ...structuredClone(clip), id: "other", startTime: 5 }] }] } } });
  useUIStore.setState({ selectedItems: [{ id: "clip", type: "clip" }] });
}
const clip = () => useProjectStore.getState().getClip("clip")!;
const effects = () => clip().effects;
const projectId = () => useProjectStore.getState().project.id;
const noir = FILTER_PRESETS.find(preset => preset.name === "Film Noir")!;
async function applyNoir() {
  fireEvent.click(screen.getByRole("button", { name: "Apply Film Noir filter preset" }));
  await waitFor(() => expect(effects()).toHaveLength(5));
  await waitFor(() => expect(screen.getByRole("button", { name: "Edit Intensity value" })).toHaveTextContent("100%"));
}
async function enterIntensity(value: number) {
  fireEvent.click(screen.getByRole("button", { name: "Edit Intensity value" }));
  const input = screen.getByRole("textbox", { name: "Intensity value" });
  fireEvent.change(input, { target: { value: String(value) } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);
  await waitFor(() => expect(screen.getByRole("button", { name: "Edit Intensity value" })).toHaveTextContent(`${value}%`));
}
async function renderPanel() {
  render(<FilterPresetsPanel clipId="clip" />);
  // The looks grid is lazy-loaded; under a loaded machine the chunk can take longer than findBy's 1 s default.
  await screen.findByRole("button", { name: "Apply Film Noir filter preset" }, { timeout: 10_000 });
}
beforeEach(() => seedProject());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("looks grid presentation", () => {
  it("labels the category tabs, shows no raw effect ids, and marks a look selected only once applied", async () => {
    await renderPanel();
    for (const name of ["Cinematic", "Vintage", "Mood", "Color", "Stylized"]) {
      expect(screen.getByRole("tab", { name })).toHaveTextContent(name);
    }
    expect(screen.getByRole("tab", { name: "Cinematic" })).toHaveAttribute("aria-selected", "true");
    const group = screen.getByRole("tabpanel", { name: "Cinematic" });
    expect(group.textContent).not.toMatch(/\b(vignette|color-grade|saturation|brightness)\b/);
    expect(group.textContent).not.toMatch(/\+\d/);
    expect(group.textContent).toContain("Contrast, Saturation, Vignette");
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    await applyNoir();
    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName("Apply Film Noir filter preset");
    fireEvent.click(screen.getByRole("tab", { name: "Vintage" }));
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  });

  it("follows the ARIA tabs pattern: roving tabindex, arrow keys, controlled tabpanel", async () => {
    await renderPanel();
    const cinematic = screen.getByRole("tab", { name: "Cinematic" });
    const vintage = screen.getByRole("tab", { name: "Vintage" });
    expect(cinematic).toHaveAttribute("tabindex", "0");
    expect(vintage).toHaveAttribute("tabindex", "-1");
    expect(cinematic.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);
    fireEvent.keyDown(cinematic, { key: "ArrowRight" });
    expect(vintage).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(vintage);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Vintage");
    fireEvent.keyDown(vintage, { key: "ArrowLeft" });
    expect(cinematic).toHaveAttribute("aria-selected", "true");
  });

  it("keeps locked-track cards focusable (so they can still preview) but does not apply", async () => {
    useProjectStore.setState((state) => ({
      project: { ...state.project, timeline: { ...state.project.timeline, tracks: state.project.timeline.tracks.map((t) => ({ ...t, locked: true })) } },
    }));
    await renderPanel();
    const card = screen.getByRole("button", { name: "Apply Film Noir filter preset" });
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(card).not.toBeDisabled();
    fireEvent.click(card);
    expect(effects().some((e) => e.type === "grain")).toBe(false);
  });

  it("previews exactly the effects a preset applies", () => {
    const preview = filterPresetEffectsForPreview(noir);
    expect(preview.map((effect) => effect.type)).toEqual(noir.effects.map((effect) => effect.type));
    expect(preview.map((effect) => effect.params)).toEqual([
      { value: 0 }, { value: 1.4 }, { value: -5 },
      { amount: 40, midpoint: 0.4, roundness: 0.5, feather: 0.6 },
      { amount: 15, size: 1.5, roughness: 0.5, colored: false },
    ]);
  });
});

describe("filter preset workflows", () => {
  it.each([
    ["Film Noir", [
      ["saturation", { value: 0 }], ["contrast", { value: 1.4 }], ["brightness", { value: -5 }],
      ["vignette", { amount: 40, midpoint: 0.4, roundness: 0.5, feather: 0.6 }],
      ["grain", { amount: 15, size: 1.5, roughness: 0.5, colored: false }],
    ]],
    ["Blockbuster", [
      ["contrast", { value: 1.2 }], ["saturation", { value: 1.15 }], ["brightness", { value: 5 }],
      ["sharpen", { amount: 30, radius: 1, threshold: 10 }],
    ]],
  ])("replaces the stack with %s in one action and preserves unrelated clip features", async (name, expected) => {
    const definitions = JSON.stringify(FILTER_PRESETS);
    const before = structuredClone(clip());
    const other = structuredClone(useProjectStore.getState().getClip("other"));
    const replace = vi.spyOn(useProjectStore.getState(), "replaceVideoEffects");
    const historySize = useProjectStore.getState().actionHistory.getHistoryEntries().length;
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: `Apply ${name} filter preset` }));
    await waitFor(() => expect(effects()).toHaveLength(expected.length));
    expect(effects().map(effect => [effect.type, effect.params])).toEqual(expected);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().actionHistory.getHistoryEntries()).toHaveLength(historySize + 1);
    expect({ ...clip(), effects: before.effects }).toEqual(before);
    expect(useProjectStore.getState().getClip("other")).toEqual(other);
    expect(JSON.stringify(FILTER_PRESETS)).toBe(definitions);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(clip()).toEqual(before);
    expect(screen.queryByRole("slider", { name: "Intensity" })).not.toBeInTheDocument();
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(effects().map(effect => [effect.type, effect.params])).toEqual(expected);
    expect(screen.getByRole("button", { name: "Edit Intensity value" })).toHaveTextContent("100%");
  });

  it("groups a held keyboard adjustment into one Undo step", async () => {
    await renderPanel(); await applyNoir();
    const slider = screen.getByRole("slider", { name: "Intensity" });
    for (const value of [99, 98, 97]) {
      fireEvent.keyDown(slider, { key: "ArrowLeft" });
      await waitFor(() => expect(screen.getByRole("button", { name: "Edit Intensity value" })).toHaveTextContent(`${value}%`));
    }
    fireEvent.keyUp(slider, { key: "ArrowLeft" });
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(screen.getByRole("button", { name: "Edit Intensity value" })).toHaveTextContent("100%");
    expect(effects()).toHaveLength(5);
  });

  it("removes the full effect stack in one reversible step", async () => {
    await renderPanel(); await applyNoir(); await enterIntensity(50);
    const before = structuredClone(effects());
    fireEvent.click(screen.getByRole("button", { name: "Remove All Effects" }));
    await waitFor(() => expect(effects()).toEqual([]));
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(effects()).toEqual(before);
    expect(screen.getByRole("button", { name: "Edit Intensity value" })).toHaveTextContent("50%");
  });

  it("reports a failed replacement without success or partial changes", async () => {
    vi.spyOn(useProjectStore.getState(), "replaceVideoEffects").mockResolvedValue(false);
    const success = vi.spyOn(toast, "success"); const error = vi.spyOn(toast, "error");
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Apply Film Noir filter preset" }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(success).not.toHaveBeenCalled(); expect(effects()).toEqual(originalEffects);
    expect(screen.queryByRole("slider", { name: "Intensity" })).not.toBeInTheDocument();
  });

  it("disables filters on locked tracks and rejects a stale project target", async () => {
    useProjectStore.setState(state => ({ project: { ...state.project, timeline: { ...state.project.timeline, tracks: state.project.timeline.tracks.map(track => ({ ...track, locked: true })) } } }));
    await renderPanel();
    expect(screen.getByRole("button", { name: "Apply Film Noir filter preset" })).toHaveAttribute("aria-disabled", "true");
    await expect(applyFilterPreset(projectId(), "clip", noir)).rejects.toThrow(/Unlock/);
    await expect(clearFilterEffects(projectId(), "clip")).rejects.toThrow(/Unlock/);
    expect(effects()).toEqual(originalEffects);
    const oldId = projectId(); cleanup(); seedProject();
    await expect(applyFilterPreset(oldId, "clip", noir)).rejects.toThrow(/Select/);
    expect(effects()).toEqual(originalEffects);
  });

  it("shares a neutral preset with its exact identity and regenerates application IDs on import", async () => {
    const selection = await applyFilterPreset(projectId(), "clip", noir);
    const full = effects().map(effect => structuredClone(effect.params));
    await setFilterPresetIntensity(projectId(), "clip", selection, 0);
    const exported = createEditPreset({ name: "Neutral Noir", effects: effects() });
    const source = exported.effects[0].metadata!.filterPreset!;
    const input = JSON.stringify(exported);
    await clearFilterEffects(projectId(), "clip");
    const session = new EditingSession(); const transaction = session.beginTransaction();
    const result = await executeEditingTool("apply_edit_preset", { clipId: "clip", preset: parseEditPreset(input) }, session);
    expect(result.ok, result.error?.message).toBe(true);
    await session.commitTransaction(transaction, "Import filter");
    const restored = resolveFilterPreset(useProjectStore.getState().getVideoEffects("clip"));
    expect(restored).toMatchObject({ presetId: noir.id, intensity: 0 });
    expect(effects()[0].metadata!.filterPreset!.applicationId).not.toBe(source.applicationId);
    expect(new Set(effects().map(effect => effect.metadata!.filterPreset!.applicationId)).size).toBe(1);
    expect(JSON.stringify(exported)).toBe(input);
    await setFilterPresetIntensity(projectId(), "clip", restored!, 100);
    expect(effects().map(effect => effect.params)).toEqual(full);
  });
});
