import { describe, expect, it, vi } from "vitest";

describe("effect stack clipboard subscriptions", () => {
  it("notifies subscribers, detaches cleanly and retains immutable authored metadata", async () => {
    vi.resetModules();
    const clipboard = await import("./video-effect-stack-clipboard");
    expect(clipboard.hasVideoEffectStackClipboard()).toBe(false);
    const listener = vi.fn();
    const detach = clipboard.subscribeToVideoEffectStackClipboard(listener);
    const effects = [{ id: "source", type: "blur" as const, enabled: false, order: 0,
      params: { radius: 0 }, metadata: { source: "authored" } }];
    clipboard.copyVideoEffectStack(effects);
    expect(listener).toHaveBeenCalledOnce();
    expect(clipboard.hasVideoEffectStackClipboard()).toBe(true);
    effects[0].params.radius = 20;
    const copies = clipboard.cloneVideoEffectStackWithFreshIds()!;
    expect(copies[0]).toMatchObject({ type: "blur", enabled: false, params: { radius: 0 }, metadata: { source: "authored" } });
    expect(copies[0].id).not.toBe("source");
    copies[0].params.radius = 10;
    expect(clipboard.cloneVideoEffectStackWithFreshIds()![0].params.radius).toBe(0);
    detach();
    clipboard.copyVideoEffectStack([]);
    expect(listener).toHaveBeenCalledOnce();
  });
});
