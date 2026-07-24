import type {
  AuroraSequenceRenderArgs,
  AuroraSequenceSessionEvent,
} from "../shared/ipc-contract";
import { renderAuroraFrame } from "./render-preview";

export async function runAuroraSequenceSession(
  args: AuroraSequenceRenderArgs,
  emit: (event: Extract<AuroraSequenceSessionEvent, { kind: "frame" }>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const totalFrames = Math.max(1, Math.ceil(args.durationSeconds * args.frameRate));
  const maxTime = Math.max(0, args.durationSeconds - 1 / args.frameRate);

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    if (signal?.aborted) return;
    const timeSeconds = totalFrames === 1
      ? 0
      : Math.min(frameIndex / args.frameRate, maxTime);
    const result = await renderAuroraFrame({
      scene: args.scene,
      assets: args.assets,
      width: args.width,
      height: args.height,
      background: args.background,
      timeSeconds,
      quality: args.quality ?? "final",
    });
    if (signal?.aborted) return;
    emit({
      kind: "frame",
      sessionId: "",
      frameIndex,
      totalFrames,
      timeSeconds,
      progress: (frameIndex + 1) / totalFrames,
      done: frameIndex === totalFrames - 1,
      result: {
        ...result,
        rgba: new Uint8Array(result.rgba),
      },
    });
  }
}
