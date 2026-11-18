import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine, type TextClip } from "@openreel/core";
import { ensureFontFamily } from "../../services/project-fonts";
import { useEngineStore } from "../../stores/engine-store";
import { useProjectStore } from "../../stores/project-store";
import { WorkspaceGraphicsPanel } from "./WorkspaceGraphicsPanel";

vi.mock("../../services/project-fonts", () => ({ ensureFontFamily: vi.fn().mockResolvedValue(undefined) }));
const state = () => useProjectStore.getState();
let titles: TextClip[];
beforeEach(async () => {
  for (const key of ["openreel-brand-colors", "openreel-brand-font", "openreel-brand-name"]) localStorage.removeItem(key);
  // A saved brand kit: the apply card only exists once there is a kit to apply.
  localStorage.setItem("openreel-brand-name", "Test brand");
  vi.mocked(ensureFontFamily).mockReset().mockResolvedValue(undefined);
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  state().createNewProject("Brand application ownership");
  const tracks = state().project.timeline.tracks;
  titles = [
    state().createTextClip(tracks[0].id, 0, "First", 4, { color: "#123456", fontWeight: 800, letterSpacing: 4 })!,
    state().createTextClip(tracks[1].id, 4, "Second", 4, { color: "#abcdef", fontWeight: 400, strokeWidth: 3 })!,
    state().createTextClip(tracks[2].id, 8, "Locked", 4, { color: "#654321" })!,
  ].map(clip => structuredClone(clip));
  await state().lockTrack(tracks[2].id, true);
  state().actionHistory.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function open() {
  const view = render(<WorkspaceGraphicsPanel backgrounds={[]} onImportBackground={vi.fn()} generatingBackground={null} />);
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Brand" }), { button: 0 });
  fireEvent.click(screen.getByRole("tab", { name: "Brand" }));
  return view;
}
function apply() { fireEvent.click(screen.getByRole("button", { name: "Apply brand to all titles" })); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("brand tab without a kit", () => {
  it("offers nothing to apply and shows no stand-in swatches or font line", () => {
    localStorage.removeItem("openreel-brand-name");
    open();
    expect(screen.getByRole("status").textContent).toContain("No brand kit yet");
    expect(screen.queryByText("Apply your brand")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply brand to all titles" })).toBeNull();
    expect(screen.queryByText(/Fonts ·/)).toBeNull();
  });
});

describe("source brand action", () => {
  it("offers the complete font catalog, applies font/color to unlocked titles together, and preserves all other settings with exact Undo/Redo", async () => {
    open();
    const font = screen.getByRole("combobox", { name: "Brand title font" });
    fireEvent.keyDown(font, { key: "ArrowDown" });
    expect(await screen.findAllByRole("option")).toHaveLength(59);
    fireEvent.click(screen.getByRole("option", { name: "Fraunces" }));
    expect(localStorage.getItem("openreel-brand-font")).toBe("Fraunces");
    apply();
    await waitFor(() => expect(state().getTextClip(titles[0].id)?.style.fontFamily).toBe("Fraunces"));
    for (const clip of titles.slice(0, 2)) {
      expect(state().getTextClip(clip.id)).toEqual({ ...clip, style: { ...clip.style, fontFamily: "Fraunces", color: "#34D399" } });
    }
    expect(state().getTextClip(titles[2].id)).toEqual(titles[2]);
    expect(ensureFontFamily).toHaveBeenCalledTimes(2);
    const applied = structuredClone(state().project.textClips);
    await act(async () => { expect((await state().undo()).success).toBe(true); });
    expect(state().project.textClips).toEqual(titles);
    expect(state().canUndo()).toBe(false);
    await act(async () => { expect((await state().redo()).success).toBe(true); });
    expect(state().project.textClips).toEqual(applied);
  });

  it("discards an in-flight brand application after a same-project reload", async () => {
    const pending = deferred();
    vi.mocked(ensureFontFamily).mockReturnValue(pending.promise);
    open(); apply();
    act(() => state().loadProject(structuredClone(state().project)));
    const loaded = state().project;
    await act(async () => { pending.resolve(); });
    expect(state().project).toBe(loaded);
    expect(state().canUndo()).toBe(false);
  });

  it("keeps a newly locked title unchanged when loading finishes", async () => {
    const pending = deferred();
    vi.mocked(ensureFontFamily).mockReturnValue(pending.promise);
    open(); apply();
    await act(async () => { await state().lockTrack(titles[0].trackId, true); });
    await act(async () => { pending.resolve(); });
    expect(state().project.textClips).toEqual(titles);
    await act(async () => { await state().undo(); });
    expect(state().canUndo()).toBe(false);
  });

});
