import { afterEach, describe, expect, it, vi } from "vitest";
import { deliver } from "./export-job-runner";

const base = { ok: true as const, data: { path: "/tmp/openreel-export-1.mp4" } };

function setMcp(mcp: unknown): void {
  (window as unknown as { openreel?: unknown }).openreel = mcp === undefined ? undefined : { mcp };
}

afterEach(() => {
  setMcp(undefined);
});

describe("export deliver()", () => {
  it("fails (not silently succeeds) when outputPath was requested and the bridge is missing", async () => {
    setMcp(undefined);
    const result = await deliver(base, { outputPath: "/Users/me/Movies/out.mp4" });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: "UNSUPPORTED" });
  });

  it("fails when placeOutput rejects and outputPath was requested", async () => {
    setMcp({ placeOutput: vi.fn().mockRejectedValue(new Error("ipc down")) });
    const result = await deliver(base, { outputPath: "/Users/me/Movies/out.mp4" });
    expect(result).toMatchObject({ ok: false, code: "UNREADABLE" });
    expect(JSON.stringify(result)).toMatch(/ipc down/);
  });

  it("keeps the plain result when no outputPath was requested and the bridge fails", async () => {
    setMcp({ placeOutput: vi.fn().mockRejectedValue(new Error("ipc down")) });
    expect(await deliver(base, {})).toEqual(base);
  });

  it("reports size and sha256 on success", async () => {
    setMcp({ placeOutput: vi.fn().mockResolvedValue({ ok: true, path: "/Users/me/Movies/out.mp4", sizeBytes: 5, sha256: "abc" }) });
    const result = await deliver(base, { outputPath: "/Users/me/Movies/out.mp4" });
    expect(result).toMatchObject({ ok: true, data: { sizeBytes: 5, sha256: "abc" } });
  });
});
