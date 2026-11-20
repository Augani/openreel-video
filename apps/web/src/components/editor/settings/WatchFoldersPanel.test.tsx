import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { OpenReelWatchFolderConfig, OpenReelWatchFoldersSnapshot } from "../../../types/global";
import { WatchFoldersPanel } from "./WatchFoldersPanel";

const base: OpenReelWatchFolderConfig = { id: "f1", kind: "ingest", path: "/Volumes/Card/DCIM", paused: false, bin: "Cards", createProxies: false, presetId: "1080p-high", outputDir: "", includeProjects: false, baselined: true, processExisting: false };
const exportFolder: OpenReelWatchFolderConfig = { ...base, id: "f2", kind: "export", path: "/Users/me/Hot", outputDir: "/Users/me/Hot/output", bin: "" };
const idle = { state: "watching" as const, detecting: 0, queued: 0, running: 0, done: 2, failed: 1, duplicates: 0 };

function install(snapshot: OpenReelWatchFoldersSnapshot) {
  const bridge = {
    list: vi.fn().mockResolvedValue(snapshot),
    add: vi.fn().mockResolvedValue({ added: true, id: "new" }),
    update: vi.fn().mockResolvedValue(undefined),
    pickOutput: vi.fn().mockResolvedValue({ changed: true }),
    remove: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    clearFinished: vi.fn().mockResolvedValue(undefined),
    onChange: vi.fn().mockReturnValue(() => undefined),
  };
  Object.defineProperty(window, "openreel", { configurable: true, value: { platform: "desktop", watchFolders: bridge } });
  return bridge;
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "openreel");
});

describe("WatchFoldersPanel", () => {
  it("lists folders with their state and counts", async () => {
    install({ folders: [{ config: base, status: idle }, { config: exportFolder, status: { ...idle, state: "paused", done: 0, failed: 0 } }], items: [] });
    render(<WatchFoldersPanel />);
    const cards = await screen.findAllByTestId("watch-folder");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("/Volumes/Card/DCIM")).toBeTruthy();
    expect(within(cards[0]).getByTestId("watch-folder-summary").textContent).toBe("2 done · 1 failed");
    expect(within(cards[1]).getByTestId("watch-folder-state").textContent).toBe("Paused");
    expect(within(cards[1]).getByTestId("watch-folder-summary").textContent).toBe("Nothing yet");
  });

  it("adds folders through the native dialog (the page never supplies a path)", async () => {
    const bridge = install({ folders: [], items: [] });
    render(<WatchFoldersPanel />);
    await screen.findByText("No watch folders yet.");
    fireEvent.click(screen.getByText("Add ingest folder"));
    await waitFor(() => expect(bridge.add).toHaveBeenCalledWith("ingest"));
    fireEvent.click(screen.getByText("Add export folder"));
    await waitFor(() => expect(bridge.add).toHaveBeenCalledWith("export"));
  });

  it("pauses, removes, and edits ingest options", async () => {
    const bridge = install({ folders: [{ config: base, status: idle }], items: [] });
    render(<WatchFoldersPanel />);
    fireEvent.click(await screen.findByLabelText("Pause /Volumes/Card/DCIM"));
    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith("f1", { paused: true }));
    fireEvent.click(screen.getByLabelText("Create proxies"));
    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith("f1", { createProxies: true }));
    const bin = screen.getByLabelText("Bin name");
    fireEvent.change(bin, { target: { value: "Day 2" } });
    fireEvent.blur(bin);
    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith("f1", { bin: "Day 2" }));
    fireEvent.click(screen.getByLabelText("Remove /Volumes/Card/DCIM"));
    await waitFor(() => expect(bridge.remove).toHaveBeenCalledWith("f1"));
  });

  it("edits export options and changes the output folder through the dialog", async () => {
    const bridge = install({ folders: [{ config: exportFolder, status: idle }], items: [] });
    render(<WatchFoldersPanel />);
    fireEvent.change(await screen.findByLabelText("Export preset"), { target: { value: "4k" } });
    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith("f2", { presetId: "4k" }));
    fireEvent.click(screen.getByLabelText("Render project files"));
    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith("f2", { includeProjects: true }));
    fireEvent.click(screen.getByText("Change"));
    await waitFor(() => expect(bridge.pickOutput).toHaveBeenCalledWith("f2"));
  });

  it("retries failed items and shows a refusal from the main process", async () => {
    const bridge = install({
      folders: [{ config: base, status: idle }],
      items: [{ id: "i1", folderId: "f1", name: "a.mp4", path: "/a.mp4", state: "failed", progress: null, error: "x", createdAt: 1 }],
    });
    bridge.update.mockRejectedValueOnce(new Error("Error invoking remote method 'openreel:watchFolders:update': Error: That watch folder no longer exists."));
    render(<WatchFoldersPanel />);
    fireEvent.click(await screen.findByText("Retry failed"));
    await waitFor(() => expect(bridge.retry).toHaveBeenCalledWith("i1"));
    fireEvent.click(screen.getByLabelText("Pause /Volumes/Card/DCIM"));
    expect((await screen.findByRole("alert")).textContent).toBe("That watch folder no longer exists.");
  });

  it("explains itself off desktop", () => {
    render(<WatchFoldersPanel />);
    expect(screen.getByText(/available in the OpenReel desktop app/)).toBeTruthy();
  });
});
