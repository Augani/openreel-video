import "../test/install-local-storage-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useSettingsStore } from "../stores/settings-store";
import { useProjectStore } from "../stores/project-store";
import { withAgentToolCall } from "../components/onboarding/shell/project-intent";
import { autoSaveManager } from "../services/auto-save";
import { createEmptyProject } from "../stores/project/project-helpers";
import { keyboardShortcuts } from "../services/keyboard-shortcuts";
import { useOnboardingStore } from "../stores/onboarding-store";

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  activateProject: vi.fn(),
  releaseFile: vi.fn(),
  reportCrash: vi.fn(),
  crashApp: false,
}));
vi.mock("../services/project-manager", () => ({
  projectManager: { pickProjectFile: mocks.openProject, activatePickedProject: mocks.activateProject, releaseCurrentFileHandle: mocks.releaseFile },
}));

vi.mock("../App", () => ({
  default: () => {
    if (mocks.crashApp) throw new Error("Test renderer failed");
    return <div data-testid="shared-web-application" />;
  },
}));
vi.mock("./UpdateBanner", () => ({ UpdateBanner: () => null }));
vi.mock("./crash-reporting", () => ({
  installRendererCrashHandlers: () => () => {},
  reportRendererCrash: mocks.reportCrash,
}));
vi.mock("../services/agent/mcp-listener", () => ({
  installMcpListener: () => () => {},
  handleMcpBridgeRequest: async (req: { callId: string }) => ({ ok: true, result: `handled:${req.callId}` }),
}));
vi.mock("../services/agent/host-singleton", () => ({
  getLiveEditorHost: () => ({ setJobRunner: () => {} }),
}));
vi.mock("../services/agent/export-job-runner", () => ({
  createExportJobRunner: () => ({}),
}));
import { DesktopApp } from "./DesktopApp";

let menuAction: (id: string) => void;
let queryUnsaved: () => unknown;
let flush: () => unknown;
const offMenu = vi.fn();
const offQuery = vi.fn();
const offFlush = vi.fn();
const offMcp = vi.fn();
let mcpHandler: (req: { callId: string; kind: "listTools" | "callTool" }) => Promise<{ ok: boolean; result?: unknown }>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.crashApp = false;
  mocks.openProject.mockResolvedValue(null);
  useProjectStore.setState({ hasOpenProject: false });
  window.location.hash = "#/welcome";
  Object.defineProperty(window, "openreel", {
    configurable: true,
    value: {
      platform: "desktop",
      mcp: {
        onRequest: (handler: typeof mcpHandler) => {
          mcpHandler = handler;
          return offMcp;
        },
      },
      onMenuAction: (callback: typeof menuAction) => {
        menuAction = callback;
        return offMenu;
      },
      lifecycle: {
        onQueryUnsaved: (callback: typeof queryUnsaved) => {
          queryUnsaved = callback;
          return offQuery;
        },
        onFlush: (callback: typeof flush) => {
          flush = callback;
          return offFlush;
        },
      },
    },
  });
});
afterEach(() => {
  cleanup();
  delete (window as { openreel?: unknown }).openreel;
  vi.restoreAllMocks();
});

describe("Desktop shared application", () => {
  it("selects focused field text without selecting timeline clips, then routes canvas selection to the editor", () => {
    const selectTimeline = vi.fn();
    const unregister = keyboardShortcuts.registerHandler("selection.selectAll", selectTimeline);
    const view = render(<><DesktopApp /><input aria-label="Native timecode" defaultValue="00:00:28:15" /><textarea aria-label="Native title" defaultValue="Golden Hour" /><div contentEditable suppressContentEditableWarning tabIndex={0} data-testid="native-rich-text"><span>Formatted title</span></div></>);
    try {
      for (const name of ["Native timecode", "Native title"]) {
        const field = screen.getByRole("textbox", { name }) as HTMLInputElement | HTMLTextAreaElement;
        field.focus();
        field.setSelectionRange(3, 3);
        menuAction("selectAll");
        expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
        expect(selectTimeline).not.toHaveBeenCalled();
      }
      const editable = screen.getByTestId("native-rich-text");
      editable.focus();
      menuAction("selectAll");
      expect(window.getSelection()?.toString()).toBe("Formatted title");
      expect(selectTimeline).not.toHaveBeenCalled();
      editable.blur();
      menuAction("selectAll");
      expect(selectTimeline).toHaveBeenCalledOnce();
    } finally {
      unregister();
      view.unmount();
    }
  });
  it("routes native menus to the shared editor and keeps native export reachable", () => {
    const undo = vi
      .spyOn(useProjectStore.getState(), "undo")
      .mockResolvedValue({ success: true });
    const exported = vi.fn();
    window.addEventListener("openreel:menu:export", exported);
    render(<DesktopApp />);
    menuAction("undo");
    expect(undo).toHaveBeenCalledOnce();
    menuAction("newProject");
    expect(window.location.hash).toBe("#/new");
    menuAction("export");
    expect(exported).toHaveBeenCalledOnce();
    menuAction("settings");
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    window.removeEventListener("openreel:menu:export", exported);
  });
  it("preserves unsaved-change protection and removes native listeners on unmount", async () => {
    const unsaved = vi
      .spyOn(autoSaveManager, "hasUnsavedChanges")
      .mockReturnValue(true);
    const save = vi
      .spyOn(useProjectStore.getState(), "forceSave")
      .mockResolvedValue();
    const view = render(<DesktopApp />);
    expect(queryUnsaved()).toBe(true);
    expect(unsaved).toHaveBeenCalledOnce();
    await flush();
    expect(save).toHaveBeenCalledOnce();
    view.unmount();
    expect(offMenu).toHaveBeenCalledOnce();
    expect(offQuery).toHaveBeenCalledOnce();
    expect(offFlush).toHaveBeenCalledOnce();
  });

  it("opens the project picker from the native menu, keeps cancellation in place, and loads the chosen project", async () => {
    render(<DesktopApp />);
    act(() => menuAction("open"));
    await waitFor(() => expect(mocks.openProject).toHaveBeenCalledOnce());
    expect(window.location.hash).toBe("#/welcome");
    expect(useProjectStore.getState().hasOpenProject).toBe(false);
    const project = createEmptyProject("Opened native project");
    mocks.openProject.mockResolvedValue({ project, fileHandle: null });
    act(() => menuAction("open"));
    await waitFor(() =>
      expect(useProjectStore.getState().project.id).toBe(project.id),
    );
    expect(window.location.hash).toBe("#/editor");
    expect(useProjectStore.getState().hasOpenProject).toBe(true);
  });

  it("reveals a project created by an MCP client from the welcome screen", async () => {
    render(<DesktopApp />);
    act(() => { void withAgentToolCall(async () => useProjectStore.getState().createNewProject("Agent project")); });
    expect(window.location.hash).toBe("#/editor");
    await waitFor(() =>
      expect(useProjectStore.getState().project.name).toBe("Agent project"),
    );
  });

  it("reports a failed native open without replacing the active project", async () => {
    const project = useProjectStore.getState().project;
    mocks.openProject.mockRejectedValue(new Error("Read failed"));
    render(<DesktopApp />);
    act(() => menuAction("open"));
    await waitFor(() =>
      expect(mocks.reportCrash).toHaveBeenCalledWith({
        type: "project-open-error",
        message: "Read failed",
      }),
    );
    expect(useProjectStore.getState().project).toBe(project);
    expect(useProjectStore.getState().error).toContain("Could not open");
  });

  it("keeps a recoverable error boundary and reports React failures to the native collector", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.crashApp = true;
    render(<DesktopApp />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(mocks.reportCrash).toHaveBeenCalledWith(
      expect.objectContaining({ type: "react-error", message: "Test renderer failed" }),
    );
  });
});

describe("deferred agent stack", () => {
  it("answers an MCP request that arrives before the deferred stack loads instead of dropping it", async () => {
    render(<DesktopApp />);
    expect(mcpHandler).toBeTypeOf("function");
    await expect(mcpHandler({ callId: "early-1", kind: "listTools" })).resolves.toEqual({ ok: true, result: "handled:early-1" });
  });

  it("unregisters the MCP handler on unmount", () => {
    const view = render(<DesktopApp />);
    view.unmount();
    expect(offMcp).toHaveBeenCalled();
  });
});

describe("first-run onboarding integration", () => {
  beforeEach(() => {
    useOnboardingStore.setState({
      status: "unseen",
      skippedBy: undefined,
      openSheet: null,
      bandOpen: false,
      lessons: {},
    });
  });

  it("an MCP-created project retires onboarding as 'agent', closes the sheet and flips to the editor", () => {
    render(<DesktopApp />);
    act(() => useOnboardingStore.getState().showSheet("ai"));
    act(() => { void withAgentToolCall(async () => useProjectStore.getState().createNewProject("Agent project")); });
    expect(window.location.hash).toBe("#/editor");
    expect(useOnboardingStore.getState()).toMatchObject({
      status: "skipped",
      skippedBy: "agent",
      openSheet: null,
    });
  });

  it("keeps lesson progress when an agent flips the route", () => {
    useOnboardingStore.setState({ status: "in-progress", lessons: { split: "done" } });
    render(<DesktopApp />);
    act(() => { void withAgentToolCall(async () => useProjectStore.getState().createNewProject("Agent project")); });
    expect(useOnboardingStore.getState().lessons).toEqual({ split: "done" });
    expect(useOnboardingStore.getState().skippedBy).toBe("agent");
  });

  it("does not flag a user-picked project as an agent action", async () => {
    render(<DesktopApp />);
    const project = createEmptyProject("Picked");
    mocks.openProject.mockResolvedValue({ project, fileHandle: null });
    act(() => menuAction("open"));
    await waitFor(() => expect(window.location.hash).toBe("#/editor"));
    expect(useOnboardingStore.getState()).toMatchObject({ status: "skipped", skippedBy: "user" });
  });

  it("Help > Welcome & Setup re-opens the band from the editor route without changing status", () => {
    window.location.hash = "#/editor";
    useOnboardingStore.setState({ status: "done" });
    render(<DesktopApp />);
    act(() => menuAction("showWelcomeSetup"));
    expect(useOnboardingStore.getState().bandOpen).toBe(true);
    expect(useOnboardingStore.getState().status).toBe("done");
    expect(window.location.hash).toBe("#/welcome");
  });

  it("Help items open the Learn and agent sheets on any route", () => {
    window.location.hash = "#/editor";
    render(<DesktopApp />);
    act(() => menuAction("openLessons"));
    expect(useOnboardingStore.getState().openSheet).toBe("lessons");
    act(() => menuAction("connectAgent"));
    expect(useOnboardingStore.getState().openSheet).toBe("agent");
  });

  it("mirrors a finished onboarding to the main process", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue(null);
    const bridge = (window as unknown as { openreel: Record<string, unknown> }).openreel;
    bridge.onboarding = { get, set };
    render(<DesktopApp />);
    act(() => useOnboardingStore.getState().markDone());
    await waitFor(() => expect(set).toHaveBeenCalledWith(expect.objectContaining({ v: 1, status: "done" })));
  });
});
