interface FrameData {
  bitmap: ImageBitmap;
  timestamp: number;
  frameNumber: number;
}

interface FrameRingBufferStats {
  bufferSize: number;
  framesWritten: number;
  framesPresented: number;
  framesDropped: number;
  fallbacksUsed: number;
  averageLatency: number;
}

class FrameRingBuffer {
  private buffers: (FrameData | null)[];
  private writeIndex: number = 0;
  private presentIndex: number = 1;
  private bufferSize: number;

  private framesWritten: number = 0;
  private framesPresented: number = 0;
  private framesDropped: number = 0;
  private fallbacksUsed: number = 0;
  private latencySum: number = 0;
  private latencyCount: number = 0;

  private lastWriteTime: number = 0;
  private lastPresentTime: number = 0;

  constructor(bufferSize: number = 3) {
    this.bufferSize = Math.max(2, Math.min(bufferSize, 8));
    this.buffers = new Array(this.bufferSize).fill(null);
  }

  write(bitmap: ImageBitmap, timestamp: number, frameNumber: number): void {
    const oldFrame = this.buffers[this.writeIndex];
    if (oldFrame) {
      oldFrame.bitmap.close();
    }

    this.buffers[this.writeIndex] = {
      bitmap,
      timestamp,
      frameNumber,
    };

    this.lastWriteTime = performance.now();
    this.framesWritten++;

    this.writeIndex = (this.writeIndex + 1) % this.bufferSize;

    if (this.writeIndex === this.presentIndex) {
      this.presentIndex = (this.presentIndex + 1) % this.bufferSize;
      this.framesDropped++;
    }
  }

  async writeFromCanvas(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    timestamp: number,
    frameNumber: number,
  ): Promise<void> {
    const bitmap = await createImageBitmap(canvas);
    this.write(bitmap, timestamp, frameNumber);
  }

  present(): FrameData | null {
    const readIndex =
      (this.presentIndex - 1 + this.bufferSize) % this.bufferSize;
    const frame = this.buffers[readIndex];

    if (frame) {
      const now = performance.now();
      if (this.lastWriteTime > 0) {
        const latency = now - this.lastWriteTime;
        this.latencySum += latency;
        this.latencyCount++;
      }
      this.lastPresentTime = now;
      this.framesPresented++;
      return frame;
    }

    return null;
  }

  presentOrFallback(): FrameData | null {
    const frame = this.present();
    if (frame) {
      return frame;
    }

    for (let i = 1; i < this.bufferSize; i++) {
      const fallbackIndex =
        (this.presentIndex - 1 - i + this.bufferSize * 2) % this.bufferSize;
      const fallback = this.buffers[fallbackIndex];
      if (fallback) {
        this.fallbacksUsed++;
        return fallback;
      }
    }

    return null;
  }

  swap(): void {
    this.presentIndex = (this.presentIndex + 1) % this.bufferSize;
  }

  peek(): FrameData | null {
    const readIndex =
      (this.presentIndex - 1 + this.bufferSize) % this.bufferSize;
    return this.buffers[readIndex];
  }

  peekNext(): FrameData | null {
    return this.buffers[this.presentIndex];
  }

  hasFrameReady(): boolean {
    const readIndex =
      (this.presentIndex - 1 + this.bufferSize) % this.bufferSize;
    return this.buffers[readIndex] !== null;
  }

  hasNextFrameReady(): boolean {
    return this.buffers[this.presentIndex] !== null;
  }

  getBufferFillLevel(): number {
    let filled = 0;
    for (const buffer of this.buffers) {
      if (buffer !== null) filled++;
    }
    return filled / this.bufferSize;
  }

  getLatestTimestamp(): number | null {
    const latestIndex =
      (this.writeIndex - 1 + this.bufferSize) % this.bufferSize;
    const frame = this.buffers[latestIndex];
    return frame?.timestamp ?? null;
  }

  getStats(): FrameRingBufferStats {
    return {
      bufferSize: this.bufferSize,
      framesWritten: this.framesWritten,
      framesPresented: this.framesPresented,
      framesDropped: this.framesDropped,
      fallbacksUsed: this.fallbacksUsed,
      averageLatency:
        this.latencyCount > 0 ? this.latencySum / this.latencyCount : 0,
    };
  }

  getTimingInfo(): { lastWriteTime: number; lastPresentTime: number } {
    return {
      lastWriteTime: this.lastWriteTime,
      lastPresentTime: this.lastPresentTime,
    };
  }

  reset(): void {
    for (let i = 0; i < this.bufferSize; i++) {
      const frame = this.buffers[i];
      if (frame) {
        frame.bitmap.close();
      }
      this.buffers[i] = null;
    }

    this.writeIndex = 0;
    this.presentIndex = 1;
    this.framesWritten = 0;
    this.framesPresented = 0;
    this.framesDropped = 0;
    this.fallbacksUsed = 0;
    this.latencySum = 0;
    this.latencyCount = 0;
    this.lastWriteTime = 0;
    this.lastPresentTime = 0;
  }

  dispose(): void {
    this.reset();
  }
}

export class CompositeFrameBuffer {
  private buffers: Map<string, FrameRingBuffer> = new Map();
  private compositedBuffer: FrameRingBuffer;
  private lastCompositeTime: number = 0;

  constructor(bufferSize: number = 3) {
    this.compositedBuffer = new FrameRingBuffer(bufferSize);
  }

  getOrCreateTrackBuffer(
    trackId: string,
    bufferSize: number = 3,
  ): FrameRingBuffer {
    let buffer = this.buffers.get(trackId);
    if (!buffer) {
      buffer = new FrameRingBuffer(bufferSize);
      this.buffers.set(trackId, buffer);
    }
    return buffer;
  }

  writeTrackFrame(
    trackId: string,
    bitmap: ImageBitmap,
    timestamp: number,
    frameNumber: number,
  ): void {
    const buffer = this.getOrCreateTrackBuffer(trackId);
    buffer.write(bitmap, timestamp, frameNumber);
  }

  getTrackFrame(trackId: string): FrameData | null {
    const buffer = this.buffers.get(trackId);
    return buffer?.presentOrFallback() ?? null;
  }

  getAllTrackFrames(): Map<string, FrameData> {
    const frames = new Map<string, FrameData>();
    for (const [trackId, buffer] of this.buffers) {
      const frame = buffer.presentOrFallback();
      if (frame) {
        frames.set(trackId, frame);
      }
    }
    return frames;
  }

  writeCompositedFrame(
    bitmap: ImageBitmap,
    timestamp: number,
    frameNumber: number,
  ): void {
    this.compositedBuffer.write(bitmap, timestamp, frameNumber);
    this.lastCompositeTime = performance.now();
  }

  getCompositedFrame(): FrameData | null {
    return this.compositedBuffer.presentOrFallback();
  }

  swapAll(): void {
    for (const buffer of this.buffers.values()) {
      buffer.swap();
    }
    this.compositedBuffer.swap();
  }

  getStats(): {
    tracks: Map<string, FrameRingBufferStats>;
    composited: FrameRingBufferStats;
    lastCompositeTime: number;
  } {
    const trackStats = new Map<string, FrameRingBufferStats>();
    for (const [trackId, buffer] of this.buffers) {
      trackStats.set(trackId, buffer.getStats());
    }
    return {
      tracks: trackStats,
      composited: this.compositedBuffer.getStats(),
      lastCompositeTime: this.lastCompositeTime,
    };
  }

  removeTrack(trackId: string): void {
    const buffer = this.buffers.get(trackId);
    if (buffer) {
      buffer.dispose();
      this.buffers.delete(trackId);
    }
  }

  reset(): void {
    for (const buffer of this.buffers.values()) {
      buffer.reset();
    }
    this.compositedBuffer.reset();
    this.lastCompositeTime = 0;
  }

  dispose(): void {
    for (const buffer of this.buffers.values()) {
      buffer.dispose();
    }
    this.buffers.clear();
    this.compositedBuffer.dispose();
  }
}

let compositeBufferInstance: CompositeFrameBuffer | null = null;

export function getCompositeFrameBuffer(): CompositeFrameBuffer {
  if (!compositeBufferInstance) {
    compositeBufferInstance = new CompositeFrameBuffer();
  }
  return compositeBufferInstance;
}
