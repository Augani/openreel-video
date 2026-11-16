import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Marker } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { keyboardShortcuts } from "./keyboard-shortcuts";
import {
  addMarkerAtPlayhead,
  addRangeMarker,
  buildMarkerExport,
  clearAllMarkers,
  clearMarkerAtPlayhead,
  editMarkerAtPlayhead,
  goToNextMarker,
  goToPreviousMarker,
} from "./marker-commands";

const mk = (id: string, time: number, extra: Partial<Marker> = {}): Marker => ({ id, time, label: id, color: "#3b82f6", ...extra });

const setMarkers = (markers: Marker[], frameRate = 30) => {
  const project = createEmptyProject("Markers");
  useProjectStore.setState({
    hasOpenProject: true,
    project: { ...project, name: "My Cut", settings: { ...project.settings, frameRate }, timeline: { ...project.timeline, markers } },
  });
};
const markers = () => useProjectStore.getState().project.timeline.markers;
const playhead = () => useTimelineStore.getState().playheadPosition;

describe("marker commands", () => {
  beforeEach(() => {
    useTimelineStore.setState({ playheadPosition: 0 });
    useEditorWorkspaceStore.setState({ editingMarkerId: null, section: "media" });
  });
  afterEach(() => setMarkers([]));

  it("goes to the next and previous marker and stops at the ends", () => {
    setMarkers([mk("a", 2), mk("b", 5), mk("c", 9)]);
    expect(goToNextMarker()).toBe(true);
    expect(playhead()).toBe(2);
    goToNextMarker();
    goToNextMarker();
    expect(playhead()).toBe(9);
    expect(goToNextMarker()).toBe(false);
    expect(playhead()).toBe(9);
    goToPreviousMarker();
    expect(playhead()).toBe(5);
    useTimelineStore.setState({ playheadPosition: 1 });
    expect(goToPreviousMarker()).toBe(false);
  });

  it("M adds a marker, and M again on the same spot opens it for editing instead of stacking", async () => {
    setMarkers([]);
    useTimelineStore.setState({ playheadPosition: 3 });
    await addMarkerAtPlayhead();
    expect(markers()).toHaveLength(1);
    expect(markers()[0].time).toBe(3);
    await addMarkerAtPlayhead();
    expect(markers()).toHaveLength(1);
    expect(useEditorWorkspaceStore.getState().section).toBe("markers");
    expect(useEditorWorkspaceStore.getState().editingMarkerId).toBe(markers()[0].id);
  });

  it("Alt+M edits the marker under or just before the playhead", () => {
    setMarkers([mk("a", 2), mk("b", 5, { duration: 4 })]);
    useTimelineStore.setState({ playheadPosition: 7 });
    editMarkerAtPlayhead();
    expect(useEditorWorkspaceStore.getState().editingMarkerId).toBe("b");
  });

  it("clears the marker at the playhead, including inside a range", async () => {
    setMarkers([mk("a", 2), mk("b", 5, { duration: 4 })]);
    useTimelineStore.setState({ playheadPosition: 7 });
    await clearMarkerAtPlayhead();
    expect(markers().map((m) => m.id)).toEqual(["a"]);
  });

  it("clears every marker as one undo step", async () => {
    setMarkers([]);
    const store = useProjectStore.getState();
    await store.addMarker(1, "a");
    await store.addMarker(2, "b");
    await store.addMarker(3, "c", "#fff", { duration: 2, comment: "x" });
    const before = structuredClone(markers());
    await clearAllMarkers();
    expect(markers()).toEqual([]);
    await useProjectStore.getState().undo();
    expect(markers()).toEqual(before);
  });

  it("creates a range marker, or a point when start equals end", async () => {
    setMarkers([]);
    await addRangeMarker(5, 2);
    await addRangeMarker(8, 8);
    expect(markers().map((m) => [m.time, m.duration])).toEqual([[2, 3], [8, undefined]]);
  });

  it("builds chapters, CSV and EDL exports from the project", () => {
    setMarkers([mk("a", 0, { label: "Intro" }), mk("b", 20, { label: "Main", duration: 5, comment: "key point" }), mk("c", 50, { label: "End" })]);
    const chapters = buildMarkerExport("chapters");
    expect(chapters.filename).toBe("My_Cut_chapters.txt");
    expect(chapters.content).toBe("0:00 Intro\n0:20 Main\n0:50 End");
    const csv = buildMarkerExport("csv");
    expect(csv.content.split("\n")[0]).toBe("Marker Name,Description,In,Out,Duration,Marker Type");
    expect(csv.content.split("\n")[2]).toBe("Main,key point,00:00:20:00,00:00:25:00,00:00:05:00,Comment");
    const edl = buildMarkerExport("edl");
    expect(edl.content).toMatch(/^TITLE: My Cut\nFCM: NON-DROP FRAME\n\n\* LOC: 01:00:00:00 BLUE {5}Intro/);
  });
});

describe("marker shortcuts go through the preset system", () => {
  const ids = ["tools.addMarker", "tools.editMarker", "tools.nextMarker", "tools.prevMarker", "tools.clearMarker", "tools.clearAllMarkers"];

  it("registers every marker command with its default key", () => {
    keyboardShortcuts.resetAllShortcuts();
    const keys = Object.fromEntries(keyboardShortcuts.getAllShortcuts().filter((s) => ids.includes(s.id)).map((s) => [s.id, s.currentKey]));
    expect(keys).toEqual({
      "tools.addMarker": "m",
      "tools.editMarker": "alt+m",
      "tools.nextMarker": "shift+arrowdown",
      "tools.prevMarker": "shift+arrowup",
      "tools.clearMarker": "cmd+alt+m",
      "tools.clearAllMarkers": "cmd+alt+shift+m",
    });
  });

  it("has no default key clashing with another command", () => {
    keyboardShortcuts.resetAllShortcuts();
    for (const id of ids) {
      const shortcut = keyboardShortcuts.getAllShortcuts().find((s) => s.id === id)!;
      expect(keyboardShortcuts.findConflict(shortcut.currentKey, id)).toBeNull();
    }
  });

  it("Shift+Down and Shift+Up fire the marker commands, plain Up and Down keep their jump", () => {
    keyboardShortcuts.resetAllShortcuts();
    keyboardShortcuts.startListening();
    const next = vi.fn(), prev = vi.fn(), jump = vi.fn();
    const off = [
      keyboardShortcuts.registerHandler("tools.nextMarker", next),
      keyboardShortcuts.registerHandler("tools.prevMarker", prev),
      keyboardShortcuts.registerHandler("playback.jump5Forward", jump),
    ];
    const press = (key: string, shiftKey: boolean) => window.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
    press("ArrowDown", true);
    press("ArrowUp", true);
    expect(next).toHaveBeenCalledTimes(1);
    expect(prev).toHaveBeenCalledTimes(1);
    expect(jump).not.toHaveBeenCalled();
    press("ArrowDown", false);
    expect(jump).toHaveBeenCalledTimes(1);
    off.forEach((fn) => fn());
    keyboardShortcuts.stopListening();
  });

  it("can be rebound", () => {
    keyboardShortcuts.resetAllShortcuts();
    expect(keyboardShortcuts.setShortcut("tools.nextMarker", "alt+arrowdown")).toBeTruthy();
    expect(keyboardShortcuts.getAllShortcuts().find((s) => s.id === "tools.nextMarker")?.currentKey).toBe("alt+arrowdown");
    keyboardShortcuts.resetAllShortcuts();
  });
});
