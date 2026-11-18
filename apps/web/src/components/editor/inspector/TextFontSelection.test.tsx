import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleEngine, type TextClip } from "@openreel/core";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { ensureFontFamily } from "../../../services/project-fonts";
import { selectOption } from "../../../test/select-option";
import { registerCustomFont } from "./font-options";
import { PrimaryTextProperties } from "./PrimaryTextProperties";
import { TextSection } from "./TextSection";

vi.mock("../../../services/project-fonts", async (original) => ({
  ...await original<typeof import("../../../services/project-fonts")>(),
  ensureFontFamily: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./font-options", async (original) => ({
  ...await original<typeof import("./font-options")>(),
  registerCustomFont: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let first: TextClip;
let second: TextClip;
const current = (clip = first) => useProjectStore.getState().getTextClip(clip.id)!;
const editors = [
  { name: "primary", Component: PrimaryTextProperties, label: "Font family" },
  { name: "advanced", Component: TextSection, label: "Font" },
];

beforeEach(() => {
  vi.mocked(ensureFontFamily).mockReset().mockResolvedValue(undefined);
  vi.mocked(registerCustomFont).mockReset();
  useEngineStore.setState({ titleEngine: new TitleEngine() });
  useProjectStore.getState().createNewProject("Font request ownership");
  const track = useProjectStore.getState().project.timeline.tracks.find((row) => row.type === "text")!;
  first = useProjectStore.getState().createTextClip(track.id, 0, "First", 4)!;
  second = useProjectStore.getState().createTextClip(track.id, 4, "Second", 4)!;
  useProjectStore.getState().actionHistory.clear();
});
afterEach(() => { cleanup(); });

describe("Text font selection ownership", () => {
  it.each(editors)("keeps the latest $name font choice when an older load finishes first", async ({ Component, label }) => {
    const old = deferred<void>();
    const latest = deferred<void>();
    vi.mocked(ensureFontFamily).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => latest.promise);
    render(<Component clipId={first.id} />);
    await selectOption(screen.getByRole("combobox", { name: label }), "Roboto");
    await selectOption(screen.getByRole("combobox", { name: label }), "Poppins");
    await act(async () => { old.resolve(); });
    expect(current().style.fontFamily).toBe(first.style.fontFamily);
    await act(async () => { latest.resolve(); });
    expect(current().style.fontFamily).toBe("Poppins");
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(first);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it.each(editors)("discards a $name font load after reloading the same project into a new session", async ({ Component, label }) => {
    const loading = deferred<void>();
    vi.mocked(ensureFontFamily).mockReturnValueOnce(loading.promise);
    render(<Component clipId={first.id} />);
    await selectOption(screen.getByRole("combobox", { name: label }), "Roboto");
    act(() => useProjectStore.getState().loadProject({ ...useProjectStore.getState().project }));
    const loaded = useProjectStore.getState().project;
    await act(async () => { loading.resolve(); });
    expect(useProjectStore.getState().project).toBe(loaded);
    expect(current()).toEqual(first);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it.each(editors)("discards a $name font load when the inspected title changes", async ({ Component, label }) => {
    const loading = deferred<void>();
    vi.mocked(ensureFontFamily).mockReturnValueOnce(loading.promise);
    const view = render(<Component clipId={first.id} />);
    await selectOption(screen.getByRole("combobox", { name: label }), "Roboto");
    view.rerender(<Component clipId={second.id} />);
    await act(async () => { loading.resolve(); });
    expect(current()).toEqual(first);
    expect(current(second)).toEqual(second);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("does not apply a pending uploaded font over a later primary choice", async () => {
    const uploading = deferred<Awaited<ReturnType<typeof registerCustomFont>>>();
    vi.mocked(registerCustomFont).mockReturnValueOnce(uploading.promise);
    render(<><PrimaryTextProperties clipId={first.id} /><TextSection clipId={first.id} /></>);
    fireEvent.drop(screen.getByRole("button", { name: "Custom Font" }), {
      dataTransfer: { files: [new File(["font"], "Uploaded.woff2")] },
    });
    await selectOption(screen.getByRole("combobox", { name: "Font family" }), "Poppins");
    await waitFor(() => expect(current().style.fontFamily).toBe("Poppins"));
    await act(async () => { uploading.resolve({ success: true, fontFamily: "Uploaded" }); });
    expect(current().style.fontFamily).toBe("Poppins");
    expect(screen.getByRole("button", { name: "Custom Font" })).toHaveTextContent("Upload custom font");
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(first);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("keeps a batch font change in one exact Undo", async () => {
    render(<TextSection clipId={first.id} clipIds={[first.id, second.id]} />);
    await selectOption(screen.getByRole("combobox", { name: "Font" }), "Roboto");
    await waitFor(() => expect(current(second).style.fontFamily).toBe("Roboto"));
    expect(current().style.fontFamily).toBe("Roboto");
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(first);
    expect(current(second)).toEqual(second);
    expect(useProjectStore.getState().canUndo()).toBe(false);
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(current().style.fontFamily).toBe("Roboto");
    expect(current(second).style.fontFamily).toBe("Roboto");
  });

  it("applies a loaded custom font and restores the exact title with Undo", async () => {
    vi.mocked(registerCustomFont).mockResolvedValueOnce({ success: true, fontFamily: "Uploaded" });
    render(<TextSection clipId={first.id} />);
    fireEvent.drop(screen.getByRole("button", { name: "Custom Font" }), {
      dataTransfer: { files: [new File(["font"], "Uploaded.woff2")] },
    });
    await waitFor(() => expect(current().style.fontFamily).toBe("Uploaded"));
    expect(screen.getByRole("button", { name: "Custom Font" })).toHaveTextContent("Upload custom font");
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(first);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("preserves later shader and color edits when the requested font finishes", async () => {
    const loading = deferred<void>();
    vi.mocked(ensureFontFamily).mockReturnValueOnce(loading.promise);
    render(<PrimaryTextProperties clipId={first.id} />);
    await selectOption(screen.getByRole("combobox", { name: "Font family" }), "Roboto");
    const shader = { shaderId: "paper-mesh-gradient", params: { color1: "#ee55aa" } };
    act(() => useProjectStore.getState().updateTextStyle(first.id, { color: "#ee55aa", shader }));
    await act(async () => { loading.resolve(); });
    expect(current().style).toMatchObject({ fontFamily: "Roboto", color: "#ee55aa", shader });
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current().style).toMatchObject({ fontFamily: first.style.fontFamily, color: "#ee55aa", shader });
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(first);
  });
});
