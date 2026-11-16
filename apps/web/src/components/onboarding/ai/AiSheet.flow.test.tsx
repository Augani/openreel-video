import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LLMResponse } from "@openreel/agent";
import AiSheet from "./AiSheet";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { useProjectStore } from "../../../stores/project-store";

const mocks = vi.hoisted(() => ({
  script: [] as LLMResponse[],
  createProject: vi.fn(),
  handOff: vi.fn(async () => undefined),
}));

vi.mock("../../../services/agent/direct-llm-transport", async () => {
  const agent = await import("@openreel/agent");
  return {
    validateAIEndpoint: (url: string) => new URL(url).href,
    // A fresh scripted MockLLMClient per connection test, so the flow uses the real client interface.
    makeDirectBYOKClient: () => new agent.MockLLMClient(mocks.script),
  };
});
vi.mock("../../../services/project-creation", () => ({ createEditorProject: mocks.createProject }));
vi.mock("./handoff", () => ({ handOffToEditorChat: mocks.handOff }));

const ok: LLMResponse = { text: "OK", toolUses: [], stopReason: "end_turn" };
const tool: LLMResponse = {
  text: "",
  toolUses: [{ id: "t1", name: "report_ready", input: { ok: true } }],
  stopReason: "tool_use",
};

const importMedia = vi.fn(async (_file: File, _onProgress?: (stage: string) => void) => ({ success: true }));

beforeEach(() => {
  localStorage.clear();
  mocks.script = [ok, tool];
  mocks.createProject.mockReset();
  mocks.createProject.mockResolvedValue({ id: "proj-1" });
  mocks.handOff.mockClear();
  importMedia.mockClear();
  importMedia.mockResolvedValue({ success: true });
  useProjectStore.setState({ importMedia } as never);
  useOnboardingStore.getState().reset();
  useAIConnectionStore.setState({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    apiKey: "",
    remember: false,
  });
});
afterEach(cleanup);

function pickFile(name = "clip.mp4", type = "video/mp4") {
  const input = screen.getByLabelText("Choose clip files") as HTMLInputElement;
  const file = new File([new Uint8Array(8)], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe("AiSheet flow", () => {
  it("connects, creates a project with the clips, then hands the prompt to the editor chat", async () => {
    const onClose = vi.fn();
    render(<AiSheet onClose={onClose} />);
    expect(screen.getByRole("heading", { name: "Pick the AI that will edit for you" })).toBeInTheDocument();
    expect(useOnboardingStore.getState()).toMatchObject({ status: "in-progress", persona: "ai", path: "ai" });

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic/ }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/editing tools work/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Bring your clips" })).toBeInTheDocument();
    expect(useAIConnectionStore.getState()).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    const file = pickFile();
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Describe your video" })).toBeInTheDocument();
    expect(mocks.createProject).toHaveBeenCalledTimes(1);
    expect(mocks.createProject.mock.calls[0][0]).toMatchObject({
      name: "New Horizontal Video",
      settings: { width: 1920, height: 1080 },
    });
    expect(importMedia).toHaveBeenCalledWith(file, expect.any(Function));
    expect(useOnboardingStore.getState().formatChosenProjectId).toBe("proj-1");

    fireEvent.click(screen.getByRole("button", { name: "Even out the volume and add fade in and out" }));
    fireEvent.click(screen.getByRole("button", { name: "Make my video" }));

    expect(mocks.handOff).toHaveBeenCalledWith("Even out the volume and add fade in and out", { connected: true });
    expect(useOnboardingStore.getState().status).toBe("done");
    expect(onClose).toHaveBeenCalled();
  });

  it("skips the connect step when a model is already configured", () => {
    useAIConnectionStore.setState({ provider: "compatible", baseUrl: "http://localhost:9911/v1", model: "local", apiKey: "" });
    render(<AiSheet onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Bring your clips" })).toBeInTheDocument();
  });

  it("lets the user pick the vertical format and creates the project with it", async () => {
    useAIConnectionStore.setState({ provider: "compatible", baseUrl: "http://localhost:9911/v1", model: "local", apiKey: "" });
    render(<AiSheet onClose={vi.fn()} />);
    pickFile("song.mp3", "audio/mpeg");
    fireEvent.click(screen.getByRole("radio", { name: /Vertical/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalled());
    expect(mocks.createProject.mock.calls[0][0].settings).toMatchObject({ width: 1080, height: 1920 });
  });

  it("rejects non-media files and keeps Continue disabled", () => {
    useAIConnectionStore.setState({ provider: "compatible", baseUrl: "http://localhost:9911/v1", model: "local", apiKey: "" });
    render(<AiSheet onClose={vi.fn()} />);
    pickFile("notes.txt", "text/plain");
    expect(screen.getByRole("alert")).toHaveTextContent(/Skipped 1 file/);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("stays on the clips step with an error when nothing imports, and retries without a second project", async () => {
    useAIConnectionStore.setState({ provider: "compatible", baseUrl: "http://localhost:9911/v1", model: "local", apiKey: "" });
    importMedia.mockResolvedValueOnce({ success: false, error: { message: "Unsupported codec" } } as never);
    render(<AiSheet onClose={vi.fn()} />);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported codec");
    expect(screen.getByRole("heading", { name: "Bring your clips" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Describe your video" })).toBeInTheDocument();
    expect(mocks.createProject).toHaveBeenCalledTimes(1);
  });

  it("the Learn escape hatch switches the sheet to the learn path", () => {
    render(<AiSheet onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Learn to edit first/ }));
    expect(useOnboardingStore.getState()).toMatchObject({ openSheet: "learn", persona: "learn", path: "learn" });
  });

  it("closes on Escape and is a labelled modal dialog", () => {
    const onClose = vi.fn();
    render(<AiSheet onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Pick the AI that will edit for you");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
