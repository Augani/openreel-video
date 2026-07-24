import type {
  AuroraPreviewSessionEvent,
  AuroraRenderPreviewArgs,
} from "../shared/ipc-contract";
import { renderAuroraPreview } from "./render-preview";

type AuroraPreviewStage = Extract<
  AuroraPreviewSessionEvent,
  { kind: "update" }
>["stage"];

interface AuroraPreviewPass {
  readonly stage: AuroraPreviewStage;
  readonly width: number;
  readonly height: number;
}

function buildPreviewPasses(
  width: number,
  height: number,
): readonly AuroraPreviewPass[] {
  const candidates: ReadonlyArray<{
    readonly stage: AuroraPreviewStage;
    readonly scale: number;
  }> = [
    { stage: "draft", scale: 0.25 },
    { stage: "refine", scale: 0.5 },
    { stage: "final", scale: 1 },
  ];
  const passes: AuroraPreviewPass[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const passWidth = Math.max(1, Math.round(width * candidate.scale));
    const passHeight = Math.max(1, Math.round(height * candidate.scale));
    const key = `${passWidth}x${passHeight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    passes.push({
      stage: candidate.stage,
      width: passWidth,
      height: passHeight,
    });
  }

  return passes;
}

export async function runAuroraPreviewSession(
  args: AuroraRenderPreviewArgs,
  emit: (event: Extract<AuroraPreviewSessionEvent, { kind: "update" }>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const passes = buildPreviewPasses(args.width, args.height);
  for (const [index, pass] of passes.entries()) {
    if (signal?.aborted) return;
    const result = await renderAuroraPreview({
      ...args,
      width: pass.width,
      height: pass.height,
      quality: pass.stage === "final" ? args.quality : "preview",
    });
    if (signal?.aborted) return;
    emit({
      kind: "update",
      sessionId: "",
      stage: pass.stage,
      progress: (index + 1) / passes.length,
      done: index === passes.length - 1,
      targetWidth: args.width,
      targetHeight: args.height,
      result,
    });
  }
}
