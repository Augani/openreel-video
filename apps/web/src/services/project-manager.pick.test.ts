import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectManager } from "./project-manager";
import { createEmptyProject } from "../stores/project/project-helpers";
import type { MediaItem } from "@openreel/core";

const project = createEmptyProject("Chosen project");
const oldFile = { kind: "native" as const, path: "/previous.oreel" };
beforeEach(() => {
  projectManager.activatePickedProject({ project: createEmptyProject("Previous"), fileHandle: oldFile });
});
afterEach(() => {
  delete window.openreel;
  delete (window as Window & { showOpenFilePicker?: unknown }).showOpenFilePicker;
  vi.restoreAllMocks();
  projectManager.releaseCurrentFileHandle();
});

describe("staged project file selection", () => {
  it.each([
    ["native", false], ["native", true], ["browser", false], ["browser", true],
  ] as const)("makes serialized media relinkable for %s files (wrapped: %s)", async (platform, wrapped) => {
    const media = { id: "image", name: "iris-pattern.png", type: "image", blob: new Blob(["original pixels"]),
      fileHandle: { getFile: async () => new File(["original pixels"], "iris-pattern.png") },
      isPlaceholder: false, metadata: { fileSize: 15, width: 1920, height: 1080 }, thumbnailUrl: "data:image/png;base64,AA==",
      sourceFile: { name: "iris-pattern.png", size: 15, lastModified: 10 } } as unknown as MediaItem;
    const source = { ...project, mediaLibrary: { items: [media] } };
    const json = JSON.stringify(wrapped ? { version: "1.2.0", project: source } : source);
    if (platform === "native") window.openreel = { fs: { showOpenDialog: vi.fn(async () => "/chosen.oreel"), readFile: vi.fn(async () => json) } } as unknown as NonNullable<Window["openreel"]>;
    else Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => [{ getFile: async () => ({ text: async () => json }) }] });
    const picked = await projectManager.pickProjectFile();
    expect(picked?.project.mediaLibrary.items[0]).toEqual({ ...media, blob: null, fileHandle: null, isPlaceholder: true });
    expect(picked?.project.timeline).toEqual(source.timeline);
    expect(projectManager.getCurrentFileHandle()).toBe(oldFile);
    expect(media.blob).toBeInstanceOf(Blob);
    expect(typeof media.fileHandle?.getFile).toBe("function");
  });

  it("reads a native file without changing the current handle or publishing an opened project", async () => {
    const readFile = vi.fn(async () => JSON.stringify(project));
    window.openreel = { fs: { showOpenDialog: vi.fn(async () => "/chosen.oreel"), readFile } } as unknown as NonNullable<Window["openreel"]>;
    const opened = vi.fn(); const unsubscribe = projectManager.on("projectOpened", opened);
    const recent = vi.spyOn(projectManager, "addToRecent").mockResolvedValue();
    try {
      const picked = await projectManager.pickProjectFile();
      expect(picked?.project.id).toBe(project.id);
      expect(readFile).toHaveBeenCalledWith("/chosen.oreel");
      expect(projectManager.getCurrentFileHandle()).toBe(oldFile);
      expect(opened).not.toHaveBeenCalled(); expect(recent).not.toHaveBeenCalled();
      projectManager.activatePickedProject(picked!);
      expect(projectManager.getCurrentFileHandle()).toEqual({ kind: "native", path: "/chosen.oreel" });
      expect(opened).toHaveBeenCalledOnce(); expect(recent).toHaveBeenCalledOnce();
    } finally { unsubscribe(); }
  });

  it("keeps a browser file choice staged until activation and reports malformed content", async () => {
    const handle = { getFile: vi.fn(async () => ({ text: async () => JSON.stringify(project) })) };
    const picker = vi.fn(async () => [handle]);
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: picker });
    const picked = await projectManager.pickProjectFile();
    expect(picked?.fileHandle).toBe(handle);
    expect(projectManager.getCurrentFileHandle()).toBe(oldFile);
    handle.getFile.mockResolvedValueOnce({ text: async () => "not a project" });
    await expect(projectManager.pickProjectFile()).rejects.toThrow("Invalid project file");
    expect(projectManager.getCurrentFileHandle()).toBe(oldFile);
    picker.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
    await expect(projectManager.pickProjectFile()).resolves.toBeNull();
  });

  it("settles a cancelled fallback picker and removes the temporary input", async () => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const choosing = projectManager.pickProjectFile();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe(".oreel,.json");
    input.dispatchEvent(new Event("cancel"));
    await expect(choosing).resolves.toBeNull();
    expect(input.isConnected).toBe(false);
    expect(projectManager.getCurrentFileHandle()).toBe(oldFile);
  });
});
