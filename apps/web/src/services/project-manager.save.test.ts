import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectManager } from "./project-manager";
import { createEmptyProject } from "../stores/project/project-helpers";

const project = createEmptyProject("My video");

beforeEach(() => {
  (projectManager as unknown as { currentFileHandle: unknown }).currentFileHandle = null;
  delete window.openreel;
});
afterEach(() => {
  delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  delete window.openreel;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockPicker(handle?: unknown, error?: Error) {
  const picker = error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue(handle);
  Object.defineProperty(window, "showSaveFilePicker", { value: picker, configurable: true });
  return picker;
}

function browserWriter() {
  const writable = {
    write: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  const handle = { createWritable: vi.fn(async () => writable) };
  mockPicker(handle);
  return { handle, writable };
}

function mockDownload() {
  const createObjectURL = vi.fn(() => "blob:project-download");
  const revokeObjectURL = vi.fn();
  class DownloadURL extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal("URL", DownloadURL);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { click, createObjectURL, revokeObjectURL };
}

describe("ProjectManager save outcomes", () => {
  it("returns false for a cancelled picker without emitting a save", async () => {
    mockPicker(undefined, new DOMException("Cancelled", "AbortError"));
    const saved = vi.fn();
    const unsubscribe = projectManager.on("projectSaved", saved);

    await expect(projectManager.saveProjectAs(project)).resolves.toBe(false);
    expect(saved).not.toHaveBeenCalled();
    expect(projectManager.getCurrentFileHandle()).toBeNull();
    unsubscribe();
  });

  it("rejects a failed first write instead of treating it as cancellation or downloading", async () => {
    const { writable } = browserWriter();
    writable.write.mockRejectedValueOnce(new Error("Disk full"));
    const download = mockDownload();
    const saved = vi.fn();
    const unsubscribe = projectManager.on("projectSaved", saved);

    await expect(projectManager.saveProjectAs(project)).rejects.toThrow("Disk full");
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(writable.close).not.toHaveBeenCalled();
    expect(download.click).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    expect(projectManager.getCurrentFileHandle()).toBeNull();
    unsubscribe();
  });

  it("rejects commit failures and retains the existing handle for a retry", async () => {
    const { handle, writable } = browserWriter();
    await expect(projectManager.saveProjectAs(project)).resolves.toBe(true);
    const saved = vi.fn();
    const unsubscribe = projectManager.on("projectSaved", saved);
    writable.close.mockRejectedValueOnce(new Error("Permission revoked"));

    await expect(projectManager.saveProject(project)).rejects.toThrow("Permission revoked");
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(projectManager.getCurrentFileHandle()).toBe(handle);
    expect(saved).not.toHaveBeenCalled();
    await expect(projectManager.saveProject(project)).resolves.toBe(true);
    expect(saved).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("preserves the original write error if aborting the stream also fails", async () => {
    const { writable } = browserWriter();
    writable.write.mockRejectedValueOnce(new Error("Write failed"));
    writable.abort.mockRejectedValueOnce(new Error("Already closed"));

    await expect(projectManager.saveProjectAs(project)).rejects.toThrow("Write failed");
  });

  it("rejects failures while overwriting an existing native file", async () => {
    const writeFile = vi.fn(async () => {});
    window.openreel = {
      fs: { showSaveDialog: vi.fn(async () => "/tmp/video.oreel"), writeFile },
    } as unknown as NonNullable<Window["openreel"]>;
    await expect(projectManager.saveProjectAs(project)).resolves.toBe(true);
    writeFile.mockRejectedValueOnce(new Error("Read-only folder"));

    await expect(projectManager.saveProject(project)).rejects.toThrow("Read-only folder");
  });

  it("rejects a failed download and releases its temporary URL and link", async () => {
    const { click, revokeObjectURL } = mockDownload();
    click.mockImplementationOnce(() => { throw new Error("Download failed"); });

    await expect(projectManager.saveProjectAs(project)).rejects.toThrow("Download failed");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:project-download");
    expect(document.querySelector('a[download="My video.oreel"]')).toBeNull();
  });
});
