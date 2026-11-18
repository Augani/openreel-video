import "../../test/install-local-storage-mock";
import {
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WorkspaceGeneratePanel } from "./WorkspaceGeneratePanel";
import { useProjectStore } from "../../stores/project-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import type { MediaItem } from "@openreel/core";
import { useTimelineStore } from "../../stores/timeline-store";
import { useKieAIStore } from "../../stores/kieai-store";
import { useSettingsStore } from "../../stores/settings-store";
const { createImageTask, post } = vi.hoisted(() => ({
  createImageTask: vi.fn(),
  post: vi.fn(),
}));
vi.mock("../../services/kieai/image-generation", () => ({
  createImageTask,
  IMAGE_MODELS: { Z_IMAGE: "z-image", NANO_BANANA2: "nano-banana-2" },
}));
vi.mock("../../services/kieai/client", () => ({ kieaiPostJson: post }));
const vault = vi.hoisted(() => ({ stored: true, unlocked: true }));
vi.mock("../../services/secure-storage", () => ({
  hasSecret: async () => vault.stored,
  isSessionUnlocked: () => vault.unlocked,
  onSessionLock: () => () => {},
}));
vi.mock("./inspector/TextToSpeechPanel", () => ({
  TextToSpeechPanel: () => null,
}));
vi.mock("./inspector/MusicLibraryPanel", () => ({
  MusicLibraryPanel: () => null,
}));
vi.mock("./AIGenTab", () => ({ AIGenTab: () => null }));
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
afterAll(() => {
  if (originalScrollIntoView)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
beforeEach(() => {
  useProjectStore.setState({
    project: createEmptyProject("Generation verification"),
  });
  useKieAIStore.setState({ tasks: [] });
  vault.stored = true;
  vault.unlocked = true;
  useSettingsStore.setState({ configuredServices: ["kie-ai"] });
  createImageTask.mockReset();
  post.mockReset();
});
afterEach(cleanup);
function prompt() {
  fireEvent.change(screen.getByLabelText("Generation prompt"), {
    target: { value: "Aerial shot of a market at golden hour" },
  });
}
describe("Generation workflow", () => {
  it("is honest when no key is connected", async () => {
    vault.stored = false;
    useSettingsStore.setState({ configuredServices: [] });
    render(<WorkspaceGeneratePanel />);
    prompt();
    expect(await screen.findByText("Add a key to generate")).toBeTruthy();
    expect(screen.queryByText(/Model · /)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Generate 4 variations" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText(/Add your KieAI API key/)).toBeTruthy();
  });
  it("does not trust a stale configured list when the key is gone", async () => {
    vault.stored = false;
    render(<WorkspaceGeneratePanel />);
    prompt();
    expect(await screen.findByText("Add a key to generate")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Generate 4 variations" }),
    ).toHaveProperty("disabled", true);
  });
  it("asks to unlock when the key exists but the session is locked", async () => {
    vault.unlocked = false;
    render(<WorkspaceGeneratePanel />);
    prompt();
    expect(await screen.findByText("Unlock keys to generate")).toBeTruthy();
    expect(screen.queryByText(/Model · /)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Generate 4 variations" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });
  it("shows the model and enables Generate only when the key is usable", async () => {
    render(<WorkspaceGeneratePanel />);
    prompt();
    expect(await screen.findByText("Model · Z-Image")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Generate 4 variations" }),
    ).toHaveProperty("disabled", false);
  });
  it("gives every style chip an icon", () => {
    render(<WorkspaceGeneratePanel />);
    for (const name of ["Cinematic", "Photo", "Documentary", "Illustration"])
      expect(screen.getByRole("button", { name }).querySelector("svg")).toBeTruthy();
  });
  it("tracks four submitted images as real pending media without fabricated progress", async () => {
    createImageTask.mockImplementation(
      async () => `task-${createImageTask.mock.calls.length}`,
    );
    render(<WorkspaceGeneratePanel />);
    prompt();
    await screen.findByText(/Model · /);
    fireEvent.click(
      screen.getByRole("button", { name: "Generate 4 variations" }),
    );
    await waitFor(() => expect(useKieAIStore.getState().tasks).toHaveLength(4));
    expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(
      4,
    );
    expect(
      useProjectStore
        .getState()
        .project.mediaLibrary.items.every((m) => m.isPending && !m.blob),
    ).toBe(true);
    expect(screen.queryByText(/62%/)).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
  it("preserves successfully submitted work when a later variation fails", async () => {
    createImageTask
      .mockResolvedValueOnce("first-task")
      .mockRejectedValueOnce(new Error("Provider unavailable"));
    render(<WorkspaceGeneratePanel />);
    prompt();
    await screen.findByText(/Model · /);
    fireEvent.click(
      screen.getByRole("button", { name: "Generate 4 variations" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("1 task submitted"),
    );
    expect(useKieAIStore.getState().tasks).toHaveLength(1);
    expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(
      1,
    );
  });
  it("uses the documented video contract and queues video results for the existing poller", async () => {
    post.mockResolvedValue({ taskId: "video-task" });
    render(<WorkspaceGeneratePanel />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Video" }), {
      button: 0,
      ctrlKey: false,
    });
    prompt();
    await screen.findByText(/Model · /);
    fireEvent.click(
      screen.getByRole("button", { name: "Generate 4 variations" }),
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(4));
    expect(post).toHaveBeenCalledWith(
      "/api/v1/jobs/createTask",
      {
        model: "kling-2.6/text-to-video",
        input: {
          prompt:
            "Aerial shot of a market at golden hour\nVisual style: cinematic.",
          sound: false,
          aspect_ratio: "16:9",
          duration: "5",
        },
      },
      "https://api.kie.ai",
    );
    expect(
      useKieAIStore.getState().tasks.every((t) => t.type === "video"),
    ).toBe(true);
  });
  it("selects completed results, keeps pending results unavailable, and retries failed work", async () => {
    const base: MediaItem = {
      id: "complete",
      name: "AI_market.png",
      type: "image",
      fileHandle: null,
      blob: new Blob(["fixture"]),
      thumbnailUrl: "data:image/png;base64,fixture",
      waveformData: null,
      metadata: {
        duration: 0,
        width: 640,
        height: 360,
        frameRate: 0,
        codec: "png",
        sampleRate: 0,
        channels: 0,
        fileSize: 7,
      },
    };
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        mediaLibrary: {
          items: [
            base,
            {
              ...base,
              id: "pending",
              name: "AI_pending.png",
              isPending: true,
              isPlaceholder: true,
            },
            {
              ...base,
              id: "failed",
              name: "AI_failed.png",
              isPending: false,
              isPlaceholder: true,
              kieaiError: true,
              kieaiTaskId: "failed-task",
            },
          ],
        },
      },
    });
    useKieAIStore.getState().addTask({
      taskId: "failed-task",
      mediaId: "failed",
      projectId: project.id,
      type: "image",
      suggestedName: "AI_failed.png",
      createdAt: Date.now(),
    });
    useKieAIStore.getState().markFailed("failed-task");
    const place = vi
      .spyOn(useProjectStore.getState(), "placeMediaClip")
      .mockResolvedValue({ success: true });
    useTimelineStore.setState({ playheadPosition: 3 });
    render(<WorkspaceGeneratePanel />);
    expect(
      screen.getByRole("button", { name: "Select result AI_market.png" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Select result AI_pending.png" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Select result AI_failed.png" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("progressbar", { name: "Generating AI_pending.png" }),
    ).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("Generation failed")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Add selected to timeline" }),
    );
    await waitFor(() =>
      expect(place).toHaveBeenCalledWith("complete", undefined, 3),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry generation AI_failed.png" }),
    );
    expect(useKieAIStore.getState().tasks[0]).toMatchObject({
      taskId: "failed-task",
      failed: false,
      retries: 0,
    });
    expect(useProjectStore.getState().getMediaItem("failed")).toMatchObject({
      isPending: true,
      kieaiError: false,
    });
    place.mockRestore();
  });
});
