export type LoopTick = (now: number) => void | Promise<void>;

export class RenderLoop {
  private rafId: number | null = null;
  private running = false;
  constructor(private readonly tick: LoopTick) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      void this.tick(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
