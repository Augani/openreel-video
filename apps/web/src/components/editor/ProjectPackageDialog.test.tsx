import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { projectManager } from "../../services/project-manager";
import { readProjectPackageContents } from "../../services/project-package";
import { autoSaveManager } from "../../services/auto-save";
import { saveMediaBlob, deleteMediaBlob } from "../../services/media-storage";
import { registerEmbeddedFont } from "./inspector/font-options";
import { toast } from "../../stores/notification-store";
import { Blob as NodeBlob } from "node:buffer";
import { ProjectPackageDialog } from "./ProjectPackageDialog";
import { useTimelineStore } from "../../stores/timeline-store";

vi.mock("../../services/project-package", async (original) => ({
  ...(await original<typeof import("../../services/project-package")>()),
  readProjectPackageContents: vi.fn(),
}));
vi.mock("./inspector/font-options", () => ({
  createCustomFontReader: vi.fn(async () => ({ read: async () => null, isUserFont: () => false })),
  compareRegisteredFont: vi.fn(async () => "absent"),
  registerEmbeddedFont: vi.fn(async () => {}),
}));
vi.mock("../../services/media-storage", () => ({
  loadMediaBlob: vi.fn(),
  saveMediaBlob: vi.fn(async () => {}),
  deleteMediaBlob: vi.fn(async () => {}),
}));
vi.mock("../../utils/media-recovery", () => ({
  restoreMediaItem: vi.fn(async (item: unknown) => item),
}));
const source = new Blob(["original media"], { type: "video/mp4" });
function backup(count = 1) {
  const project = createEmptyProject("Restored backup");
  return {
    ...project,
    mediaLibrary: {
      items: Array.from({ length: count }, (_, index) => ({
        id: `original-${index}`,
        name: `camera-${index}.mp4`,
        type: "video" as const,
        blob: source,
        fileHandle: null,
        waveformData: null,
        thumbnailUrl: null,
        metadata: {
          duration: 2,
          width: 640,
          height: 360,
          frameRate: 24,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: source.size,
        },
      })),
    },
  };
}
async function chooseBackup(count = 1) {
  vi.mocked(readProjectPackageContents).mockResolvedValue({ project: backup(count), fonts: [], fontRecords: [] });
  fireEvent.change(screen.getByLabelText("Project backup file"), {
    target: { files: [new File(["package"], "video.oreelpack")] },
  });
  await screen.findByRole("button", { name: "Open this project" });
}
beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({
    project: createEmptyProject("Current work"),
    hasOpenProject: true,
  });
  useUIStore.setState({
    exportState: { ...useUIStore.getState().exportState, isExporting: false },
  });
  vi.spyOn(autoSaveManager, "forceSave").mockResolvedValue();
  vi.spyOn(autoSaveManager, "clearProjectSaves").mockResolvedValue();
  vi.spyOn(projectManager, "releaseCurrentFileHandle");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("project backup restoration", () => {
  it("registers embedded fonts before the restored project is loaded", async () => {
    const order: string[] = [];
    vi.mocked(registerEmbeddedFont).mockImplementation(async (family) => void order.push("register:" + family));
    const load = useProjectStore.getState().loadProject;
    vi.spyOn(useProjectStore.getState(), "loadProject").mockImplementation((p) => {
      order.push("load");
      load(p);
    });
    render(<ProjectPackageDialog onClose={() => {}} />);
    vi.mocked(readProjectPackageContents).mockResolvedValue({
      project: backup(1),
      fonts: [{ family: "Brand Open", data: new NodeBlob([new Uint8Array([1, 2])]) as unknown as Blob, readOnly: false }],
      fontRecords: [],
    });
    fireEvent.change(screen.getByLabelText("Project backup file"), {
      target: { files: [new File(["package"], "video.oreelpack")] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Open this project" }));
    await waitFor(() => expect(order).toContain("load"));
    expect(order).toEqual(["register:Brand Open", "load"]);
  });

  it("registers read-only fonts as read-only and tells the user on open", async () => {
    const info = vi.spyOn(toast, "info");
    render(<ProjectPackageDialog onClose={() => {}} />);
    vi.mocked(readProjectPackageContents).mockResolvedValue({
      project: backup(1),
      fonts: [{ family: "Print Only", data: new NodeBlob([new Uint8Array([1, 2])]) as unknown as Blob, readOnly: true }],
      fontRecords: [],
    });
    fireEvent.change(screen.getByLabelText("Project backup file"), {
      target: { files: [new File(["package"], "video.oreelpack")] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Open this project" }));
    await waitFor(() => expect(registerEmbeddedFont).toHaveBeenCalled());
    expect(vi.mocked(registerEmbeddedFont).mock.calls[0][2]).toEqual({ readOnly: true });
    await waitFor(() =>
      expect(info).toHaveBeenCalledWith("Read-only fonts in this project", expect.stringContaining("Print Only")),
    );
  });

  it("cancels package inspection through the dialog without replacing current work", async () => {
    const close = vi.fn();
    let signal: AbortSignal | undefined;
    vi.mocked(readProjectPackageContents).mockImplementationOnce(
      (_file, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal;
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    const previousId = useProjectStore.getState().project.id;
    render(<ProjectPackageDialog onClose={close} />);
    fireEvent.change(screen.getByLabelText("Project backup file"), {
      target: { files: [new File(["package"], "video.oreelpack")] },
    });
    await screen.findByRole("button", { name: "Cancel operation" });
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(useProjectStore.getState().project.id).toBe(previousId);
    expect(saveMediaBlob).not.toHaveBeenCalled();
  });

  it("retains dialog ownership while the restored copy is being committed", async () => {
    let finish!: () => void;
    vi.mocked(autoSaveManager.forceSave).mockImplementation(async (project) => {
      if (project.name === "Restored backup")
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    });
    const close = vi.fn();
    render(<ProjectPackageDialog onClose={close} />);
    await chooseBackup();
    fireEvent.click(screen.getByRole("button", { name: "Open this project" }));
    await screen.findByText("Finishing project restore…");
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Cancel operation" }),
    ).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
    });
    expect(close).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(useProjectStore.getState().project.name).toBe("Restored backup");
  });

  it("saves current work, persists new media IDs and detaches the old file before opening a copy", async () => {
    useTimelineStore.setState({
      playbackLockedReason: null,
      playheadPosition: 90,
      loopStart: 80,
      loopEnd: 90,
      loopEnabled: true,
    });
    const previousId = useProjectStore.getState().project.id;
    const close = vi.fn();
    render(<ProjectPackageDialog onClose={close} />);
    await chooseBackup();
    fireEvent.click(screen.getByRole("button", { name: "Open this project" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(autoSaveManager.forceSave).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: previousId }),
    );
    const next = useProjectStore.getState().project;
    expect(next.id).not.toBe(previousId);
    expect(next.name).toBe("Restored backup");
    expect(next.mediaLibrary.items[0].id).not.toBe("original-0");
    expect(saveMediaBlob).toHaveBeenCalledWith(
      next.id,
      next.mediaLibrary.items[0].id,
      source,
      expect.any(Object),
    );
    expect(projectManager.releaseCurrentFileHandle).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
    expect(useTimelineStore.getState().loopEnabled).toBe(false);
  });
  it("saves edits made while backup media is being restored before committing", async () => {
    let finish!: () => void;
    vi.mocked(saveMediaBlob).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const close = vi.fn();
    render(<ProjectPackageDialog onClose={close} />);
    await chooseBackup();
    fireEvent.click(screen.getByRole("button", { name: "Open this project" }));
    await waitFor(() => expect(saveMediaBlob).toHaveBeenCalledOnce());
    const current = useProjectStore.getState().project;
    act(() =>
      useProjectStore.setState({
        project: { ...current, name: "Edited during restore" },
      }),
    );
    finish();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(autoSaveManager.forceSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: current.id,
        name: "Edited during restore",
      }),
    );
  });

  it("rolls back new media on a storage failure while keeping the current project and its save handle", async () => {
    const previousId = useProjectStore.getState().project.id;
    vi.mocked(saveMediaBlob)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("Disk full"));
    const close = vi.fn();
    render(<ProjectPackageDialog onClose={close} />);
    await chooseBackup(2);
    fireEvent.click(screen.getByRole("button", { name: "Open this project" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Disk full"),
    );
    expect(deleteMediaBlob).toHaveBeenCalledWith(
      vi.mocked(saveMediaBlob).mock.calls[0][1],
    );
    expect(useProjectStore.getState().project.id).toBe(previousId);
    expect(projectManager.releaseCurrentFileHandle).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
  it("does not replace the project if checking a package fails", async () => {
    const previousId = useProjectStore.getState().project.id;
    vi.mocked(readProjectPackageContents).mockRejectedValue(
      new Error("Incomplete media"),
    );
    render(<ProjectPackageDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Project backup file"), {
      target: { files: [new File(["bad"], "bad.oreelpack")] },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Incomplete media"),
    );
    expect(useProjectStore.getState().project.id).toBe(previousId);
    expect(saveMediaBlob).not.toHaveBeenCalled();
  });
});
