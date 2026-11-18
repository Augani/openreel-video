import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineEffectRenderer, sharedPreviewGpu } from "./effect-renderer";

afterEach(() => sharedPreviewGpu.disposeNow());

describe("EngineEffectRenderer.dispose", () => {
  it("leases the shared GPU set and gives it back once, however often it is disposed", () => {
    const a = new EngineEffectRenderer();
    const b = new EngineEffectRenderer();
    expect(sharedPreviewGpu.stats().leases).toBe(2);
    a.dispose();
    a.dispose();
    expect(sharedPreviewGpu.stats().leases).toBe(1);
    b.dispose();
    expect(sharedPreviewGpu.stats().leases).toBe(0);
  });

  it("refuses renders after dispose without building any lane", async () => {
    const renderer = new EngineEffectRenderer();
    renderer.dispose();
    await expect(
      renderer.render(0, { id: "x", kind: "effect", type: "blur" } as never, {} as never),
    ).rejects.toThrow("renderer disposed");
    expect(sharedPreviewGpu.peek()?.stats().lanes ?? 0).toBe(0);
  });

  it("disposes the shared engines (their GL contexts) after the idle grace once the last renderer goes", async () => {
    vi.useFakeTimers();
    try {
      const renderer = new EngineEffectRenderer();
      const resources = sharedPreviewGpu.peek();
      expect(resources).not.toBeNull();
      renderer.dispose();
      expect(sharedPreviewGpu.stats().live).toBe(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect(sharedPreviewGpu.stats().live).toBe(false);
      expect(resources?.lanes.isDisposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
