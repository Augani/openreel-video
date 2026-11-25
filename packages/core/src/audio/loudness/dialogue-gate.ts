/**
 * Dialogue (speech) gate for dialogue-anchored loudness, as delivery specs such
 * as Netflix's measure it. There is no speech/VAD detector in the core audio
 * layer (live ducking works from clip metadata), so this is a streaming
 * energy + spectral + syllabic-modulation gate:
 *
 *  - speech-band ratio: energy between 300 Hz and 3.4 kHz over total energy;
 *  - syllabic modulation: coefficient of variation of the 10 ms frame RMS across
 *    the 400 ms block (speech alternates syllables and pauses, sustained music,
 *    pads and tones stay flat);
 *  - an absolute floor so room tone is never "dialogue".
 *
 * It is a heuristic, not Dolby Dialogue Intelligence: dense, strongly rhythmic
 * music inside the speech band can pass, and very steady speech-like tones can
 * fail. The decision is per 400 ms block, aligned to the BS.1770 blocks.
 */

const FRAME_SECONDS = 0.01;
const FRAMES_PER_BLOCK = 40;
/** Speech-band energy over total energy a speech block must reach. */
export const SPEECH_BAND_RATIO_MIN = 0.55;
/** Frame-RMS coefficient of variation a speech block must reach. */
export const SPEECH_MODULATION_MIN = 0.35;
/** Mean-square floor, about -60 dBFS: below is silence / room tone. */
const SPEECH_ENERGY_FLOOR = 1e-6;

class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/** RBJ cookbook 2nd-order Butterworth high/low-pass. */
function butterworth(kind: "high" | "low", freq: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  if (kind === "low") {
    const b = (1 - cos) / 2 / a0;
    return new Biquad(b, 2 * b, b, a1, a2);
  }
  const b = (1 + cos) / 2 / a0;
  return new Biquad(b, -2 * b, b, a1, a2);
}

export class SpeechGate {
  private readonly frameLength: number;
  private readonly highpass: Biquad;
  private readonly lowpass: Biquad;
  private frameFill = 0;
  private frameFull = 0;
  private frameBand = 0;
  private readonly fullRing = new Float64Array(FRAMES_PER_BLOCK);
  private readonly bandRing = new Float64Array(FRAMES_PER_BLOCK);
  private frames = 0;

  constructor(sampleRate: number) {
    this.frameLength = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
    this.highpass = butterworth("high", 300, sampleRate);
    this.lowpass = butterworth("low", 3400, sampleRate);
  }

  /** Feed one mono sample (the mean of the channels). */
  push(sample: number): void {
    const band = this.lowpass.process(this.highpass.process(sample));
    this.frameFull += sample * sample;
    this.frameBand += band * band;
    if (++this.frameFill === this.frameLength) {
      const slot = this.frames % FRAMES_PER_BLOCK;
      this.fullRing[slot] = this.frameFull / this.frameLength;
      this.bandRing[slot] = this.frameBand / this.frameLength;
      this.frames++;
      this.frameFill = 0;
      this.frameFull = 0;
      this.frameBand = 0;
    }
  }

  /** Is the most recent 400 ms (40 frames) dialogue? */
  isSpeech(): boolean {
    if (this.frames < FRAMES_PER_BLOCK) return false;
    let full = 0;
    let band = 0;
    let rmsSum = 0;
    let rmsSq = 0;
    for (let i = 0; i < FRAMES_PER_BLOCK; i++) {
      full += this.fullRing[i];
      band += this.bandRing[i];
      const rms = Math.sqrt(this.fullRing[i]);
      rmsSum += rms;
      rmsSq += rms * rms;
    }
    const meanSquare = full / FRAMES_PER_BLOCK;
    if (meanSquare < SPEECH_ENERGY_FLOOR) return false;
    if (band / full < SPEECH_BAND_RATIO_MIN) return false;
    const mean = rmsSum / FRAMES_PER_BLOCK;
    const variance = Math.max(0, rmsSq / FRAMES_PER_BLOCK - mean * mean);
    return Math.sqrt(variance) / mean >= SPEECH_MODULATION_MIN;
  }

  reset(): void {
    this.highpass.reset();
    this.lowpass.reset();
    this.frameFill = 0;
    this.frameFull = 0;
    this.frameBand = 0;
    this.fullRing.fill(0);
    this.bandRing.fill(0);
    this.frames = 0;
  }
}
