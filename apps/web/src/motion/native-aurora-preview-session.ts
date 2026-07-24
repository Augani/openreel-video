import type { CreationStagePreviewFallback } from "./creation-stage-preview";

export type NativeAuroraPreviewSessionEvent =
  | {
      kind: "update";
      sessionId: string;
      stage: "draft" | "refine" | "final";
      progress: number;
      done: boolean;
      targetWidth: number;
      targetHeight: number;
      result: {
        backend: "native" | "cpu";
        pngBase64: string;
        dataUri: string;
        width: number;
        height: number;
        coveredPixels: number;
        shadowedPixels: number;
        renderMs: number;
      };
    }
  | {
      kind: "error";
      sessionId: string;
      done: true;
      error: string;
    };

export interface NativeAuroraStagePreviewArgs {
  readonly fallback: CreationStagePreviewFallback;
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly timeSeconds?: number;
  readonly onEvent: (event: NativeAuroraPreviewSessionEvent) => void;
  readonly onError?: (error: unknown) => void;
}

export function startNativeAuroraStagePreviewSession(
  args: NativeAuroraStagePreviewArgs,
): (() => void) | null {
  const aurora = window.openreel?.aurora;
  if (
    window.openreel?.platform !== "desktop" ||
    !aurora?.startPreviewSession ||
    !aurora.cancelPreviewSession ||
    !aurora.onPreviewEvent
  ) {
    return null;
  }

  const sessionId = `aurora-stage-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  let active = true;
  const unsubscribe = aurora.onPreviewEvent((event) => {
    if (!active || event.sessionId !== sessionId) return;
    args.onEvent(event);
  });

  void aurora.startPreviewSession({
    sessionId,
    scene: args.fallback.scene,
    assets: [...args.fallback.assets],
    width: args.width,
    height: args.height,
    background: args.background,
    timeSeconds: args.timeSeconds,
    quality: "preview",
  }).catch((error) => {
    if (active) args.onError?.(error);
  });

  return () => {
    active = false;
    unsubscribe();
    void aurora.cancelPreviewSession(sessionId).catch(() => undefined);
  };
}
