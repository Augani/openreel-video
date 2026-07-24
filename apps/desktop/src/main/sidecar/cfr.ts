export function frameIndexForTimestamp(timestampSec: number, fps: number): number {
  return Math.round(timestampSec * fps);
}

export function totalGridFrames(durationSec: number, fps: number): number {
  return Math.ceil(durationSec * fps);
}

export class CfrWriter {
  private lastWrittenIndex = -1;
  private lastFrame: Uint8Array | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly fps: number,
    private readonly write: (frame: Uint8Array) => Promise<void>,
  ) {}

  // Single-flight: the stateful fill logic mutates lastWrittenIndex/lastFrame
  // across awaits, so concurrent callers would race and emit duplicate frames.
  // Chain each push so only one runs at a time, in call order. The returned
  // promise rejects on write failure (callers can catch it), while the tail
  // swallows the error so later pushes still run.
  push(frame: Uint8Array, timestampSec: number): Promise<void> {
    const run = this.tail.then(() => this.pushInternal(frame, timestampSec));
    this.tail = run.catch(() => {});
    return run;
  }

  private async pushInternal(
    frame: Uint8Array,
    timestampSec: number,
  ): Promise<void> {
    const targetIndex = frameIndexForTimestamp(timestampSec, this.fps);
    if (targetIndex <= this.lastWrittenIndex) return;
    const fill = this.lastFrame ?? frame;
    for (let i = this.lastWrittenIndex + 1; i < targetIndex; i++) {
      await this.write(fill);
    }
    await this.write(frame);
    this.lastFrame = frame;
    this.lastWrittenIndex = targetIndex;
  }
}
