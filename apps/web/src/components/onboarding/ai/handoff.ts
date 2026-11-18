import { useChatStore } from "../../../stores/chat-store";
import { useUIStore } from "../../../stores/ui-store";
import { useCoachStore } from "./coach-store";
import { useOnboardingDraft } from "./draft-store";

export interface HandoffDeps {
  navigateToEditor: () => void;
  showChat: () => void;
  armCoach: () => void;
  send: (prompt: string) => Promise<void>;
  /** Leaves the prompt in the chat composer instead of sending it (no model is connected). */
  saveDraft: (prompt: string) => void;
  /** Resolves when the docked chat panel is on screen (or the wait gave up). */
  waitForChat: (timeoutMs: number) => Promise<void>;
}

function waitForChatPanel(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = (): void => {
      if (document.querySelector(".workspace-chat") || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      setTimeout(poll, 80);
    };
    poll();
  });
}

const defaultDeps: HandoffDeps = {
  navigateToEditor: () => {
    window.location.hash = "#/editor";
  },
  showChat: () => useUIStore.getState().setPanelVisible("agentChat", true),
  armCoach: () => useCoachStore.getState().arm(),
  send: (prompt) => useChatStore.getState().send(prompt),
  saveDraft: (prompt) => useOnboardingDraft.getState().set(prompt),
  waitForChat: waitForChatPanel,
};

/**
 * The hand-off from the wizard to the real editor chat (spec 2.4 "After A3"): go to the editor, dock
 * the chat panel, then send the prompt through the existing chat store (one code path, no forked
 * chat). When no model is connected the prompt is kept as a draft in the chat composer, next to its
 * "Connect a model" state. It is deliberately not tied to a component: the sheet unmounts as soon as
 * the path is done.
 */
export async function handOffToEditorChat(
  prompt: string,
  options: { connected?: boolean } = {},
  deps: Partial<HandoffDeps> = {},
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const connected = options.connected ?? true;
  const text = prompt.trim();
  d.showChat();
  d.navigateToEditor();
  await d.waitForChat(8000);
  d.armCoach();
  if (!text) return;
  if (connected) await d.send(text);
  else d.saveDraft(text);
}
