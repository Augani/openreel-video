import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_STYLE,
  TitleEngine,
  getMotionShaderEffectDefs,
  getMotionShaderFillDefs,
  getMotionShaderTextDefs,
} from "@openreel/core";
import { WorkspaceTextPanel } from "./WorkspaceTextPanel";
import { createDefaultEditorShader } from "./inspector/ShaderControls";
import { useProjectStore } from "../../stores/project-store";
import { useEngineStore } from "../../stores/engine-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";

const storageKey = "openreel-saved-text-styles";
const materials = [
  ...getMotionShaderTextDefs(),
  ...getMotionShaderFillDefs(),
  ...getMotionShaderEffectDefs(),
];
const panel = () => (
  <WorkspaceTextPanel presets={[]} defaultStyle={{ fontSize: 96, fontWeight: 800 }} />
);

beforeEach(() => {
  localStorage.removeItem(storageKey);
  useEngineStore.setState({ titleEngine: new TitleEngine() });
  useProjectStore.getState().createNewProject("Text preservation");
  useProjectStore.getState().actionHistory.clear();
  useEditorWorkspaceStore.setState({ textSource: "text", mobileCaptionsOpen: false });
  useTimelineStore.setState({ playheadPosition: 0, playbackLockedReason: null });
  useUIStore.getState().clearSelection();
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(storageKey);
  useProjectStore.getState().actionHistory.clear();
});

describe("Text library preservation", () => {
  it("retains more than sixty saved styles through reload and append, and keeps every style reachable", async () => {
    const stored = Array.from({ length: 61 }, (_, i) => ({
      name: `Saved style ${i}`,
      text: `Text ${i}`,
      style: { ...DEFAULT_TEXT_STYLE, letterSpacing: i / 10 },
    }));
    localStorage.setItem(storageKey, JSON.stringify(stored));
    const view = render(panel());
    fireEvent.click(view.getByRole("button", { name: "Add plain text" }));
    await waitFor(() => expect(useProjectStore.getState().getAllTextClips()).toHaveLength(1));
    fireEvent.mouseDown(view.getByRole("tab", { name: "Saved styles" }), { button: 0, ctrlKey: false });
    expect(view.getAllByRole("button", { name: /^Saved style \d+$/ }).length).toBeLessThan(stored.length);
    expect(view.getByRole("button", { name: "Saved style 60" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Save selected text style" }));
    expect(view.getByRole("button", { name: "New Title" })).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem(storageKey)!);
    expect(saved).toHaveLength(62);
    expect(saved.slice(0, 61)).toEqual(stored);
    while (view.queryByRole("button", { name: "Load more styles" })) {
      fireEvent.click(view.getByRole("button", { name: "Load more styles" }));
    }
    for (const entry of stored) expect(view.getByRole("button", { name: entry.name })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Delete saved style Saved style 60" }));
    const afterDelete = JSON.parse(localStorage.getItem(storageKey)!);
    expect(afterDelete).toHaveLength(61);
    expect(afterDelete.slice(0, 60)).toEqual(stored.slice(0, 60));
  });

  it.each(materials.slice(0, 3))("saves, reloads and inserts the complete $name material with Undo/Redo", async (material) => {
    const shader = { ...createDefaultEditorShader(material.id)!, progress: 0.37 };
    const view = render(panel());
    fireEvent.click(view.getByRole("button", { name: "Add plain text" }));
    await waitFor(() => expect(useProjectStore.getState().getAllTextClips()).toHaveLength(1));
    const original = useProjectStore.getState().getAllTextClips()[0];
    await act(async () => {
      await useProjectStore.getState().updateTextStyle(original.id, { shader });
    });
    const expected = useProjectStore.getState().getTextClip(original.id)!.style;
    expect(expected.shader).toEqual(shader);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Saved styles" }), { button: 0, ctrlKey: false });
    fireEvent.click(view.getByRole("button", { name: "Save selected text style" }));
    expect(JSON.parse(localStorage.getItem(storageKey)!)[0].style).toEqual(expected);
    view.unmount();

    const reloaded = render(panel());
    useProjectStore.getState().actionHistory.clear();
    fireEvent.click(reloaded.getByRole("button", { name: "New Title" }));
    await waitFor(() => expect(useProjectStore.getState().getAllTextClips()).toHaveLength(2));
    const inserted = useProjectStore.getState().getAllTextClips().find((clip) => clip.id !== original.id)!;
    expect(inserted.style).toEqual(expected);
    const entries = useProjectStore.getState().actionHistory.getHistoryEntries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => !!entry.groupId)).toBe(true);
    expect(new Set(entries.map((entry) => entry.groupId)).size).toBe(1);
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(1);
    expect(useProjectStore.getState().getTextClip(original.id)!.style).toEqual(expected);
    await act(async () => { expect((await useProjectStore.getState().redo()).success).toBe(true); });
    expect(useProjectStore.getState().getAllTextClips().find((clip) => clip.id !== original.id)!.style).toEqual(expected);
  });
});
