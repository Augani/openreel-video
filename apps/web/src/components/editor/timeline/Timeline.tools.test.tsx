import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Timeline } from "../Timeline";
import { useKeyboardShortcuts } from "../../../hooks/useKeyboardShortcuts";
import { keyboardShortcuts } from "../../../services/keyboard-shortcuts";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
function Harness() {
  useKeyboardShortcuts();
  return (
    <>
      <input aria-label="Project notes" />
      <Timeline />
    </>
  );
}
beforeEach(() => {
  useProjectStore.setState({
    project: createEmptyProject("Toolbar tools"),
    hasOpenProject: true,
  });
  useEditorWorkspaceStore.setState({ timelineTool: "select" });
  useTimelineStore.setState({
    playbackLockedReason: null,
    trackHeight: 62,
    trackHeights: {},
  });
  useUIStore.setState({
    selectedItems: [],
    exportState: { ...useUIStore.getState().exportState, isExporting: false },
  });
  keyboardShortcuts.resetAllShortcuts();
});
afterEach(() => {
  cleanup();
  keyboardShortcuts.stopListening();
  keyboardShortcuts.resetAllShortcuts();
});
describe("trim tool shortcuts and toolbar", () => {
  it("selects roll, slide and rate stretch without displacing snap (N) or ripple (R)", () => {
    const view = render(<Harness />);
    fireEvent.keyDown(window, { key: "N", shiftKey: true });
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("roll");
    fireEvent.keyDown(window, { key: "u" });
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("slide");
    fireEvent.keyDown(window, { key: "R", shiftKey: true });
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("stretch");
    fireEvent.keyDown(window, { key: "r" });
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("ripple");
    const snap = useUIStore.getState().snapSettings.enabled;
    fireEvent.keyDown(window, { key: "n" });
    expect(useUIStore.getState().snapSettings.enabled).toBe(!snap);
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("ripple");
    fireEvent.click(view.getByRole("button", { name: "Rolling edit (Shift+N)" }));
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("roll");
    fireEvent.click(view.getByRole("button", { name: "Slide (U)" }));
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("slide");
    fireEvent.click(view.getByRole("button", { name: "Rate stretch (Shift+R)" }));
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("stretch");
  });
});
describe("authored timeline toolbar tools", () => {
  it("switches modes with R/Y while preserving text input and remapped shortcuts", () => {
    const view = render(<Harness />);
    fireEvent.keyDown(window, { key: "r" });
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("ripple");
    fireEvent.keyDown(window, { key: "y" });
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("slip");
    fireEvent.keyDown(view.getByRole("textbox", { name: "Project notes" }), {
      key: "r",
    });
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("slip");
    keyboardShortcuts.setShortcut("timeline.rippleTool", "alt+r");
    fireEvent.keyDown(window, { key: "r" });
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("slip");
    fireEvent.keyDown(window, { key: "r", altKey: true });
    expect(useEditorWorkspaceStore.getState().timelineTool).toBe("ripple");
  });
});
