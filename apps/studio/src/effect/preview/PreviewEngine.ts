import { DetectorPool } from "./DetectorPool";
import { RenderLoop } from "./RenderLoop";
import { VideoSource } from "./VideoSource";
import type { Scene } from "../scene";
import { activeDetectorKinds, type DetectorKind } from "../subjects";
import { sceneToGraph } from "../compile";

export interface PerfSample {
  frameMs: number;
  fps: number;
  activeDetectors: DetectorKind[];
}

export type Quality = "full" | "balanced" | "perf";

export class PreviewEngine {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly pool = new DetectorPool();
  private readonly video: HTMLVideoElement;
  private source: VideoSource | null = null;
  private scene: Scene | null = null;
  quality: Quality = "balanced";
  private loop: RenderLoop;
  private perfSubscribers = new Set<(p: PerfSample) => void>();
  private lastFrameTime = 0;
  private pipelineCacheKey: string | null = null;
  private compiledGraph: unknown | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
    this.video = document.createElement("video");
    this.video.crossOrigin = "anonymous";
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.loop = true;
    this.loop = new RenderLoop((now) => this.tick({ now }));
  }

  setSource(source: VideoSource): void {
    if (this.source) this.source.dispose();
    this.source = source;
    this.video.src = source.url;
    this.video.play()?.catch(() => undefined);
  }

  setScene(scene: Scene): void {
    this.scene = scene;
    void this.pool.ensure(this.activeDetectorKinds());
    this.pool.releaseUnused(this.activeDetectorKinds());
  }

  setQuality(q: Quality): void {
    this.quality = q;
  }

  activeDetectorKinds(): DetectorKind[] {
    if (!this.scene) return [];
    return activeDetectorKinds(this.scene.subjects.filter((s) => s.visible).map((s) => s.kind));
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  onPerf(fn: (p: PerfSample) => void): () => void {
    this.perfSubscribers.add(fn);
    return () => this.perfSubscribers.delete(fn);
  }

  async tickOnce(opts: { now: number }): Promise<void> {
    await this.tick(opts);
  }

  dispose(): void {
    this.loop.stop();
    this.pool.disposeAll();
    if (this.source) this.source.dispose();
    this.perfSubscribers.clear();
  }

  private async tick(opts: { now: number }): Promise<void> {
    const start = performance.now();
    if (this.ctx && this.video.readyState >= 2) {
      this.canvas.width = this.video.videoWidth || this.canvas.width;
      this.canvas.height = this.video.videoHeight || this.canvas.height;
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.scene) {
      const result = sceneToGraph(this.scene, { kind: "effect" });
      if (result.ok) {
        const cacheKey = graphCacheKey(result.graph);
        if (this.pipelineCacheKey !== cacheKey) {
          this.pipelineCacheKey = cacheKey;
          this.compiledGraph = result.graph;
        }
        void this.compiledGraph;
      }
    }
    const frameMs = performance.now() - start;
    const fps = this.lastFrameTime ? 1000 / (opts.now - this.lastFrameTime) : 0;
    this.lastFrameTime = opts.now;
    for (const sub of this.perfSubscribers) sub({ frameMs, fps, activeDetectors: this.activeDetectorKinds() });
  }
}

function graphCacheKey(graph: {
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{ fromNode: string; toNode: string }>;
}): string {
  return [
    graph.nodes.map((n) => `${n.id}:${n.type}`).join(","),
    graph.edges.map((e) => `${e.fromNode}->${e.toNode}`).join(","),
  ].join("|");
}
