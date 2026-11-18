import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScopesPanel } from "./ScopesPanel";
import { useUIStore } from "../../../stores/ui-store";
import { useColorMonitorStore } from "../../../stores/color-monitor-store";
import { keyboardShortcuts } from "../../../services/keyboard-shortcuts";

const created: Array<{ terminate: ReturnType<typeof vi.fn> }> = [];

class FakeWorker {
  onmessage: unknown = null;
  onerror: unknown = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    created.push(this);
  }
}

describe("ScopesPanel", () => {
  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal("Worker", FakeWorker);
    useUIStore.setState({ scopesVisible: false, scopesKind: "waveform" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does no work while hidden", () => {
    const { container } = render(<ScopesPanel />);
    expect(container.firstChild).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("spawns a worker when shown and terminates it when hidden", () => {
    render(<ScopesPanel />);
    act(() => useUIStore.getState().setScopesVisible(true));
    expect(screen.getByTestId("scopes-panel")).toBeTruthy();
    expect(created).toHaveLength(1);
    act(() => useUIStore.getState().toggleScopes());
    expect(screen.queryByTestId("scopes-panel")).toBeNull();
    expect(created[0].terminate).toHaveBeenCalled();
  });

  it("exposes every scope tab", () => {
    render(<ScopesPanel />);
    act(() => useUIStore.getState().setScopesVisible(true));
    for (const label of ["Luma", "RGB Parade", "YC", "Vector", "HLS", "Histogram"]) {
      expect(screen.getByLabelText(`${label} scope`)).toBeTruthy();
    }
  });
});

describe("ScopesPanel gestures", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker);
    useUIStore.setState({ scopesVisible: true, scopesKind: "waveform" });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sizes the trace and graticule canvases for the active scope type", () => {
    render(<ScopesPanel />);
    const panel = screen.getByTestId("scopes-panel");
    const sizes = () =>
      Array.from(panel.querySelectorAll("canvas")).map((c) => [c.width, c.height]);
    expect(sizes()).toEqual([[512, 256], [512, 256]]);
    act(() => useUIStore.getState().setScopesKind("histogram"));
    expect(sizes()).toEqual([[256, 128], [256, 128]]);
    act(() => useUIStore.getState().setScopesKind("parade"));
    expect(sizes()).toEqual([[1536, 256], [1536, 256]]);
    act(() => useUIStore.getState().setScopesKind("hls"));
    expect(sizes()).toEqual([[320, 320], [320, 320]]);
  });

  it("offers a waveform scale and drives the false colour toggle", () => {
    render(<ScopesPanel />);
    const scale = screen.getByLabelText("Waveform scale") as HTMLSelectElement;
    fireEvent.change(scale, { target: { value: "pq" } });
    expect(useUIStore.getState().scopesScale).toBe("pq");
    const toggle = screen.getByLabelText("False colour");
    fireEvent.click(toggle);
    expect(useColorMonitorStore.getState().falseColor).toBe(true);
    fireEvent.click(toggle);
    expect(useColorMonitorStore.getState().falseColor).toBe(false);
    act(() => useUIStore.getState().setScopesKind("vectorscope"));
    expect(screen.queryByLabelText("Waveform scale")).toBeNull();
    act(() => useUIStore.setState({ scopesScale: "ire" }));
  });

  it("removes window drag listeners if unmounted mid-drag", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<ScopesPanel />);
    const panel = screen.getByTestId("scopes-panel");
    Object.defineProperty(panel, "offsetParent", { value: document.body });
    const header = panel.querySelector(".cursor-move") as HTMLElement;
    fireEvent.pointerDown(header, { clientX: 5, clientY: 5 });
    const added = add.mock.calls.filter(([t]) => String(t).startsWith("pointer")).map(([t]) => t);
    expect(added).toContain("pointermove");
    unmount();
    const removed = remove.mock.calls.map(([t]) => t);
    for (const t of added) expect(removed).toContain(t);
  });
});

describe("scopes shortcut", () => {
  it("binds Shift+S to view.toggleScopes and nothing else", () => {
    const bound = keyboardShortcuts
      .getAllShortcuts()
      .filter((s) => s.currentKey === "shift+s");
    expect(bound.map((s) => s.action)).toEqual(["view.toggleScopes"]);
  });

  it("Shift+S key event dispatches view.toggleScopes; plain S does not", () => {
    const handler = vi.fn();
    const off = keyboardShortcuts.registerHandler("view.toggleScopes", handler);
    keyboardShortcuts.startListening();
    try {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "S", code: "KeyS", shiftKey: true, bubbles: true }),
      );
      expect(handler).toHaveBeenCalledTimes(1);
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", code: "KeyS", bubbles: true }),
      );
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      off();
      keyboardShortcuts.stopListening();
    }
  });
});
