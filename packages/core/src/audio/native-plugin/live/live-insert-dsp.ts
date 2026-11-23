/**
 * The audio-thread half of a live plugin insert: a pure, allocation-light state machine with no Web Audio and no I/O, so the
 * AudioWorklet that runs it and the unit tests exercise exactly the same code.
 *
 * Input is cut into blocks of B frames and handed out (`onBlock`) to whatever carries them to the plugin host. Wet blocks come
 * back later (`pushWet`) and are played J blocks behind the input (see live-latency.ts). The dry signal runs through a delay
 * line of the same total latency D, which is what plays whenever the wet signal is not there:
 *
 *   - UNDERRUN: output block m needs wet block m - J. It is checked `fade` frames BEFORE the block starts (so the end of the
 *     block that is still playing can be faded out under it); when the block has not arrived the wet gain ramps to 0 and the
 *     time-aligned dry takes over. A block that arrives after its slot has been given up is discarded and counted as late.
 *     The audio never jumps: every change between wet and dry is a linear gain ramp over `fade` frames.
 *   - BYPASS (helper crashed, user switched the insert off, insert still opening): the same ramp, held.
 *   - RECOVERY: when blocks flow again the wet gain ramps back in over `fade` frames.
 *
 * Latency never changes between wet and dry, so the rest of the mix stays aligned. While the stream is stopped (`setStreaming(false)`)
 * the insert is a plain pass-through, so nothing that is not the running transport (scrubbing, auditioning) is muted or delayed.
 */
import { LiveRing } from "./live-ring";
import { liveInsertLatencyFrames } from "./live-latency";

export interface LiveInsertStats {
  /** Output blocks that had no wet audio ready in time (counted once per block, while streaming and not bypassed). */
  readonly underruns: number;
  /** Wet blocks that arrived after their slot was given up. */
  readonly lateBlocks: number;
  /** Output blocks played from wet audio. */
  readonly wetBlocks: number;
  /** Output blocks played dry (underrun, bypass, startup). */
  readonly dryBlocks: number;
  /** Input blocks handed to the host. */
  readonly blocksSent: number;
  /** Largest number of wet blocks waiting at once (jitter buffer fill). */
  readonly maxQueued: number;
}

export interface LiveInsertDspOptions {
  readonly channels: number;
  readonly blockFrames: number;
  readonly prefillBlocks: number;
  readonly pluginLatencyFrames: number;
  /** Wet/dry ramp length. Clamped to half a block. Default 128 frames. */
  readonly fadeFrames?: number;
  readonly onBlock: (epoch: number, seq: number, planar: Float32Array) => void;
}

const DEFAULT_FADE_FRAMES = 128;
const MAX_QUEUED_WET = 64;

export class LiveInsertDsp {
  readonly channels: number;
  readonly blockFrames: number;
  readonly prefillBlocks: number;
  private pluginLatency: number;
  private readonly fade: number;
  private readonly onBlock: LiveInsertDspOptions["onBlock"];

  private dry: LiveRing;
  private dryTmp: Float32Array[];
  private inBlock: Float32Array;
  private inPos = 0;
  private inSeq = 0;
  private outPos = 0;
  private outBlock = 0;
  private curWet: Float32Array | null = null;
  private nextWet: Float32Array | null = null;
  /** Block 0 has no wet audio by construction (the stream has just started), so it counts as decided. */
  private nextDecided = true;
  private silence = new Float32Array(1024);
  private readonly wet = new Map<number, Float32Array>();
  /** Highest output slot whose wet block has been looked for: a block for that slot or an earlier one is late. */
  private decidedUpTo = 0;
  private gain = 0;
  private target = 0;
  private bypassed = false;
  private streaming = true;
  private epochNo = 0;
  private counters = { underruns: 0, lateBlocks: 0, wetBlocks: 0, dryBlocks: 0, blocksSent: 0, maxQueued: 0 };

  constructor(options: LiveInsertDspOptions) {
    this.channels = options.channels;
    this.blockFrames = options.blockFrames;
    this.prefillBlocks = options.prefillBlocks;
    this.pluginLatency = Math.max(0, Math.round(options.pluginLatencyFrames));
    this.fade = Math.max(1, Math.min(options.fadeFrames ?? DEFAULT_FADE_FRAMES, Math.floor(this.blockFrames / 2)));
    this.onBlock = options.onBlock;
    this.inBlock = new Float32Array(this.channels * this.blockFrames);
    this.dryTmp = Array.from({ length: this.channels }, () => new Float32Array(1024));
    this.dry = this.makeDry();
  }

  /** D: frames between the signal entering and leaving the insert (wet and dry alike). */
  get latencyFrames(): number {
    return liveInsertLatencyFrames(this.blockFrames, this.prefillBlocks, this.pluginLatency);
  }

  get epoch(): number {
    return this.epochNo;
  }

  stats(): LiveInsertStats {
    return { ...this.counters };
  }

  private makeDry(): LiveRing {
    const ring = LiveRing.create({ channels: this.channels, capacityFrames: this.latencyFrames + 1024 }, false);
    const zeros = Array.from({ length: this.channels }, () => new Float32Array(this.latencyFrames));
    ring.write(zeros, this.latencyFrames);
    return ring;
  }

  /** The chain reported a different latency (a plugin was swapped, its state restored). Resets the dry delay line. */
  setPluginLatency(frames: number): void {
    const next = Math.max(0, Math.round(frames));
    if (next === this.pluginLatency) return;
    this.pluginLatency = next;
    this.dry = this.makeDry();
  }

  /** Forces the dry signal (helper crashed, insert bypassed). The ramp is the same crossfade as an underrun. */
  setBypassed(bypassed: boolean): void {
    this.bypassed = bypassed;
    if (bypassed) this.target = 0;
    else if (this.curWet) this.target = 1;
  }

  /**
   * Starts a new stream: the playhead moved or playback restarted. Wet audio of the old epoch is discarded, the dry delay line
   * is emptied and block numbering restarts, so the first wet block expected is block 0 again.
   */
  startEpoch(epoch: number): void {
    this.epochNo = epoch;
    this.inPos = 0;
    this.inSeq = 0;
    this.outPos = 0;
    this.outBlock = 0;
    this.curWet = null;
    this.nextWet = null;
    this.nextDecided = true;
    this.gain = 0;
    this.wet.clear();
    this.decidedUpTo = 0;
    this.dry = this.makeDry();
    this.target = 0;
  }

  /** While not streaming nothing is sent and nothing counts as an underrun (transport stopped, tails done). */
  setStreaming(streaming: boolean): void {
    if (streaming === this.streaming) return;
    this.streaming = streaming;
    if (streaming) this.startEpoch(this.epochNo + 1);
    else this.target = 0;
  }

  get isStreaming(): boolean {
    return this.streaming;
  }

  /** A processed block came back from the host. */
  pushWet(epoch: number, seq: number, planar: Float32Array): void {
    if (epoch !== this.epochNo || planar.length !== this.channels * this.blockFrames) return;
    const slot = seq + this.prefillBlocks;
    if (slot <= this.decidedUpTo) {
      this.counters.lateBlocks += 1;
      return;
    }
    if (this.wet.size >= MAX_QUEUED_WET) return;
    this.wet.set(slot, planar);
    this.counters.maxQueued = Math.max(this.counters.maxQueued, this.wet.size);
  }

  private decideNext(): void {
    this.nextDecided = true;
    const slot = this.outBlock + 1;
    this.decidedUpTo = slot;
    const wet = this.wet.get(slot) ?? null;
    if (wet) {
      this.nextWet = wet;
      this.wet.delete(slot);
      return;
    }
    this.nextWet = null;
    // Slot numbers below prefillBlocks have no wet audio by construction (the stream has just started).
    if (slot >= this.prefillBlocks) {
      if (this.streaming && !this.bypassed) this.counters.underruns += 1;
    }
    this.target = 0;
  }

  private startBlock(): void {
    this.curWet = this.nextWet;
    this.nextWet = null;
    this.nextDecided = false;
    if (this.curWet && !this.bypassed && this.streaming) {
      this.target = 1;
      this.counters.wetBlocks += 1;
    } else {
      this.counters.dryBlocks += 1;
    }
  }

  /** One render quantum (any length). Reads `input`, writes `output` (same channel count; missing input channels read as silence). */
  process(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void {
    const channels = this.channels;
    if (!this.streaming) {
      // Transport stopped (scrubbing, auditioning, a clip preview): the signal passes through unprocessed and undelayed.
      for (let c = 0; c < output.length; c += 1) {
        const src = input[c] ?? input[0];
        if (src) output[c].set(src.length > frames ? src.subarray(0, frames) : src);
        else output[c].fill(0, 0, frames);
      }
      this.gain = 0;
      return;
    }
    if (this.dryTmp[0].length < frames) this.dryTmp = Array.from({ length: channels }, () => new Float32Array(frames));
    if (this.silence.length < frames) this.silence = new Float32Array(frames);
    const ins = Array.from({ length: channels }, (_, c) => input[c] ?? input[0] ?? this.silence);
    // 1. dry delay line: write the input, read it back D frames late
    this.dry.write(ins, frames);
    this.dry.read(this.dryTmp, frames);
    const B = this.blockFrames;
    const step = 1 / this.fade;
    for (let i = 0; i < frames; i += 1) {
      // 2. cut the input into blocks for the host
      for (let c = 0; c < channels; c += 1) this.inBlock[c * B + this.inPos] = ins[c][i] ?? 0;
      this.inPos += 1;
      if (this.inPos === B) {
        const block = this.inBlock;
        this.inBlock = new Float32Array(channels * B);
        this.inPos = 0;
        this.counters.blocksSent += 1;
        this.onBlock(this.epochNo, this.inSeq, block);
        this.inSeq += 1;
      }
      // 3. output block bookkeeping
      if (this.outPos === 0) {
        this.startBlock();
      } else if (this.outPos === B - this.fade && !this.nextDecided) {
        this.decideNext();
      }
      // 4. mix with a ramped wet gain
      if (this.gain < this.target) this.gain = Math.min(this.target, this.gain + step);
      else if (this.gain > this.target) this.gain = Math.max(this.target, this.gain - step);
      const g = this.gain;
      const wet = this.curWet;
      for (let c = 0; c < output.length; c += 1) {
        const d = this.dryTmp[Math.min(c, channels - 1)][i];
        const w = wet ? wet[Math.min(c, channels - 1) * B + this.outPos] : 0;
        output[c][i] = g * w + (1 - g) * d;
      }
      this.outPos += 1;
      if (this.outPos === B) {
        this.outPos = 0;
        this.outBlock += 1;
        // The stale entries of blocks that have gone by.
        if (this.wet.size > 0) for (const key of this.wet.keys()) if (key < this.outBlock) this.wet.delete(key);
      }
    }
  }
}
