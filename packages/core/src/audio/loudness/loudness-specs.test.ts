import { describe, expect, it } from "vitest";
import {
  LOUDNESS_PRESETS,
  LoudnessMeter,
  evaluateCompliance,
  loudnessTargetFromPreset,
  measureLoudness,
  planNormalization,
} from "./index";

const FS = 48000;
const db = (x: number) => Math.pow(10, x / 20);

/** Stereo 1 kHz sine segments: [seconds, peak dBFS] (EBU Tech 3341/3342 style test signals). */
function stereoSine(segments: Array<[number, number]>, freq = 1000): Float32Array[] {
  const total = segments.reduce((s, [sec]) => s + Math.round(sec * FS), 0);
  const l = new Float32Array(total);
  let at = 0;
  let idx = 0;
  for (const [sec, level] of segments) {
    const n = Math.round(sec * FS);
    const amp = db(level);
    for (let i = 0; i < n; i++, idx++) l[at + i] = amp * Math.sin((2 * Math.PI * freq * idx) / FS);
    at += n;
  }
  return [l, new Float32Array(l)];
}

describe("loudness delivery spec library", () => {
  it("covers the broadcast, streaming and platform specs with tolerances", () => {
    const byId = Object.fromEntries(LOUDNESS_PRESETS.map((p) => [p.id, p]));
    expect(byId.broadcast).toMatchObject({ targetLufs: -23, truePeakCeilingDb: -1, toleranceLu: 0.5, gating: "program" });
    expect(byId["atsc-a85"]).toMatchObject({ targetLufs: -24, truePeakCeilingDb: -2, toleranceLu: 2 });
    expect(byId.netflix).toMatchObject({ targetLufs: -27, truePeakCeilingDb: -2, gating: "dialogue" });
    expect(byId["amazon-prime"]).toMatchObject({ targetLufs: -24, truePeakCeilingDb: -2 });
    expect(byId.podcast).toMatchObject({ targetLufs: -16, truePeakCeilingDb: -1 });
    expect(byId.streaming).toMatchObject({ targetLufs: -14, truePeakCeilingDb: -1 });
    expect(new Set(LOUDNESS_PRESETS.map((p) => p.id)).size).toBe(LOUDNESS_PRESETS.length);
  });
});

describe("BS.1770 gating against reference signals (EBU Tech 3341)", () => {
  // -36 / -23 / -36 LUFS programme: the quiet ends fall under the relative gate.
  const signal = stereoSine([[10, -36], [60, -23], [10, -36]]);
  const meter = new LoudnessMeter(FS, 2);
  meter.process(signal);

  it("gated integrated loudness is the -23.0 LUFS reference", () => {
    expect(Math.abs(meter.integrated() - -23)).toBeLessThanOrEqual(0.1);
  });

  it("ungated loudness is the energy average of the whole programme", () => {
    const expected = 10 * Math.log10((60 * Math.pow(10, -2.3) + 20 * Math.pow(10, -3.6)) / 80);
    // -23 and -36 LUFS segments energy-averaged over 80 s: about -24.18 LUFS.
    expect(Math.abs(meter.ungatedIntegrated() - expected)).toBeLessThanOrEqual(0.1);
    expect(meter.ungatedIntegrated()).toBeLessThan(meter.integrated() - 1);
  });
});

describe("loudness range (EBU Tech 3342)", () => {
  const lra = (segments: Array<[number, number]>) => measureLoudness(stereoSine(segments), FS).loudnessRange;

  it("20 s at -20 LUFS then 20 s at -30 LUFS is 10 LU", () => {
    expect(Math.abs(lra([[20, -20], [20, -30]]) - 10)).toBeLessThanOrEqual(1);
  });

  it("-40 then -20 LUFS is 20 LU", () => {
    expect(Math.abs(lra([[20, -40], [20, -20]]) - 20)).toBeLessThanOrEqual(1);
  });

  it("a steady tone has no range", () => {
    expect(lra([[30, -23]])).toBeLessThan(0.5);
  });
});

describe("true peak (BS.1770-4 Annex 2)", () => {
  it("reads the inter-sample peak of a fs/4 sine at 45 degrees", () => {
    // Samples are +-A*sin(45 deg) = +-0.3536 (sample peak -9.03 dBFS), true peak is A = -6.02 dBTP.
    const n = FS * 2;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * (FS / 4) * i) / FS + Math.PI / 4);
    const m = measureLoudness([x, new Float32Array(x)], FS);
    expect(m.samplePeak).toBeCloseTo(-9.03, 1);
    expect(Math.abs(m.truePeak - -6.02)).toBeLessThanOrEqual(0.3);
  });
});

/** Voice-like harmonic source with formants, syllabic AM at ~4 Hz and phrase pauses. */
function speech(seconds: number, level: number): Float32Array {
  const n = Math.round(seconds * FS);
  const out = new Float32Array(n);
  const f0 = 118;
  const formants = [550, 1500, 2600];
  const amps: number[] = [];
  for (let h = 1; h * f0 < 5000; h++) {
    const f = h * f0;
    amps.push(formants.reduce((a, fc) => a + Math.exp(-Math.pow((f - fc) / 350, 2)), 0.02));
  }
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    const phrase = t % 2.2 < 1.7 ? 1 : 0;
    const syllable = Math.pow(Math.max(0, Math.sin(2 * Math.PI * 4 * t)), 0.7);
    const f = f0 * (1 + 0.04 * Math.sin(2 * Math.PI * 0.7 * t));
    let v = 0;
    for (let h = 1; h <= amps.length; h++) v += amps[h - 1] * Math.sin(2 * Math.PI * h * f * t);
    out[i] = v * phrase * syllable;
  }
  const peak = out.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
  const gain = db(level) / peak;
  for (let i = 0; i < n; i++) out[i] *= gain;
  return out;
}

/** Sustained pad: chord with slow vibrato, no syllabic structure. */
function music(seconds: number, level: number): Float32Array {
  const n = Math.round(seconds * FS);
  const out = new Float32Array(n);
  const partials: Array<[number, number]> = [[110, 1], [165, 0.8], [220, 0.9], [277.2, 0.6], [330, 0.7], [440, 0.5], [660, 0.3], [880, 0.2], [1320, 0.1]];
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    let v = 0;
    for (const [f, a] of partials) v += a * Math.sin(2 * Math.PI * f * t + 0.3 * Math.sin(2 * Math.PI * 0.4 * t));
    out[i] = v;
  }
  const peak = out.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
  const gain = db(level) / peak;
  for (let i = 0; i < n; i++) out[i] *= gain;
  return out;
}

/** speech | music | speech | music, equal 8 s slots. Returns the mix and the speech-only twin. */
function speechAndMusic(): { mix: Float32Array[]; speechOnly: Float32Array[] } {
  const slot = 8;
  const sp = [speech(slot, -22), speech(slot, -22)];
  const mu = [music(slot, -10), music(slot, -10)];
  const len = slot * FS;
  const mix = new Float32Array(len * 4);
  const only = new Float32Array(len * 4);
  mix.set(sp[0], 0);
  only.set(sp[0], 0);
  mix.set(mu[0], len);
  mix.set(sp[1], len * 2);
  only.set(sp[1], len * 2);
  mix.set(mu[1], len * 3);
  return { mix: [mix, new Float32Array(mix)], speechOnly: [only, new Float32Array(only)] };
}

describe("dialogue-gated measurement on a speech + music fixture", () => {
  const { mix, speechOnly } = speechAndMusic();
  const gated = new LoudnessMeter(FS, 2, { dialogueGate: true });
  gated.process(mix);
  const snap = gated.snapshot();
  const reference = new LoudnessMeter(FS, 2);
  reference.process(speechOnly);

  it("program loudness is dominated by the louder music bed", () => {
    expect(snap.integrated).toBeGreaterThan(reference.integrated() + 6);
  });

  it("dialogue-gated loudness lands on the speech-only loudness", () => {
    expect(snap.dialogueIntegrated).toBeDefined();
    expect(Math.abs((snap.dialogueIntegrated as number) - reference.integrated())).toBeLessThanOrEqual(1);
  });

  it("classifies about half of the audible blocks as dialogue", () => {
    expect(snap.dialogueFraction).toBeGreaterThan(0.25);
    expect(snap.dialogueFraction).toBeLessThan(0.6);
  });

  it("music alone has no dialogue", () => {
    const m = new LoudnessMeter(FS, 2, { dialogueGate: true });
    const pad = music(12, -12);
    m.process([pad, pad]);
    expect(m.dialogueIntegrated()).toBe(-Infinity);
    expect(m.dialogueFraction()).toBe(0);
  });

  it("the meter skips the gate unless asked", () => {
    expect(measureLoudness(mix, FS).dialogueIntegrated).toBeUndefined();
  });

  it("a dialogue-gated spec normalizes the dialogue, not the music", () => {
    const netflix = LOUDNESS_PRESETS.find((p) => p.id === "netflix")!;
    const plan = planNormalization(snap, loudnessTargetFromPreset(netflix));
    expect(plan.basis).toBe("dialogue");
    expect(plan.gainDb).toBeCloseTo(-27 - (snap.dialogueIntegrated as number), 6);
    const program = planNormalization(snap, { targetLufs: -27, truePeakCeilingDb: -2 });
    expect(program.basis).toBe("program");
    expect(plan.gainDb).toBeGreaterThan(program.gainDb + 5);
  });

  it("falls back to the program loudness when no dialogue is found", () => {
    const plan = planNormalization(
      { integrated: -20, truePeak: -3, dialogueIntegrated: -Infinity },
      { targetLufs: -27, truePeakCeilingDb: -2, gating: "dialogue" },
    );
    expect(plan).toMatchObject({ basis: "program", dialogueFallback: true, gainDb: -7 });
  });
});

describe("compliance", () => {
  const ebu = LOUDNESS_PRESETS.find((p) => p.id === "broadcast")!;
  const netflix = LOUDNESS_PRESETS.find((p) => p.id === "netflix")!;

  it("passes within tolerance and under the ceiling", () => {
    const r = evaluateCompliance(loudnessTargetFromPreset(ebu), { integrated: -23.3, loudnessRange: 8, truePeak: -1.4 });
    expect(r.pass).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(["loudness", "truePeak"]);
  });

  it("fails per check", () => {
    const r = evaluateCompliance(loudnessTargetFromPreset(ebu), { integrated: -22.2, loudnessRange: 8, truePeak: -0.2 });
    expect(r.pass).toBe(false);
    expect(r.checks.map((c) => c.pass)).toEqual([false, false]);
  });

  it("checks the dialogue loudness and loudness range for Netflix", () => {
    const ok = evaluateCompliance(loudnessTargetFromPreset(netflix), { integrated: -20, dialogueIntegrated: -27.5, loudnessRange: 12, truePeak: -2.5 });
    expect(ok.pass).toBe(true);
    expect(ok.basis).toBe("dialogue");
    const wide = evaluateCompliance(loudnessTargetFromPreset(netflix), { integrated: -20, dialogueIntegrated: -27, loudnessRange: 21, truePeak: -2.5 });
    expect(wide.checks.find((c) => c.id === "loudnessRange")?.pass).toBe(false);
  });

  it("silence never complies", () => {
    expect(evaluateCompliance(loudnessTargetFromPreset(ebu), { integrated: -Infinity, loudnessRange: 0, truePeak: -Infinity }).pass).toBe(false);
  });
});
