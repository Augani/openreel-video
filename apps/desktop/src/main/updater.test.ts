import { describe, expect, it, vi, beforeEach } from "vitest";

const handle = vi.fn();
const on = vi.fn();
vi.mock("electron", () => ({
  app: { isPackaged: true, on: vi.fn(), once: vi.fn(), quit: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle },
}));
const mockUpdater: Record<string, unknown> = {
  on,
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  downloadUpdate: vi.fn(),
  allowPrerelease: false,
};
vi.mock("electron-updater", () => ({ autoUpdater: mockUpdater }));

describe("initAutoUpdater", () => {
  beforeEach(() => {
    handle.mockClear();
    on.mockClear();
  });

  it("wires electron-updater exactly once however many windows are shown", async () => {
    const { initAutoUpdater } = await import("./updater");
    initAutoUpdater();
    initAutoUpdater();
    initAutoUpdater();
    await vi.waitFor(() => expect(handle).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(handle).toHaveBeenCalledTimes(2);
    expect(on).toHaveBeenCalledTimes(6);
  });

  it("does not force allowPrerelease, so stable installs stay on stable releases", async () => {
    const { initAutoUpdater } = await import("./updater");
    initAutoUpdater();
    await vi.waitFor(() => expect(mockUpdater.autoDownload).toBe(false));
    expect(mockUpdater.allowPrerelease).toBe(false);
  });
});
