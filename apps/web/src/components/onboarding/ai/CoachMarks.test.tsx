import "../../../test/install-local-storage-mock";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CoachMarks, { COACH_COPY, coachTarget, placeCoachCard } from "./CoachMarks";
import { COACH_STORAGE_KEY, useCoachStore } from "./coach-store";
import { handOffToEditorChat } from "./handoff";
import { useChatStore } from "../../../stores/chat-store";

function mountTargets() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div data-tour="ai-chat" id="chat"></div><button data-tour="ai-actions">Actions</button><button>Export</button>`,
  );
  const rect = (left: number, top: number, w: number, h: number) =>
    ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  document.querySelector<HTMLElement>('[data-tour="ai-chat"]')!.getBoundingClientRect = () => rect(900, 60, 380, 600);
  document.querySelector<HTMLElement>('[data-tour="ai-actions"]')!.getBoundingClientRect = () => rect(1230, 64, 28, 28);
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Export")!.getBoundingClientRect = () =>
    rect(1180, 10, 80, 30);
}

beforeEach(() => {
  localStorage.clear();
  useCoachStore.getState().reset();
  useChatStore.getState().reset();
  mountTargets();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("coach marks", () => {
  it("only appear after the AI path arms them, and start with 'Watch each step appear'", () => {
    render(<CoachMarks />);
    expect(screen.queryByRole("note")).toBeNull();
    act(() => useCoachStore.getState().arm());
    expect(screen.getByRole("note", { name: COACH_COPY.watch.title })).toBeInTheDocument();
    expect(COACH_COPY.watch.title).toBe("Watch each step appear");
  });

  it("moves to the undo mark once the first turn committed an edit", () => {
    render(<CoachMarks />);
    act(() => useCoachStore.getState().arm());
    act(() =>
      useChatStore.setState({
        status: "idle",
        messages: [
          { id: "u", role: "user", text: "go", toolCalls: [] },
          { id: "a", role: "assistant", text: "done", toolCalls: [], editSummary: { beforeDuration: 0, afterDuration: 5 } },
        ],
      }),
    );
    expect(COACH_COPY.undo.title).toBe("Don't like it? Undo AI edit puts everything back");
    expect(screen.getByRole("note", { name: COACH_COPY.undo.title })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/single undo step/);
  });

  it("walks undo -> export, then never shows again (each mark once)", () => {
    render(<CoachMarks />);
    act(() => useCoachStore.getState().arm());
    act(() => useCoachStore.getState().dismiss("undo"));
    act(() => useCoachStore.getState().dismiss("export"));
    expect(screen.getByRole("note", { name: "Happy? Open Export" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(JSON.parse(localStorage.getItem(COACH_STORAGE_KEY) ?? "[]")).toEqual(["watch", "undo", "export"]);
    act(() => useCoachStore.getState().arm());
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("'Skip tips' ends everything", () => {
    render(<CoachMarks />);
    act(() => useCoachStore.getState().arm());
    fireEvent.click(screen.getByRole("button", { name: "Skip tips" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(useCoachStore.getState().armed).toBe(false);
  });

  it("stops quietly when the first turn fails", () => {
    render(<CoachMarks />);
    act(() => useCoachStore.getState().arm());
    act(() => useChatStore.setState({ status: "error" }));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("finds its anchors and places the card inside the window", () => {
    expect(coachTarget("watch")?.id).toBe("chat");
    expect(coachTarget("undo")?.textContent).toBe("Actions");
    expect(coachTarget("export")?.textContent).toBe("Export");
    const viewport = { width: 1280, height: 720 };
    for (const step of ["watch", "undo", "export"] as const) {
      const rect = coachTarget(step)!.getBoundingClientRect();
      const p = placeCoachCard(step, rect, viewport, 150);
      expect(p.left).toBeGreaterThanOrEqual(12);
      expect(p.left + 288).toBeLessThanOrEqual(viewport.width - 12);
      expect(p.top).toBeGreaterThanOrEqual(12);
      expect(p.top + 150).toBeLessThanOrEqual(viewport.height - 12);
    }
  });
});

describe("handOffToEditorChat", () => {
  it("docks the chat, goes to the editor, arms the marks, then sends through the chat store", async () => {
    const order: string[] = [];
    await handOffToEditorChat("  Make it shorter  ", {}, {
      showChat: () => order.push("chat"),
      navigateToEditor: () => order.push("editor"),
      waitForChat: async () => void order.push("wait"),
      armCoach: () => order.push("coach"),
      send: vi.fn(async (p: string) => void order.push(`send:${p}`)),
    });
    expect(order).toEqual(["chat", "editor", "wait", "coach", "send:Make it shorter"]);
  });

  it("keeps the prompt as a chat draft instead of sending when no model is connected", async () => {
    const send = vi.fn(async () => undefined);
    const saveDraft = vi.fn();
    await handOffToEditorChat("Make it shorter", { connected: false }, {
      showChat: vi.fn(),
      navigateToEditor: vi.fn(),
      waitForChat: async () => undefined,
      armCoach: vi.fn(),
      send,
      saveDraft,
    });
    expect(send).not.toHaveBeenCalled();
    expect(saveDraft).toHaveBeenCalledWith("Make it shorter");
  });

  it("sends nothing when there is no prompt (no model connected)", async () => {
    const send = vi.fn(async () => undefined);
    await handOffToEditorChat("   ", {}, {
      showChat: vi.fn(),
      navigateToEditor: vi.fn(),
      waitForChat: async () => undefined,
      armCoach: vi.fn(),
      send,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
