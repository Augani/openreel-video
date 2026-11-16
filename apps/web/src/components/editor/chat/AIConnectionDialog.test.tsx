import "../../../test/install-local-storage-mock";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AIConnectionDialog } from "./AIConnectionDialog";
import {
  useAIConnectionStore,
  AI_PROVIDER_DEFAULTS,
} from "../../../stores/ai-connection-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useUIStore } from "../../../stores/ui-store";
const complete = vi.hoisted(() =>
  vi.fn(async () => ({ text: "OK", toolUses: [] })),
);
vi.mock("../../../services/agent/direct-llm-transport", () => ({
  validateAIEndpoint: (url: string) => new URL(url).href,
  makeDirectBYOKClient: () => ({ complete }),
}));
beforeEach(() => {
  useAIConnectionStore.getState().configure({
    provider: "openai",
    ...AI_PROVIDER_DEFAULTS.openai,
    apiKey: "",
  });
  useEditorWorkspaceStore.getState().setAIConnectionOpen(true);
  useUIStore.getState().setPanelVisible("agentChat", false);
  complete.mockClear();
});
afterEach(cleanup);
async function enterModelId(value: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "AI editing model" }));
  fireEvent.change(await screen.findByLabelText("AI model ID"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
}
describe("AI connection dialog", () => {
  it("keeps cancelled provider changes out of the active session", async () => {
    render(<AIConnectionDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Ollama Local/ }));
    await enterModelId("local-tool-model");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useAIConnectionStore.getState().provider).toBe("openai");
    expect(complete).not.toHaveBeenCalled();
  });
  it("opens a keyless local session without sending an automatic request", async () => {
    render(<AIConnectionDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Ollama Local/ }));
    await enterModelId("local-tool-model");
    fireEvent.click(screen.getByRole("button", { name: "Connect and start" }));
    expect(useAIConnectionStore.getState()).toMatchObject({
      provider: "compatible",
      baseUrl: "http://localhost:11434/v1",
      model: "local-tool-model",
      apiKey: "",
    });
    expect(useUIStore.getState().panels.agentChat.visible).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });
  it("tests only on request and reports the actual response without claiming persisted encryption", async () => {
    render(<AIConnectionDialog />);
    fireEvent.change(screen.getByLabelText("Session API key"), {
      target: { value: "fixture-only" },
    });
    expect(screen.getByLabelText("Session API key")).toHaveAttribute(
      "type",
      "password",
    );
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Connected"),
    );
    expect(complete).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "Reply with OK." }],
      tools: [],
    });
    expect(useAIConnectionStore.getState().apiKey).toBe("");
  });
});
