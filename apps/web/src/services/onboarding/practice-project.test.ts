import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEditorProject: vi.fn(),
  importMedia: vi.fn(),
}));
vi.mock("../project-creation", () => ({ createEditorProject: mocks.createEditorProject }));
vi.mock("../../stores/project-store", () => ({
  useProjectStore: { getState: () => ({ importMedia: mocks.importMedia }) },
}));

import { useOnboardingStore } from "../../stores/onboarding-store";
import {
  PracticeUnavailableError,
  listPracticeClips,
  loadPracticeFiles,
  practiceClipsAvailable,
  startOwnClipProject,
  startPracticeProject,
} from "./practice-project";

const infos = [
  { id: "music", name: "Practice beat", kind: "audio", durationSec: 20, sizeBytes: 3, mimeType: "audio/mpeg", license: "CC0" },
  { id: "a", name: "A", kind: "video", durationSec: 6, width: 1280, height: 720, sizeBytes: 3, mimeType: "video/mp4", license: "CC0" },
  { id: "b", name: "B", kind: "video", durationSec: 6, width: 1280, height: 720, sizeBytes: 3, mimeType: "video/mp4", license: "CC0" },
] as const;

function installSamples(): void {
  window.openreel = {
    samples: {
      list: vi.fn().mockResolvedValue([...infos]),
      get: vi.fn(async (id: string) => {
        const info = infos.find((i) => i.id === id);
        return info ? { id, name: `${id}.${info.kind === "audio" ? "mp3" : "mp4"}`, mimeType: info.mimeType, bytes: new Uint8Array([1, 2, 3]).buffer } : null;
      }),
    },
  } as unknown as Window["openreel"];
}

beforeEach(() => {
  mocks.createEditorProject.mockResolvedValue({ id: "proj-1" });
  mocks.importMedia.mockResolvedValue({ success: true });
  useOnboardingStore.getState().reset();
  useOnboardingStore.setState({ formatChosenProjectId: undefined, persona: undefined, path: undefined });
  window.location.hash = "#/welcome";
});
afterEach(() => {
  delete (window as { openreel?: unknown }).openreel;
  vi.clearAllMocks();
});

describe("practice project", () => {
  it("is unavailable without the desktop samples API (web build, or pack not shipped)", async () => {
    expect(await listPracticeClips()).toEqual([]);
    expect(await practiceClipsAvailable()).toBe(false);
    await expect(loadPracticeFiles()).rejects.toBeInstanceOf(PracticeUnavailableError);

    window.openreel = { samples: { list: vi.fn().mockResolvedValue([]), get: vi.fn() } } as unknown as Window["openreel"];
    expect(await practiceClipsAvailable()).toBe(false);
  });

  it("loads videos first and the music last, as real File objects with the right type", async () => {
    installSamples();
    const files = await loadPracticeFiles();
    expect(files.map((f) => f.name)).toEqual(["a.mp4", "b.mp4", "music.mp3"]);
    expect(files[0].type).toBe("video/mp4");
    expect(files[2].type).toBe("audio/mpeg");
    expect(files[0].size).toBe(3);
  });

  it("creates a 1080p30 project, imports every clip into the library and opens the editor", async () => {
    installSamples();
    const stages: string[] = [];
    const result = await startPracticeProject((p) => stages.push(p.stage));

    expect(mocks.createEditorProject).toHaveBeenCalledWith({
      name: "Practice project",
      settings: { width: 1920, height: 1080, frameRate: 30 },
    });
    expect(mocks.importMedia).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ projectId: "proj-1", imported: 3, failed: [] });
    expect(window.location.hash).toBe("#/editor");
    expect(stages[0]).toBe("Creating your project");
    expect(stages.at(-1)).toBe("Ready");

    const ob = useOnboardingStore.getState();
    expect(ob.formatChosenProjectId).toBe("proj-1");
    expect(ob).toMatchObject({ status: "in-progress", persona: "learn", path: "learn" });
  });

  it("keeps going when one clip fails and reports it", async () => {
    installSamples();
    mocks.importMedia.mockResolvedValueOnce({ success: false }).mockResolvedValue({ success: true });
    const result = await startPracticeProject();
    expect(result.imported).toBe(2);
    expect(result.failed).toEqual(["a.mp4"]);
  });

  it("fails with a clear message when nothing could be imported, without opening the editor", async () => {
    installSamples();
    mocks.importMedia.mockResolvedValue({ success: false });
    await expect(startPracticeProject()).rejects.toThrow(/could be imported/);
    expect(window.location.hash).toBe("#/welcome");
  });

  it("'Use my own clip' uses the same path with its own name", async () => {
    const file = new File([new Uint8Array([9])], "mine.mov", { type: "video/quicktime" });
    const result = await startOwnClipProject([file]);
    expect(mocks.createEditorProject).toHaveBeenCalledWith(expect.objectContaining({ name: "My first edit" }));
    expect(mocks.importMedia).toHaveBeenCalledWith(file);
    expect(result.imported).toBe(1);
  });

  it("rejects an empty pick", async () => {
    await expect(startOwnClipProject([])).rejects.toThrow(/Pick a clip/);
    expect(mocks.createEditorProject).not.toHaveBeenCalled();
  });
});
