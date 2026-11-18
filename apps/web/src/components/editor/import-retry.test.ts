import { describe, it, expect, vi } from "vitest";
import { importWithRetry } from "./EditorInterface";

describe("importWithRetry", () => {
  it("retries once after a failed import", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("stale")).mockResolvedValue("ok");
    await expect(importWithRetry(load, 0)).resolves.toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("rejects after the second failure", async () => {
    const load = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(importWithRetry(load, 0)).rejects.toThrow("offline");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
