import "../../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionHistory, ActionExecutor, type Project, type Clip } from "@openreel/core";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../../../stores/project-store";
import { createEmptyProject } from "../../../../stores/project/project-helpers";
import { useKeyboardShortcuts } from "../../../../hooks/useKeyboardShortcuts";
import { keyboardShortcuts } from "../../../../services/keyboard-shortcuts";
import { useNumericDraft } from "./useNumericDraft";
import { StrictMode } from "react";
import { SpeedSection } from "../SpeedSection";
import { useUIStore } from "../../../../stores/ui-store";
import { useTimelineStore } from "../../../../stores/timeline-store";
const mocks = vi.hoisted(() => ({ save: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../../../../services/project-manager", () => ({ projectManager: { saveProject: mocks.save, releaseCurrentFileHandle: vi.fn() } }));
vi.mock("../../../../stores/notification-store", () => ({ toast: { success: mocks.success, error: mocks.error } }));
let saved: Project[];
function NextField() {
  const value = useProjectStore(state => state.project.settings.height);
  const input = useNumericDraft({ value, live: false, onChange: height => { useProjectStore.setState(state => ({ project: { ...state.project, settings: { ...state.project.settings, height } } })); } });
  return <Input {...input} aria-label="Next numeric property" />;
}
function Harness({ change, disabledScope = false, autoFocus = false, nextField = false }: { change?: (value: number) => unknown; disabledScope?: boolean; autoFocus?: boolean; nextField?: boolean }) {
  useKeyboardShortcuts();
  const value = useProjectStore(state => state.project.settings.width);
  const input = useNumericDraft({ value, min: 16, max: 7680, live: false, onChange: change ?? (width => { useProjectStore.setState(state => ({ project: { ...state.project, settings: { ...state.project.settings, width } } })); }) });
  return <div data-editor-shortcuts={disabledScope ? "off" : undefined}><Input {...input} autoFocus={autoFocus} aria-label="Numeric property" />{nextField && <NextField />}</div>;
}
beforeEach(() => {
  saved = []; vi.clearAllMocks(); keyboardShortcuts.resetAllShortcuts();
  const history = new ActionHistory();
  useProjectStore.setState({ project: createEmptyProject("Numeric Save"), hasOpenProject: true, actionHistory: history, actionExecutor: new ActionExecutor(history) });
  useTimelineStore.setState({ playbackLockedReason: null });
  useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  mocks.save.mockImplementation(async (project: Project, resolve?: () => Promise<Project>) => { saved.push(structuredClone(resolve ? await resolve() : project)); return true; });
});
afterEach(() => { cleanup(); keyboardShortcuts.stopListening(); document.body.innerHTML = ""; });
describe("saving numeric drafts", () => {
  it("commits the focused draft before Save without moving keyboard focus", async () => {
    render(<Harness />); const input = screen.getByRole("textbox", { name: "Numeric property" });
    act(() => input.focus()); fireEvent.change(input, { target: { value: "640" } });
    expect(useProjectStore.getState().project.settings.width).toBe(1920);
    fireEvent.keyDown(input, { key: "s", metaKey: true });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].settings.width).toBe(640); expect(document.activeElement).toBe(input);
    fireEvent.blur(input); expect(useProjectStore.getState().project.settings.width).toBe(640);
  });

  it("keeps autofocus registration through StrictMode's effect cleanup", async () => {
    render(<StrictMode><Harness autoFocus /></StrictMode>);
    const input = screen.getByRole("textbox", { name: "Numeric property" });
    fireEvent.change(input, { target: { value: "1280" } }); fireEvent.keyDown(input, { key: "s", ctrlKey: true });
    await waitFor(() => expect(saved).toHaveLength(1)); expect(saved[0].settings.width).toBe(1280);
  });

  it.each([false, true])("saves from the next numeric field, preserving its invalid draft=%s", async invalid => {
    const view = render(<Harness nextField />); const input = screen.getByRole("textbox", { name: "Numeric property" });
    act(() => input.focus()); fireEvent.change(input, { target: { value: "640" } }); act(() => input.blur());
    const next = screen.getByRole("textbox", { name: "Next numeric property" }); act(() => next.focus());
    if (invalid) fireEvent.change(next, { target: { value: "-" } }); fireEvent.keyDown(next, { key: "s", ctrlKey: true });
    await waitFor(() => expect(saved).toHaveLength(1)); expect(saved[0].settings.width).toBe(640);
    if (invalid) expect(next).toHaveValue("-"); view.unmount();
  });

  it.each(["modal", "off", "IME", "handled", "repeat"])("preserves %s ownership without committing the draft", kind => {
    render(<Harness disabledScope={kind === "off"} />); const input = screen.getByRole("textbox", { name: "Numeric property" });
    act(() => input.focus()); fireEvent.change(input, { target: { value: "640" } });
    if (kind === "modal") { const modal = document.createElement("div"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("role", "dialog"); document.body.append(modal); }
    if (kind === "handled") input.addEventListener("keydown", event => event.preventDefault(), { once: true });
    fireEvent.keyDown(input, { key: "s", metaKey: true, isComposing: kind === "IME", repeat: kind === "repeat" });
    expect(mocks.save).not.toHaveBeenCalled(); expect(useProjectStore.getState().project.settings.width).toBe(1920);
  });

  it("does not turn a plain remapped Save key into a typing shortcut", () => {
    render(<Harness />); keyboardShortcuts.setShortcut("file.save", "s");
    const input = screen.getByRole("textbox", { name: "Numeric property" }); act(() => input.focus());
    fireEvent.change(input, { target: { value: "640" } }); fireEvent.keyDown(input, { key: "s" });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("waits for an async numeric write while retaining focus", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const history = useProjectStore.getState().actionHistory;
    render(<Harness change={async width => {
      await gate; if (useProjectStore.getState().actionHistory === history) useProjectStore.setState(state => ({ project: { ...state.project, settings: { ...state.project.settings, width } } }));
    }} />);
    const input = screen.getByRole("textbox", { name: "Numeric property" }); act(() => input.focus());
    fireEvent.change(input, { target: { value: "640" } }); fireEvent.keyDown(input, { key: "s", metaKey: true });
    expect(mocks.save).toHaveBeenCalledOnce(); expect(saved).toHaveLength(0);
    await act(async () => release()); await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].settings.width).toBe(640); expect(document.activeElement).toBe(input);
  });

  it("accepts synchronous model callbacks that return a value instead of a promise", async () => {
    render(<Harness change={width => { useProjectStore.setState(state => ({ project: { ...state.project, settings: { ...state.project.settings, width } } })); return { updated: true }; }} />);
    const input = screen.getByRole("textbox", { name: "Numeric property" }); act(() => input.focus());
    fireEvent.change(input, { target: { value: "640" } }); fireEvent.keyDown(input, { key: "s", metaKey: true });
    await waitFor(() => expect(saved).toHaveLength(1)); expect(saved[0].settings.width).toBe(640);
  });

  it("reports a rejected pending edit without writing a stale snapshot", async () => {
    let reject!: (error: Error) => void;
    const gate = new Promise<void>((_resolve, fail) => { reject = fail; });
    render(<Harness change={() => gate} />); const input = screen.getByRole("textbox", { name: "Numeric property" });
    act(() => input.focus()); fireEvent.change(input, { target: { value: "640" } }); fireEvent.keyDown(input, { key: "s", metaKey: true });
    await act(async () => reject(new Error("The edit failed")));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Could not save project", "The edit failed"));
    expect(saved).toHaveLength(0);
  });

  it("never writes a replacement project's state into the previous Save request", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    render(<Harness change={() => gate} />);
    const input = screen.getByRole("textbox", { name: "Numeric property" }); act(() => input.focus());
    fireEvent.change(input, { target: { value: "640" } }); fireEvent.keyDown(input, { key: "s", metaKey: true });
    act(() => { useProjectStore.setState({ project: createEmptyProject("Replacement"), actionHistory: new ActionHistory() }); });
    await act(async () => release()); await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(saved).toHaveLength(0); expect(useProjectStore.getState().project.name).toBe("Replacement");
  });

  it("saves the actual queued speed edit before the input loses focus", async () => {
    const clip: Clip = { id: "speed-clip", trackId: "speed-track", mediaId: "speed-media", startTime: 0, duration: 5, inPoint: 0, outPoint: 5, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } };
    useProjectStore.setState(state => ({ project: { ...state.project, timeline: { ...state.project.timeline, duration: 5, tracks: [{ id: clip.trackId, name: "Video", type: "video", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false }] } } }));
    function SpeedHarness() { useKeyboardShortcuts(); return <SpeedSection clip={clip} />; }
    render(<SpeedHarness />);
    const input = screen.getByRole("textbox", { name: "Custom Speed" }); act(() => input.focus());
    fireEvent.change(input, { target: { value: "2" } }); fireEvent.keyDown(input, { key: "s", metaKey: true });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].timeline.tracks[0].clips[0]).toMatchObject({ speed: 2, duration: 2.5, outPoint: 5 });
    expect(document.activeElement).toBe(input);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getClip(clip.id)).toEqual(clip);
  });
});
