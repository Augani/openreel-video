import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startNativeAuroraStagePreviewSession,
  type NativeAuroraPreviewSessionEvent,
} from "./native-aurora-preview-session";

describe("native aurora preview session", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: undefined,
    });
  });

  it("starts a desktop Aurora preview session and forwards matching events", async () => {
    const cancelPreviewSession = vi.fn().mockResolvedValue(undefined);
    const startPreviewSession = vi.fn().mockResolvedValue({
      sessionId: "aurora-stage-test",
    });
    let listener: ((event: NativeAuroraPreviewSessionEvent) => void) | null = null;
    const onPreviewEvent = vi.fn((cb: (event: NativeAuroraPreviewSessionEvent) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    });
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: {
        platform: "desktop",
        aurora: {
          startPreviewSession,
          cancelPreviewSession,
          onPreviewEvent,
        },
      },
    });

    const onEvent = vi.fn();
    const dispose = startNativeAuroraStagePreviewSession({
      fallback: {
        scene: { id: "scene-1" } as never,
        assets: [{ id: "asset-1" }] as never,
      },
      width: 320,
      height: 180,
      background: "#000000",
      timeSeconds: 1.25,
      onEvent,
    });

    await Promise.resolve();

    expect(startPreviewSession).toHaveBeenCalledWith({
      sessionId: expect.stringContaining("aurora-stage-"),
      scene: { id: "scene-1" },
      assets: [{ id: "asset-1" }],
      width: 320,
      height: 180,
      background: "#000000",
      timeSeconds: 1.25,
      quality: "preview",
    });

    if (!listener) {
      throw new Error("expected native Aurora preview listener to be registered");
    }
    const emitPreviewEvent = listener as (event: NativeAuroraPreviewSessionEvent) => void;

    emitPreviewEvent({
      kind: "update",
      sessionId: (startPreviewSession.mock.calls[0]?.[0] as { sessionId: string }).sessionId,
      stage: "draft",
      progress: 0.33,
      done: false,
      targetWidth: 320,
      targetHeight: 180,
      result: {
        backend: "native",
        pngBase64: "cG5n",
        dataUri: "data:image/png;base64,cG5n",
        width: 80,
        height: 45,
        coveredPixels: 12,
        shadowedPixels: 2,
        renderMs: 5,
      },
    });

    expect(onEvent).toHaveBeenCalledTimes(1);

    dispose?.();
    expect(cancelPreviewSession).toHaveBeenCalledTimes(1);
  });
});
