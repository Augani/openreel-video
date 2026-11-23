import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Subtitle } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import * as fonts from "./inspector/font-options";
import { InspectorPanel } from "./InspectorPanel";
import { selectOption } from "../../test/select-option";

const original: Subtitle = {
  id: "saved-subtitle", text: "Keep every caption", startTime: 1, endTime: 5,
  animationStyle: "karaoke",
  words: [{ text: "Keep", startTime: 1, endTime: 2 }],
  style: { fontFamily: "Inter", fontSize: 24, color: "rgba(102, 136, 255, 0.4)",
    backgroundColor: "rgba(20, 40, 60, 0.35)", position: "bottom", highlightColor: "#ffff00" },
};

function seed() {
  useProjectStore.getState().createNewProject("Saved subtitle controls");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, subtitles: [structuredClone(original)] } } });
  useProjectStore.getState().actionHistory.clear();
  useUIStore.getState().select({ type: "subtitle", id: original.id });
}
// The subtitle inspector is a lazy chunk: wait for it before touching its controls.
const ready = () => screen.findByRole("button", { name: "Delete Subtitle" });
const current = () => useProjectStore.getState().getSubtitle(original.id)!;
const expand = (name: string) => fireEvent.click(screen.getByRole("button", { name: `Expand ${name} section` }));
function upload(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["font"], "caption.woff2")] } });
}
function pendingUpload() {
  let resolve!: (value: Awaited<ReturnType<typeof fonts.registerCustomFont>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof fonts.registerCustomFont>>>(done => { resolve = done; });
  vi.spyOn(fonts, "registerCustomFont").mockReturnValue(pending);
  return resolve;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); useUIStore.getState().clearSelection(); });

describe("saved subtitle inspector", () => {
  it("keeps numeric drafts local and makes one undoable timing edit", async () => {
    seed(); render(<InspectorPanel />); await ready(); expand("Timing");
    const start = screen.getByRole("spinbutton", { name: "Start Time" });
    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: "2" } });
    fireEvent.change(start, { target: { value: "2.5" } });
    expect(current()).toEqual(original);
    fireEvent.blur(start);
    await waitFor(() => expect(current().startTime).toBe(2.5));
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("retains timed words and animation while editing text and position, with exact Undo", async () => {
    seed(); render(<InspectorPanel />); await ready(); expand("Text Content"); expand("Position");
    fireEvent.change(screen.getByRole("textbox", { name: "Subtitle text" }), { target: { value: "Revised\ncaption" } });
    await waitFor(() => expect(current().text).toBe("Revised\ncaption"));
    fireEvent.click(screen.getByRole("radio", { name: "top" }));
    await waitFor(() => expect(current().style?.position).toBe("top"));
    expect(current()).toMatchObject({ words: original.words, animationStyle: "karaoke" });
    await act(async () => { await useProjectStore.getState().undo(); await useProjectStore.getState().undo(); });
    expect(current()).toEqual(original);
  });

  it("does not let a pending custom font replace a newer family choice", async () => {
    seed(); const resolve = pendingUpload(); const { container } = render(<InspectorPanel />); await ready(); expand("Font");
    upload(container);
    await selectOption(screen.getByRole("combobox", { name: "Font family" }), /^Poppins/);
    await waitFor(() => expect(current().style?.fontFamily).toBe("Poppins"));
    await act(async () => { resolve({ success: true, fontFamily: "Uploaded Caption" }); });
    expect(current().style?.fontFamily).toBe("Poppins");
  });

  it("merges a completed custom font into current styling instead of the upload's stale snapshot", async () => {
    seed(); const resolve = pendingUpload(); const { container } = render(<InspectorPanel />); await ready(); expand("Font"); upload(container);
    await act(async () => { useProjectStore.getState().updateSubtitle(original.id, { style: { ...current().style!, color: "#123456" } }); });
    await act(async () => { resolve({ success: true, fontFamily: "Uploaded Caption" }); });
    await waitFor(() => expect(current().style?.fontFamily).toBe("Uploaded Caption"));
    expect(current().style?.color).toBe("#123456");
    expect(current().words).toEqual(original.words);
  });

  it("cannot apply an old upload after replacement of the editing session, even with matching IDs", async () => {
    seed(); const firstProject = useProjectStore.getState().project;
    const resolve = pendingUpload(); const { container } = render(<InspectorPanel />); await ready(); expand("Font"); upload(container);
    await act(async () => {
      useProjectStore.getState().createNewProject("Replacement");
      const replacement = useProjectStore.getState().project;
      useProjectStore.setState({ project: { ...replacement, id: firstProject.id, timeline: { ...replacement.timeline, subtitles: [structuredClone(original)] } } });
      useUIStore.getState().select({ type: "subtitle", id: original.id });
    });
    await act(async () => { resolve({ success: true, fontFamily: "Old Upload" }); });
    expect(current()).toEqual(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("retains all animation modes and can undo deletion of a saved subtitle", async () => {
    seed(); render(<InspectorPanel />); await ready(); expand("Animation");
    await selectOption(screen.getByRole("combobox", { name: "Animation style" }), "Typewriter");
    await waitFor(() => expect(current().animationStyle).toBe("typewriter"));
    expect(screen.queryByRole("button", { name: "Select highlight color" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Subtitle" }));
    await waitFor(() => expect(current()).toBeUndefined());
    await act(async () => { await useProjectStore.getState().undo(); await useProjectStore.getState().undo(); });
    expect(current()).toEqual(original);
  });

  it("leaves the current subtitle untouched when selection changes before a font finishes", async () => {
    seed(); const resolve = pendingUpload(); const { container } = render(<InspectorPanel />); await ready(); expand("Font"); upload(container);
    act(() => useUIStore.getState().clearSelection());
    await act(async () => { resolve({ success: true, fontFamily: "Old Selection" }); });
    expect(current()).toEqual(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
});
