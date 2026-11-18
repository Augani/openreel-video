import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LLMResponse } from "@openreel/agent";
import ConnectModel, { KEY_EXPLAINER } from "./ConnectModel";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";

const script = vi.hoisted(() => ({ responses: [] as LLMResponse[] }));
vi.mock("../../../services/agent/direct-llm-transport", async () => {
  const agent = await import("@openreel/agent");
  return {
    validateAIEndpoint: (url: string) => new URL(url).href,
    makeDirectBYOKClient: () => new agent.MockLLMClient(script.responses),
  };
});

const ok: LLMResponse = { text: "OK", toolUses: [], stopReason: "end_turn" };
const tool: LLMResponse = {
  text: "",
  toolUses: [{ id: "t1", name: "report_ready", input: { ok: true } }],
  stopReason: "tool_use",
};

function setBridge(bridge: Record<string, unknown> | undefined) {
  (window as unknown as { openreel?: unknown }).openreel = bridge ? { platform: "desktop", ...bridge } : undefined;
}

function renderModel() {
  const handlers = { onContinue: vi.fn(), onLearn: vi.fn(), onLater: vi.fn() };
  render(<ConnectModel {...handlers} />);
  return handlers;
}

beforeEach(() => {
  localStorage.clear();
  script.responses = [ok, tool];
  useAIConnectionStore.setState({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    apiKey: "",
    remember: false,
  });
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { openreel?: unknown }).openreel;
  vi.restoreAllMocks();
});

describe("ConnectModel", () => {
  it("detects a running Ollama, preselects it and lists its models", async () => {
    setBridge({
      ollama: { probe: async () => ({ reachable: true, models: [{ name: "llama3.1:8b" }, { name: "qwen2.5:7b" }] }) },
    });
    renderModel();
    expect(await screen.findByText("Detected · 2 models")).toBeInTheDocument();
    const local = screen.getByRole("radio", { name: /Local model \(Ollama\)/ });
    await waitFor(() => expect(local).toHaveAttribute("aria-checked", "true"));
    const select = screen.getByRole("combobox", { name: "Model" });
    expect(select).toHaveValue("llama3.1:8b");
    expect(screen.queryByLabelText(/API key/)).toBeNull();
  });

  it("handles a failing or timed-out probe silently and offers to check again", async () => {
    const probe = vi.fn(async () => {
      throw new Error("net::ERR_FAILED (CORS)");
    });
    setBridge({ ollama: { probe } });
    renderModel();
    fireEvent.click(await screen.findByRole("radio", { name: /Local model \(Ollama\)/ }));
    expect(await screen.findByText(/Ollama was not found/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("radio", { name: /Anthropic/ })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "check again" }));
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
  });

  it("has no hosted option and shows Anthropic's recommended default", async () => {
    renderModel();
    expect(screen.queryByText(/OpenReel AI/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Anthropic/ }));
    const model = screen.getByRole("combobox", { name: "Model" });
    expect(model).toHaveValue("claude-sonnet-5-5");
    expect(Array.from((model as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-haiku-5-5",
    ]);
  });

  it("shows the plain-language key explainer on demand", () => {
    renderModel();
    expect(screen.queryByText(KEY_EXPLAINER)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "How do I get a key?" }));
    expect(screen.getByText(KEY_EXPLAINER)).toBeInTheDocument();
  });

  it("shows the tool-call probe failure message for a model that cannot use tools", async () => {
    script.responses = [ok, ok];
    renderModel();
    fireEvent.click(screen.getByRole("radio", { name: /Anthropic/ }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(
      await screen.findByText("This model answered but can't use editing tools. Try another model."),
    ).toBeInTheDocument();
  });

  it("reports success when the model answers and calls the tool", async () => {
    renderModel();
    fireEvent.click(screen.getByRole("radio", { name: /Anthropic/ }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/editing tools work/)).toBeInTheDocument();
  });

  it("requires a key before continuing and saves a valid connection", () => {
    const handlers = renderModel();
    fireEvent.click(screen.getByRole("radio", { name: /Anthropic/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Enter your provider API key.")).toBeInTheDocument();
    expect(handlers.onContinue).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(handlers.onContinue).toHaveBeenCalled();
    expect(useAIConnectionStore.getState()).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      apiKey: "test-key",
      remember: false,
    });
  });

  it("offers Remember on this device only on desktop, off by default", () => {
    renderModel();
    expect(screen.queryByText("Remember on this device")).toBeNull();
    cleanup();
    setBridge({ keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } });
    renderModel();
    const box = screen.getByRole("checkbox", { name: /Remember on this device/ });
    expect(box).not.toBeChecked();
  });

  it("routes the escape hatches", () => {
    const handlers = renderModel();
    fireEvent.click(screen.getByRole("button", { name: /Learn to edit first/ }));
    fireEvent.click(screen.getByRole("button", { name: /connect later/ }));
    expect(handlers.onLearn).toHaveBeenCalled();
    expect(handlers.onLater).toHaveBeenCalled();
  });
});

describe("ConnectModel Get a key", () => {
  it("opens the provider console with noopener,noreferrer", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderModel();
    fireEvent.click(screen.getByRole("radio", { name: /Anthropic/ }));
    fireEvent.click(screen.getByRole("button", { name: /Get a key/ }));
    expect(open).toHaveBeenCalledWith("https://console.anthropic.com/settings/keys", "_blank", "noopener,noreferrer");
  });
});
