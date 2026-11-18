import type { SoundItem, MusicGenre, MoodTag } from "../types/sound-library";

export interface GeneratedSound {
  item: SoundItem;
  blob: Blob;
  dataUrl: string;
}

const NOTE_FREQUENCIES: Record<string, number> = {
  C1: 32.7,
  D1: 36.71,
  E1: 41.2,
  F1: 43.65,
  G1: 49.0,
  A1: 55.0,
  B1: 61.74,
  C2: 65.41,
  D2: 73.42,
  E2: 82.41,
  F2: 87.31,
  G2: 98.0,
  A2: 110.0,
  B2: 123.47,
  C3: 130.81,
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  G3: 196.0,
  A3: 220.0,
  B3: 246.94,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  A5: 880.0,
  B5: 987.77,
  C6: 1046.5,
  D6: 1174.66,
  E6: 1318.51,
  F6: 1396.91,
  G6: 1567.98,
  A6: 1760.0,
  B6: 1975.53,
  "C#2": 69.3,
  "D#2": 77.78,
  "F#2": 92.5,
  "G#2": 103.83,
  "A#2": 116.54,
  "C#3": 138.59,
  "D#3": 155.56,
  "F#3": 185.0,
  "G#3": 207.65,
  "A#3": 233.08,
  "C#4": 277.18,
  "D#4": 311.13,
  "F#4": 369.99,
  "G#4": 415.3,
  "A#4": 466.16,
  "C#5": 554.37,
  "D#5": 622.25,
  "F#5": 739.99,
  "G#5": 830.61,
  "A#5": 932.33,
  Eb2: 77.78,
  Bb2: 116.54,
  Eb3: 155.56,
  Bb3: 233.08,
  Eb4: 311.13,
  Bb4: 466.16,
  Eb5: 622.25,
  Bb5: 932.33,
  Ab2: 103.83,
  Ab3: 207.65,
  Ab4: 415.3,
  Ab5: 830.61,
  Db3: 138.59,
  Db4: 277.18,
  Db5: 554.37,
  Gb3: 185.0,
  Gb4: 369.99,
  Gb5: 739.99,
};

const CHORD_PROGRESSIONS = {
  pop: [
    ["C4", "E4", "G4"],
    ["G3", "B3", "D4"],
    ["A3", "C4", "E4"],
    ["F3", "A3", "C4"],
  ],
  jazz: [
    ["C4", "E4", "G4", "B4"],
    ["A3", "C4", "E4", "G4"],
    ["D4", "F4", "A4", "C5"],
    ["G3", "B3", "D4", "F4"],
  ],
  lofi: [
    ["C4", "Eb4", "G4"],
    ["Ab3", "C4", "Eb4"],
    ["Bb3", "D4", "F4"],
    ["G3", "Bb3", "D4"],
  ],
  cinematic: [
    ["C4", "G4", "C5"],
    ["Ab3", "Eb4", "Ab4"],
    ["Bb3", "F4", "Bb4"],
    ["G3", "D4", "G4"],
  ],
  electronic: [
    ["A3", "E4", "A4"],
    ["F3", "C4", "F4"],
    ["G3", "D4", "G4"],
    ["A3", "E4", "A4"],
  ],
  ambient: [
    ["C4", "G4", "D5", "G5"],
    ["A3", "E4", "B4", "E5"],
    ["F3", "C4", "G4", "C5"],
    ["G3", "D4", "A4", "D5"],
  ],
};

const RICH_PROGRESSIONS = {
  uplifting: [
    ["C3", "G3", "C4", "E4", "G4"],
    ["G2", "D3", "G3", "B3", "D4"],
    ["A2", "E3", "A3", "C4", "E4"],
    ["F2", "C3", "F3", "A3", "C4"],
  ],
  emotional: [
    ["A2", "E3", "A3", "C4", "E4"],
    ["F2", "C3", "F3", "A3", "C4"],
    ["C3", "G3", "C4", "E4", "G4"],
    ["G2", "D3", "G3", "B3", "D4"],
  ],
  energetic: [
    ["E3", "B3", "E4", "G#4", "B4"],
    ["A2", "E3", "A3", "C#4", "E4"],
    ["D3", "A3", "D4", "F#4", "A4"],
    ["B2", "F#3", "B3", "D#4", "F#4"],
  ],
  chill: [
    ["D3", "A3", "D4", "F#4", "A4"],
    ["G2", "D3", "G3", "B3", "D4"],
    ["E3", "B3", "E4", "G4", "B4"],
    ["A2", "E3", "A3", "C#4", "E4"],
  ],
  happy: [
    ["G3", "D4", "G4", "B4", "D5"],
    ["C3", "G3", "C4", "E4", "G4"],
    ["D3", "A3", "D4", "F#4", "A4"],
    ["E3", "B3", "E4", "G4", "B4"],
  ],
  funky: [
    ["E3", "G3", "B3", "D4"],
    ["A3", "C4", "E4", "G4"],
    ["D3", "F3", "A3", "C4"],
    ["G3", "B3", "D4", "F4"],
  ],
};

const MELODY_PATTERNS = {
  uplifting: [0, 2, 4, 7, 4, 2, 0, -1],
  bouncy: [0, 0, 4, 4, 7, 4, 2, 0],
  flowing: [0, 2, 4, 2, 0, -1, 0, 2],
  catchy: [0, 4, 7, 4, 0, 2, 4, 0],
  energetic: [0, 7, 4, 7, 0, 4, 7, 12],
};

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

interface BeatPattern {
  bars: number;
  kick: number[];
  snare: number[];
  hat: number[];
  openHat?: boolean;
  swing?: number;
  fill?: boolean;
  bass: { steps: number[]; notes: number[]; wave: OscillatorType; hold: number };
}

const EVERY_EIGHTH = [0, 2, 4, 6, 8, 10, 12, 14];
const EVERY_SIXTEENTH = Array.from({ length: 16 }, (_, i) => i);

/** One groove per genre: different kick, backbeat, hat and bass figures give each loop its own envelope. */
const BEAT_PATTERNS: Record<string, BeatPattern> = {
  electronic: { bars: 4, kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], openHat: true, bass: { steps: [2, 6, 10, 14], notes: [55, 55, 65.4, 73.4], wave: "sawtooth", hold: 1.5 } },
  "hip-hop": { bars: 4, kick: [0, 7, 10], snare: [4, 12], hat: EVERY_EIGHTH, swing: 0.28, bass: { steps: [0, 7, 10], notes: [49, 49, 58.3, 41.2], wave: "sine", hold: 3 } },
  pop: { bars: 4, kick: [0, 6, 8, 14], snare: [4, 12], hat: EVERY_EIGHTH, fill: true, bass: { steps: [0, 8], notes: [65.4, 49, 55, 73.4], wave: "triangle", hold: 6 } },
  lofi: { bars: 4, kick: [0, 9], snare: [4, 12], hat: [0, 4, 8, 12], swing: 0.4, bass: { steps: [0, 10], notes: [43.7, 49, 41.2, 55], wave: "sine", hold: 7 } },
  upbeat: { bars: 4, kick: [0, 4, 8, 12], snare: [4, 12], hat: EVERY_SIXTEENTH, fill: true, bass: { steps: [0, 3, 6, 8, 11, 14], notes: [65.4, 82.4, 73.4, 98], wave: "square", hold: 2 } },
  corporate: { bars: 2, kick: [0, 8], snare: [4, 12], hat: [0, 4, 8, 12], bass: { steps: [0, 8], notes: [65.4, 73.4, 55, 49], wave: "triangle", hold: 7 } },
};

class SoundGenerator {
  private cache: Map<string, GeneratedSound> = new Map();

  private noteToFreq(note: string): number {
    return NOTE_FREQUENCIES[note] || 440;
  }

  private getScaleFrequencies(
    root: number,
    scale: number[],
    octaves: number = 2,
  ): number[] {
    const freqs: number[] = [];
    for (let oct = 0; oct < octaves; oct++) {
      for (const interval of scale) {
        freqs.push(root * Math.pow(2, (interval + oct * 12) / 12));
      }
    }
    return freqs;
  }

  private createReverbImpulse(
    ctx: OfflineAudioContext,
    duration: number,
    decay: number,
  ): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * decay);
      }
    }
    return impulse;
  }

  private createWarmPad(
    ctx: OfflineAudioContext,
    freq: number,
    startTime: number,
    duration: number,
    volume: number,
    destination: AudioNode,
  ): void {
    const detunes = [-12, -5, 0, 5, 7, 12];

    detunes.forEach((detune, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      osc.detune.value = detune;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2000 + Math.sin(i) * 500;
      filter.Q.value = 0.5;

      const gain = ctx.createGain();
      const attackTime = 0.15;
      const releaseTime = 0.3;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(
        volume / detunes.length,
        startTime + attackTime,
      );
      gain.gain.setValueAtTime(
        (volume / detunes.length) * 0.7,
        startTime + duration - releaseTime,
      );
      gain.gain.linearRampToValueAtTime(0, startTime + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  }

  private createPluckySynth(
    ctx: OfflineAudioContext,
    freq: number,
    startTime: number,
    duration: number,
    volume: number,
    destination: AudioNode,
  ): void {
    const osc1 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.value = freq;

    const osc2 = ctx.createOscillator();
    osc2.type = "square";
    osc2.frequency.value = freq * 1.002;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(freq * 8, startTime);
    filter.frequency.exponentialRampToValueAtTime(freq * 2, startTime + 0.1);
    filter.Q.value = 2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(volume * 0.3, startTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    osc1.start(startTime);
    osc1.stop(startTime + duration);
    osc2.start(startTime);
    osc2.stop(startTime + duration);
  }

  private createRichBass(
    ctx: OfflineAudioContext,
    freq: number,
    startTime: number,
    duration: number,
    volume: number,
    destination: AudioNode,
  ): void {
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = freq;

    const mid = ctx.createOscillator();
    mid.type = "sawtooth";
    mid.frequency.value = freq * 2;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(800, startTime);
    filter.frequency.exponentialRampToValueAtTime(
      200,
      startTime + duration * 0.5,
    );

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0, startTime);
    subGain.gain.linearRampToValueAtTime(volume * 0.7, startTime + 0.02);
    subGain.gain.exponentialRampToValueAtTime(
      volume * 0.4,
      startTime + duration * 0.3,
    );
    subGain.gain.linearRampToValueAtTime(0, startTime + duration);

    const midGain = ctx.createGain();
    midGain.gain.setValueAtTime(0, startTime);
    midGain.gain.linearRampToValueAtTime(volume * 0.3, startTime + 0.01);
    midGain.gain.exponentialRampToValueAtTime(
      0.001,
      startTime + duration * 0.5,
    );

    sub.connect(subGain);
    subGain.connect(destination);

    mid.connect(filter);
    filter.connect(midGain);
    midGain.connect(destination);

    sub.start(startTime);
    sub.stop(startTime + duration);
    mid.start(startTime);
    mid.stop(startTime + duration);
  }

  private createPunchyKick(
    ctx: OfflineAudioContext,
    startTime: number,
    volume: number,
    destination: AudioNode,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, startTime);
    osc.frequency.exponentialRampToValueAtTime(40, startTime + 0.08);

    const click = ctx.createOscillator();
    click.type = "triangle";
    click.frequency.value = 1000;

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(volume, startTime);
    oscGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);

    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(volume * 0.3, startTime);
    clickGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.02);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.1;

    osc.connect(oscGain);
    click.connect(clickGain);
    oscGain.connect(compressor);
    clickGain.connect(compressor);
    compressor.connect(destination);

    osc.start(startTime);
    osc.stop(startTime + 0.3);
    click.start(startTime);
    click.stop(startTime + 0.02);
  }

  private createCrispSnare(
    ctx: OfflineAudioContext,
    startTime: number,
    volume: number,
    destination: AudioNode,
  ): void {
    const noiseBuffer = ctx.createBuffer(
      1,
      ctx.sampleRate * 0.2,
      ctx.sampleRate,
    );
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 5000;
    noiseFilter.Q.value = 1;

    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(200, startTime);
    body.frequency.exponentialRampToValueAtTime(100, startTime + 0.05);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(volume * 0.5, startTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(volume * 0.4, startTime);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination);

    body.connect(bodyGain);
    bodyGain.connect(destination);

    noise.start(startTime);
    body.start(startTime);
    body.stop(startTime + 0.1);
  }

  private createShimmeringHiHat(
    ctx: OfflineAudioContext,
    startTime: number,
    volume: number,
    open: boolean,
    destination: AudioNode,
  ): void {
    const duration = open ? 0.15 : 0.04;
    const noiseBuffer = ctx.createBuffer(
      1,
      ctx.sampleRate * duration,
      ctx.sampleRate,
    );
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const hpFilter = ctx.createBiquadFilter();
    hpFilter.type = "highpass";
    hpFilter.frequency.value = 7000;

    const bpFilter = ctx.createBiquadFilter();
    bpFilter.type = "bandpass";
    bpFilter.frequency.value = 10000;
    bpFilter.Q.value = 0.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    noise.connect(hpFilter);
    hpFilter.connect(bpFilter);
    bpFilter.connect(gain);
    gain.connect(destination);

    noise.start(startTime);
  }

  async generateWhoosh(
    id: string,
    name: string,
    duration: number,
    fast: boolean = true,
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const noiseBuffer = ctx.createBuffer(2, sampleRate * duration, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = noiseBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = fast ? 5 : 2;

    filter.frequency.setValueAtTime(fast ? 2000 : 800, 0);
    filter.frequency.exponentialRampToValueAtTime(
      fast ? 8000 : 3000,
      duration * 0.3,
    );
    filter.frequency.exponentialRampToValueAtTime(fast ? 1000 : 400, duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.6, duration * 0.1);
    gain.gain.linearRampToValueAtTime(0.8, duration * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.01, duration);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(-0.5, 0);
    panner.pan.linearRampToValueAtTime(0.5, duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);

    noise.start();
    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "whoosh",
      duration,
      tags: ["transition", "movement", fast ? "quick" : "gentle"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateImpact(
    id: string,
    name: string,
    heavy: boolean = true,
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = heavy ? 1.2 : 0.6;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(heavy ? 80 : 150, 0);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 30 : 50, duration);

    const noiseBuffer = ctx.createBuffer(2, sampleRate * 0.1, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = noiseBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = heavy ? 500 : 1000;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.8, 0);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, 0.1);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(1, 0);
    oscGain.gain.exponentialRampToValueAtTime(0.01, duration);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.ratio.value = 12;

    osc.connect(oscGain);
    oscGain.connect(compressor);
    compressor.connect(ctx.destination);

    osc.start();
    noise.start();
    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "impacts",
      duration,
      tags: [heavy ? "heavy" : "light", "punch", "hit"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateClick(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 0.08;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2000, 0);
    osc.frequency.exponentialRampToValueAtTime(800, duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, 0);
    gain.gain.exponentialRampToValueAtTime(0.01, duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "ui",
      duration,
      tags: ["button", "interface", "tap"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateNotification(
    id: string,
    name: string,
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 0.5;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const notes = [880, 1100, 1320];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const startTime = i * 0.08;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.15);
    });

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "ui",
      duration,
      tags: ["alert", "bell", "message"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateSuccess(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 0.6;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const startTime = i * 0.1;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.25, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.25);
    });

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "ui",
      duration,
      tags: ["complete", "achievement", "positive"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generatePop(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 0.15;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(400, 0);
    osc.frequency.exponentialRampToValueAtTime(100, duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, 0);
    gain.gain.exponentialRampToValueAtTime(0.01, duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "cartoon",
      duration,
      tags: ["bubble", "appear", "fun"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateBoing(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 0.4;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const osc = ctx.createOscillator();
    osc.type = "sine";

    const freqMod = ctx.createOscillator();
    freqMod.type = "sine";
    freqMod.frequency.value = 12;

    const freqModGain = ctx.createGain();
    freqModGain.gain.setValueAtTime(200, 0);
    freqModGain.gain.exponentialRampToValueAtTime(1, duration);

    freqMod.connect(freqModGain);
    freqModGain.connect(osc.frequency);

    osc.frequency.setValueAtTime(300, 0);
    osc.frequency.exponentialRampToValueAtTime(100, duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, 0);
    gain.gain.exponentialRampToValueAtTime(0.01, duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    freqMod.start();
    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "cartoon",
      duration,
      tags: ["bounce", "spring", "funny"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateGlitch(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 0.5;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    for (let i = 0; i < 8; i++) {
      const startTime = i * 0.05 + Math.random() * 0.02;
      const glitchDuration = 0.02 + Math.random() * 0.03;

      const noiseBuffer = ctx.createBuffer(
        2,
        sampleRate * glitchDuration,
        sampleRate,
      );
      for (let channel = 0; channel < 2; channel++) {
        const data = noiseBuffer.getChannelData(channel);
        for (let j = 0; j < data.length; j++) {
          data[j] = (Math.random() * 2 - 1) * (Math.random() > 0.5 ? 1 : 0);
        }
      }

      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1000 + Math.random() * 3000;
      filter.Q.value = 10;

      const gain = ctx.createGain();
      gain.gain.value = 0.3 + Math.random() * 0.3;

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(startTime);
    }

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "transitions",
      duration,
      tags: ["digital", "error", "tech"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateRiser(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 2.0;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const noiseBuffer = ctx.createBuffer(2, sampleRate * duration, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = noiseBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(100, 0);
    filter.frequency.exponentialRampToValueAtTime(8000, duration);
    filter.Q.value = 5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, 0);
    gain.gain.linearRampToValueAtTime(0.6, duration * 0.9);
    gain.gain.linearRampToValueAtTime(0, duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start();
    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "transitions",
      duration,
      tags: ["build-up", "riser", "tension"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateLaser(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 0.25;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(2000, 0);
    osc.frequency.exponentialRampToValueAtTime(100, duration);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(5000, 0);
    filter.frequency.exponentialRampToValueAtTime(500, duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, 0);
    gain.gain.exponentialRampToValueAtTime(0.01, duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "sci-fi",
      duration,
      tags: ["weapon", "space", "shoot"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generatePowerUp(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 1.2;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(200, 0);
    osc1.frequency.exponentialRampToValueAtTime(1200, duration);

    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(400, 0);
    osc2.frequency.exponentialRampToValueAtTime(2400, duration);

    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0, 0);
    gain1.gain.linearRampToValueAtTime(0.3, duration * 0.1);
    gain1.gain.linearRampToValueAtTime(0.4, duration * 0.8);
    gain1.gain.linearRampToValueAtTime(0, duration);

    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0, 0);
    gain2.gain.linearRampToValueAtTime(0.15, duration * 0.1);
    gain2.gain.linearRampToValueAtTime(0.2, duration * 0.8);
    gain2.gain.linearRampToValueAtTime(0, duration);

    osc1.connect(gain1);
    osc2.connect(gain2);
    gain1.connect(ctx.destination);
    gain2.connect(ctx.destination);

    osc1.start();
    osc2.start();
    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "sci-fi",
      duration,
      tags: ["energy", "charge", "activate"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateSimpleBeat(
    id: string,
    name: string,
    bpm: number,
    genre: MusicGenre,
    mood: MoodTag[],
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const pattern = BEAT_PATTERNS[genre] ?? BEAT_PATTERNS.electronic;
    // Whole bars at the tempo, so a loop is as long as its groove, not a fixed 8 s.
    const bars = pattern.bars;
    const stepDuration = 60 / bpm / 4;
    const duration = bars * 16 * stepDuration;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * duration), sampleRate);

    const noiseBuffer = ctx.createBuffer(1, Math.floor(sampleRate * 0.2), sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let j = 0; j < noiseData.length; j++) noiseData[j] = Math.random() * 2 - 1;

    const hit = (time: number, kind: "snare" | "hat" | "openhat", gainValue: number) => {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = kind === "snare" ? "bandpass" : "highpass";
      filter.frequency.value = kind === "snare" ? 1800 : 7000;
      const gain = ctx.createGain();
      const tail = kind === "snare" ? 0.16 : kind === "openhat" ? 0.12 : 0.04;
      gain.gain.setValueAtTime(gainValue, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + tail);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(time);
      noise.stop(time + tail + 0.02);
    };

    for (let bar = 0; bar < bars; bar++) {
      const fill = pattern.fill && bar === bars - 1;
      for (let step = 0; step < 16; step++) {
        const swing = pattern.swing && step % 2 === 1 ? stepDuration * pattern.swing : 0;
        const time = (bar * 16 + step) * stepDuration + swing;
        if (pattern.kick.includes(step) && !(fill && step > 8)) {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(step === 0 ? 150 : 110, time);
          osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(step === 0 ? 0.85 : 0.6, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(time);
          osc.stop(time + 0.22);
        }
        if (pattern.snare.includes(step) || (fill && step >= 12)) hit(time, "snare", 0.4);
        if (pattern.hat.includes(step)) hit(time, step % 4 === 2 && pattern.openHat ? "openhat" : "hat", step % 4 === 0 ? 0.22 : 0.14);
        const bassIndex = pattern.bass.steps.indexOf(step);
        if (bassIndex >= 0) {
          const note = pattern.bass.notes[(bar * pattern.bass.steps.length + bassIndex) % pattern.bass.notes.length];
          const osc = ctx.createOscillator();
          osc.type = pattern.bass.wave;
          osc.frequency.setValueAtTime(note, time);
          const gain = ctx.createGain();
          const hold = stepDuration * pattern.bass.hold;
          gain.gain.setValueAtTime(0.0001, time);
          gain.gain.exponentialRampToValueAtTime(0.38, time + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, time + hold);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(time);
          osc.stop(time + hold + 0.02);
        }
      }
    }

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "music",
      subcategory: genre,
      duration,
      bpm,
      key: "C Major",
      tags: ["beat", "loop", genre],
      mood,
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateAmbientPad(
    id: string,
    name: string,
    genre: MusicGenre,
    mood: MoodTag[],
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 10;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const notes = [261.63, 329.63, 392.0, 523.25];

    notes.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.value = freq * 1.002;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(800, 0);
      filter.frequency.linearRampToValueAtTime(2000, duration * 0.5);
      filter.frequency.linearRampToValueAtTime(600, duration);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, 0);
      gain.gain.linearRampToValueAtTime(0.08, duration * 0.3);
      gain.gain.setValueAtTime(0.08, duration * 0.7);
      gain.gain.linearRampToValueAtTime(0, duration);

      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc2.start();
    });

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "music",
      subcategory: genre,
      duration,
      bpm: 60,
      key: "C Major",
      tags: ["ambient", "pad", "atmospheric"],
      mood,
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateChordProgression(
    id: string,
    name: string,
    bpm: number,
    genre: MusicGenre,
    mood: MoodTag[],
    progressionType: keyof typeof CHORD_PROGRESSIONS = "pop",
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 16;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const progression =
      CHORD_PROGRESSIONS[progressionType] || CHORD_PROGRESSIONS.pop;
    const beatsPerChord = 4;
    const beatDuration = 60 / bpm;
    const chordDuration = beatsPerChord * beatDuration;

    progression.forEach((chord, chordIndex) => {
      const chordStart = chordIndex * chordDuration;

      chord.forEach((note) => {
        const freq = this.noteToFreq(note);

        const osc = ctx.createOscillator();
        osc.type = genre === "electronic" ? "sawtooth" : "triangle";
        osc.frequency.value = freq;

        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.value = freq * 1.001;

        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(2000, chordStart);
        filter.frequency.linearRampToValueAtTime(
          800,
          chordStart + chordDuration,
        );
        filter.Q.value = 1;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, chordStart);
        gain.gain.linearRampToValueAtTime(0.12, chordStart + 0.1);
        gain.gain.setValueAtTime(0.1, chordStart + chordDuration - 0.2);
        gain.gain.linearRampToValueAtTime(0, chordStart + chordDuration);

        osc.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(chordStart);
        osc.stop(chordStart + chordDuration);
        osc2.start(chordStart);
        osc2.stop(chordStart + chordDuration);
      });
    });

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "music",
      subcategory: genre,
      duration,
      bpm,
      key: "C Major",
      tags: ["chords", "progression", genre],
      mood,
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateMelody(
    id: string,
    name: string,
    bpm: number,
    genre: MusicGenre,
    mood: MoodTag[],
    scaleType: keyof typeof SCALES = "pentatonic",
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 8;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const scale = SCALES[scaleType];
    const rootFreq = 261.63;
    const scaleFreqs = this.getScaleFrequencies(rootFreq, scale, 2);

    const beatDuration = 60 / bpm;
    const notesPerBeat = 2;
    const noteDuration = beatDuration / notesPerBeat;
    const totalNotes = Math.floor(duration / noteDuration);

    let prevNoteIndex = Math.floor(scaleFreqs.length / 2);

    for (let i = 0; i < totalNotes; i++) {
      const noteStart = i * noteDuration;

      const step = Math.floor(Math.random() * 5) - 2;
      let noteIndex = prevNoteIndex + step;
      noteIndex = Math.max(0, Math.min(scaleFreqs.length - 1, noteIndex));
      prevNoteIndex = noteIndex;

      const freq = scaleFreqs[noteIndex];

      const osc = ctx.createOscillator();
      osc.type = genre === "lofi" ? "triangle" : "sine";
      osc.frequency.value = freq;

      const vibrato = ctx.createOscillator();
      vibrato.type = "sine";
      vibrato.frequency.value = 5;

      const vibratoGain = ctx.createGain();
      vibratoGain.gain.value = freq * 0.01;

      vibrato.connect(vibratoGain);
      vibratoGain.connect(osc.frequency);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 3000;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(0.2, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.01,
        noteStart + noteDuration * 0.9,
      );

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteStart);
      osc.stop(noteStart + noteDuration);
      vibrato.start(noteStart);
      vibrato.stop(noteStart + noteDuration);
    }

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "music",
      subcategory: genre,
      duration,
      bpm,
      key: "C Major",
      tags: ["melody", "lead", genre],
      mood,
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateArpeggio(
    id: string,
    name: string,
    bpm: number,
    genre: MusicGenre,
    mood: MoodTag[],
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 8;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const chords = CHORD_PROGRESSIONS.electronic;
    const beatDuration = 60 / bpm;
    const notesPerBeat = 4;
    const noteDuration = beatDuration / notesPerBeat;

    chords.forEach((chord, chordIdx) => {
      const chordStart = chordIdx * 2 * beatDuration;

      for (let beat = 0; beat < 8; beat++) {
        const noteIdx = beat % chord.length;
        const noteStart = chordStart + beat * noteDuration;

        if (noteStart >= duration) break;

        const freq = this.noteToFreq(chord[noteIdx]);

        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;

        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(4000, noteStart);
        filter.frequency.exponentialRampToValueAtTime(
          500,
          noteStart + noteDuration,
        );
        filter.Q.value = 5;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(0.15, noteStart + 0.01);
        gain.gain.exponentialRampToValueAtTime(
          0.01,
          noteStart + noteDuration * 0.8,
        );

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(noteStart);
        osc.stop(noteStart + noteDuration);
      }
    });

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "music",
      subcategory: genre,
      duration,
      bpm,
      key: "A Minor",
      tags: ["arpeggio", "synth", genre],
      mood,
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateBassline(
    id: string,
    name: string,
    bpm: number,
    genre: MusicGenre,
    mood: MoodTag[],
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 8;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const bassNotes = ["C2", "C2", "G2", "G2", "A2", "A2", "F2", "F2"];
    const beatDuration = 60 / bpm;

    bassNotes.forEach((note, idx) => {
      const noteStart = idx * beatDuration;
      const freq = this.noteToFreq(note);

      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;

      const subOsc = ctx.createOscillator();
      subOsc.type = "sine";
      subOsc.frequency.value = freq / 2;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(800, noteStart);
      filter.frequency.exponentialRampToValueAtTime(
        200,
        noteStart + beatDuration,
      );
      filter.Q.value = 8;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(0.4, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.1,
        noteStart + beatDuration * 0.8,
      );

      const subGain = ctx.createGain();
      subGain.gain.value = 0.3;

      osc.connect(filter);
      filter.connect(gain);
      subOsc.connect(subGain);
      subGain.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteStart);
      osc.stop(noteStart + beatDuration);
      subOsc.start(noteStart);
      subOsc.stop(noteStart + beatDuration);
    });

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "music",
      subcategory: genre,
      duration,
      bpm,
      key: "C Minor",
      tags: ["bass", "groove", genre],
      mood,
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateDrumLoop(
    id: string,
    name: string,
    bpm: number,
    genre: MusicGenre,
    mood: MoodTag[],
    style: "basic" | "complex" | "minimal" = "basic",
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 8;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const beatDuration = 60 / bpm;
    const sixteenth = beatDuration / 4;
    const numBars = Math.floor(duration / (beatDuration * 4));

    for (let bar = 0; bar < numBars; bar++) {
      const barStart = bar * beatDuration * 4;

      for (let beat = 0; beat < 16; beat++) {
        const time = barStart + beat * sixteenth;
        if (time >= duration) break;

        const isKick =
          beat === 0 ||
          beat === 8 ||
          (style === "complex" && (beat === 6 || beat === 14));
        const isSnare = beat === 4 || beat === 12;
        const isHihat = style !== "minimal" || beat % 4 === 0;
        const isOpenHat = beat === 2 || beat === 10;

        if (isKick) {
          const kickOsc = ctx.createOscillator();
          kickOsc.type = "sine";
          kickOsc.frequency.setValueAtTime(150, time);
          kickOsc.frequency.exponentialRampToValueAtTime(30, time + 0.15);

          const kickGain = ctx.createGain();
          kickGain.gain.setValueAtTime(0.8, time);
          kickGain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

          const kickClick = ctx.createOscillator();
          kickClick.type = "triangle";
          kickClick.frequency.setValueAtTime(1000, time);
          kickClick.frequency.exponentialRampToValueAtTime(100, time + 0.03);

          const clickGain = ctx.createGain();
          clickGain.gain.setValueAtTime(0.3, time);
          clickGain.gain.exponentialRampToValueAtTime(0.01, time + 0.03);

          kickOsc.connect(kickGain);
          kickGain.connect(ctx.destination);
          kickClick.connect(clickGain);
          clickGain.connect(ctx.destination);

          kickOsc.start(time);
          kickOsc.stop(time + 0.2);
          kickClick.start(time);
          kickClick.stop(time + 0.03);
        }

        if (isSnare) {
          const snareNoise = ctx.createBuffer(1, sampleRate * 0.15, sampleRate);
          const noiseData = snareNoise.getChannelData(0);
          for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = Math.random() * 2 - 1;
          }

          const noise = ctx.createBufferSource();
          noise.buffer = snareNoise;

          const snareFilter = ctx.createBiquadFilter();
          snareFilter.type = "highpass";
          snareFilter.frequency.value = 1000;

          const snareGain = ctx.createGain();
          snareGain.gain.setValueAtTime(0.5, time);
          snareGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

          const snareBody = ctx.createOscillator();
          snareBody.type = "triangle";
          snareBody.frequency.setValueAtTime(200, time);
          snareBody.frequency.exponentialRampToValueAtTime(100, time + 0.05);

          const bodyGain = ctx.createGain();
          bodyGain.gain.setValueAtTime(0.3, time);
          bodyGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

          noise.connect(snareFilter);
          snareFilter.connect(snareGain);
          snareGain.connect(ctx.destination);
          snareBody.connect(bodyGain);
          bodyGain.connect(ctx.destination);

          noise.start(time);
          snareBody.start(time);
          snareBody.stop(time + 0.1);
        }

        if (isHihat && style !== "minimal") {
          const hatNoise = ctx.createBuffer(1, sampleRate * 0.05, sampleRate);
          const hatData = hatNoise.getChannelData(0);
          for (let i = 0; i < hatData.length; i++) {
            hatData[i] = Math.random() * 2 - 1;
          }

          const hat = ctx.createBufferSource();
          hat.buffer = hatNoise;

          const hatFilter = ctx.createBiquadFilter();
          hatFilter.type = "highpass";
          hatFilter.frequency.value = 8000;

          const hatGain = ctx.createGain();
          const hatDur = isOpenHat ? 0.1 : 0.03;
          hatGain.gain.setValueAtTime(isOpenHat ? 0.25 : 0.15, time);
          hatGain.gain.exponentialRampToValueAtTime(0.01, time + hatDur);

          hat.connect(hatFilter);
          hatFilter.connect(hatGain);
          hatGain.connect(ctx.destination);

          hat.start(time);
        }
      }
    }

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "music",
      subcategory: genre,
      duration,
      bpm,
      tags: ["drums", "loop", "beat", genre],
      mood,
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateFullTrack(
    id: string,
    name: string,
    bpm: number,
    genre: MusicGenre,
    mood: MoodTag[],
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 16;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const beatDuration = 60 / bpm;
    const barDuration = beatDuration * 4;

    const reverbImpulse = this.createReverbImpulse(ctx, 2.5, 3);
    const reverb = ctx.createConvolver();
    reverb.buffer = reverbImpulse;

    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.25;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.8;

    const masterCompressor = ctx.createDynamicsCompressor();
    masterCompressor.threshold.value = -6;
    masterCompressor.ratio.value = 3;
    masterCompressor.attack.value = 0.003;
    masterCompressor.release.value = 0.25;

    reverb.connect(reverbGain);
    reverbGain.connect(masterCompressor);
    dryGain.connect(masterCompressor);
    masterCompressor.connect(ctx.destination);

    const isHappy =
      mood.includes("happy") ||
      mood.includes("bright") ||
      mood.includes("playful");
    const isEnergetic =
      mood.includes("energetic") || mood.includes("inspiring");
    const isChill = mood.includes("calm") || mood.includes("nostalgic");

    let progression: string[][];
    if (isHappy) {
      progression = RICH_PROGRESSIONS.happy;
    } else if (isEnergetic) {
      progression = RICH_PROGRESSIONS.uplifting;
    } else if (isChill) {
      progression = RICH_PROGRESSIONS.chill;
    } else if (genre === "hip-hop") {
      progression = RICH_PROGRESSIONS.funky;
    } else {
      progression = RICH_PROGRESSIONS.emotional;
    }

    const totalBars = Math.floor(duration / barDuration);

    for (let bar = 0; bar < totalBars; bar++) {
      const chordIdx = bar % progression.length;
      const chord = progression[chordIdx];
      const barStart = bar * barDuration;

      chord.forEach((note, noteIdx) => {
        const freq = this.noteToFreq(note);
        if (noteIdx < 2) {
          this.createWarmPad(ctx, freq, barStart, barDuration, 0.12, reverb);
          this.createWarmPad(ctx, freq, barStart, barDuration, 0.08, dryGain);
        } else {
          this.createWarmPad(ctx, freq, barStart, barDuration, 0.06, reverb);
        }
      });

      const bassNote = chord[0];
      const bassFreq = this.noteToFreq(bassNote);

      if (genre === "hip-hop" || genre === "electronic") {
        for (let beat = 0; beat < 4; beat++) {
          const noteStart = barStart + beat * beatDuration;
          if (beat === 0 || beat === 2) {
            this.createRichBass(
              ctx,
              bassFreq,
              noteStart,
              beatDuration * 0.8,
              0.4,
              dryGain,
            );
          }
        }
      } else {
        for (let beat = 0; beat < 4; beat++) {
          const noteStart = barStart + beat * beatDuration;
          this.createRichBass(
            ctx,
            bassFreq,
            noteStart,
            beatDuration * 0.7,
            0.3,
            dryGain,
          );
        }
      }

      const melodyPattern = isHappy
        ? MELODY_PATTERNS.bouncy
        : isEnergetic
          ? MELODY_PATTERNS.energetic
          : MELODY_PATTERNS.flowing;
      const rootFreq = this.noteToFreq(chord[2] || chord[1]);

      if (bar % 2 === 0) {
        melodyPattern.forEach((interval, i) => {
          const noteTime = barStart + (i * beatDuration) / 2;
          if (noteTime < barStart + barDuration - 0.1) {
            const melodyFreq = rootFreq * Math.pow(2, interval / 12);
            this.createPluckySynth(
              ctx,
              melodyFreq,
              noteTime,
              beatDuration * 0.4,
              0.15,
              reverb,
            );
          }
        });
      }
    }

    const totalBeats = Math.floor(duration / beatDuration);
    for (let beat = 0; beat < totalBeats; beat++) {
      const time = beat * beatDuration;
      const beatInBar = beat % 4;
      const barNumber = Math.floor(beat / 4);

      if (beatInBar === 0 || beatInBar === 2) {
        this.createPunchyKick(ctx, time, 0.5, dryGain);
      }

      if (beatInBar === 1 || beatInBar === 3) {
        this.createCrispSnare(ctx, time, 0.35, reverb);
      }

      if (genre === "electronic" || genre === "pop" || isEnergetic) {
        this.createShimmeringHiHat(ctx, time, 0.08, false, reverb);
        if (beatInBar === 2) {
          this.createShimmeringHiHat(
            ctx,
            time + beatDuration / 2,
            0.06,
            true,
            reverb,
          );
        }
      } else {
        if (beatInBar % 2 === 0) {
          this.createShimmeringHiHat(ctx, time, 0.07, false, reverb);
        }
      }

      if (genre === "hip-hop" && barNumber % 2 === 1) {
        if (beatInBar === 0) {
          this.createShimmeringHiHat(
            ctx,
            time + beatDuration * 0.25,
            0.04,
            false,
            dryGain,
          );
          this.createShimmeringHiHat(
            ctx,
            time + beatDuration * 0.75,
            0.04,
            false,
            dryGain,
          );
        }
      }
    }

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "music",
      subcategory: genre,
      duration,
      bpm,
      key: "C Major",
      tags: ["full", "track", "complete", genre],
      mood,
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateStinger(
    id: string,
    name: string,
    mood: MoodTag[],
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 3;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const stingerChord = ["C4", "E4", "G4", "C5"];

    stingerChord.forEach((note, idx) => {
      const freq = this.noteToFreq(note);
      const startTime = idx * 0.05;

      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;

      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.value = freq * 2;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.2, startTime + 0.05);
      gain.gain.setValueAtTime(0.15, startTime + 0.5);
      gain.gain.exponentialRampToValueAtTime(0.01, duration);

      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0, startTime);
      gain2.gain.linearRampToValueAtTime(0.08, startTime + 0.05);
      gain2.gain.exponentialRampToValueAtTime(0.01, startTime + 1.5);

      osc.connect(gain);
      osc2.connect(gain2);
      gain.connect(ctx.destination);
      gain2.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(duration);
      osc2.start(startTime);
      osc2.stop(startTime + 1.5);
    });

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "musical",
      duration,
      tags: ["stinger", "logo", "intro"],
      mood,
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateCinematicHit(
    id: string,
    name: string,
  ): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 4;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const subBass = ctx.createOscillator();
    subBass.type = "sine";
    subBass.frequency.setValueAtTime(60, 0);
    subBass.frequency.exponentialRampToValueAtTime(20, duration);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.8, 0);
    subGain.gain.exponentialRampToValueAtTime(0.01, duration);

    subBass.connect(subGain);
    subGain.connect(ctx.destination);
    subBass.start(0);
    subBass.stop(duration);

    const impactNoise = ctx.createBuffer(2, sampleRate * 0.5, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impactNoise.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }

    const noise = ctx.createBufferSource();
    noise.buffer = impactNoise;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(2000, 0);
    noiseFilter.frequency.exponentialRampToValueAtTime(100, 0.5);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.6, 0);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, 0.5);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(0);

    const toneFreqs = [65.41, 130.81, 261.63];
    toneFreqs.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1000, 0);
      filter.frequency.exponentialRampToValueAtTime(100, 2);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.15, 0);
      gain.gain.exponentialRampToValueAtTime(0.01, 3);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(0);
      osc.stop(3);
    });

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "impacts",
      duration,
      tags: ["cinematic", "hit", "epic", "trailer"],
      mood: ["tense", "dark"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateTypingSound(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 0.08;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(800 + Math.random() * 400, 0);
    osc.frequency.exponentialRampToValueAtTime(200, duration);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2000;
    filter.Q.value = 2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, 0);
    gain.gain.exponentialRampToValueAtTime(0.01, duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "ui",
      duration,
      tags: ["keyboard", "typing", "click"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateErrorSound(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 0.4;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    [0, 0.15].forEach((startTime) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 220;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.25, startTime + 0.02);
      gain.gain.linearRampToValueAtTime(0, startTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.12);
    });

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "ui",
      duration,
      tags: ["error", "warning", "alert"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  async generateCountdown(id: string, name: string): Promise<GeneratedSound> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const duration = 4;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    for (let i = 0; i < 4; i++) {
      const time = i;
      const isFinal = i === 3;
      const freq = isFinal ? 880 : 440;

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(isFinal ? 0.4 : 0.3, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.01,
        time + (isFinal ? 0.8 : 0.15),
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + (isFinal ? 0.8 : 0.15));
    }

    const rendered = await ctx.startRendering();
    const blob = await this.audioBufferToBlob(rendered);
    const dataUrl = URL.createObjectURL(blob);

    const item: SoundItem = {
      id,
      name,
      category: "sfx",
      subcategory: "ui",
      duration,
      tags: ["countdown", "timer", "beep"],
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
      isBuiltin: true,
      license: "royalty-free",
    };

    const result = { item, blob, dataUrl };
    this.cache.set(id, result);
    return result;
  }

  private async audioBufferToBlob(buffer: AudioBuffer): Promise<Blob> {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = buffer.length * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, totalSize - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const channels: Float32Array[] = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, channels[channel][i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  dispose(): void {
    for (const { dataUrl } of this.cache.values()) {
      URL.revokeObjectURL(dataUrl);
    }
    this.cache.clear();
  }
}

let soundGeneratorInstance: SoundGenerator | null = null;

export function getSoundGenerator(): SoundGenerator {
  if (!soundGeneratorInstance) {
    soundGeneratorInstance = new SoundGenerator();
  }
  return soundGeneratorInstance;
}
