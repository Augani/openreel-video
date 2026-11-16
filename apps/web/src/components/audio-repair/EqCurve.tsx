import { memo, useMemo } from "react";

const POINTS = 96;
const MIN_HZ = 20;
const MAX_HZ = 20000;
const RANGE_DB = 24;

let ctxCache: OfflineAudioContext | null = null;
const context = (): OfflineAudioContext | null => {
  try {
    ctxCache ??= new OfflineAudioContext(1, 1, 48000);
    return ctxCache;
  } catch {
    return null;
  }
};

/**
 * Combined magnitude response (dB) of the rack's 3-band EQ, evaluated with the
 * very BiquadFilterNodes the rack builds, so the curve is what is heard.
 */
export function rackEqResponse(params: Record<string, number | string | boolean>, frequencies: Float32Array<ArrayBuffer>): Float32Array | null {
  const ctx = context();
  if (!ctx) return null;
  const n = (key: string, def: number) => (typeof params[key] === "number" ? (params[key] as number) : def);
  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 120;
  low.gain.value = n("lowGain", 0);
  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = n("midFreq", 1000);
  mid.Q.value = n("midQ", 1);
  mid.gain.value = n("midGain", 0);
  const high = ctx.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 6000;
  high.gain.value = n("highGain", 0);
  const out = new Float32Array(frequencies.length).fill(1);
  const mag = new Float32Array(frequencies.length) as Float32Array<ArrayBuffer>;
  const phase = new Float32Array(frequencies.length) as Float32Array<ArrayBuffer>;
  for (const filter of [low, mid, high]) {
    filter.getFrequencyResponse(frequencies, mag, phase);
    for (let i = 0; i < out.length; i += 1) out[i] *= mag[i];
  }
  return out.map((m) => 20 * Math.log10(Math.max(m, 1e-6)));
}

/** Visual EQ curve (20 Hz - 20 kHz, +-24 dB) for the rack's Parametric EQ. */
export const EqCurve = memo(function EqCurve({ params }: { params: Record<string, number | string | boolean> }) {
  const path = useMemo(() => {
    const freqs = new Float32Array(POINTS);
    for (let i = 0; i < POINTS; i += 1) freqs[i] = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / (POINTS - 1));
    const db = rackEqResponse(params, freqs);
    if (!db) return null;
    const w = 240;
    const h = 72;
    return Array.from(db, (v, i) => {
      const x = (i / (POINTS - 1)) * w;
      const y = h / 2 - (Math.max(-RANGE_DB, Math.min(RANGE_DB, v)) / RANGE_DB) * (h / 2 - 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
  }, [params]);
  if (!path) return null;
  const guide = (hz: number) => (Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * 240;
  return (
    <svg viewBox="0 0 240 72" className="h-[72px] w-full rounded border border-border bg-bg-1" role="img" aria-label="EQ frequency response curve" data-testid="eq-curve">
      <line x1="0" x2="240" y1="36" y2="36" className="stroke-border" strokeWidth="1" />
      {[100, 1000, 10000].map((hz) => (
        <g key={hz}>
          <line x1={guide(hz)} x2={guide(hz)} y1="0" y2="72" className="stroke-border" strokeWidth="0.5" strokeDasharray="2 3" />
          <text x={guide(hz) + 2} y="68" className="fill-fg-muted" fontSize="7">
            {hz >= 1000 ? `${hz / 1000}k` : hz}
          </text>
        </g>
      ))}
      <path d={path} fill="none" className="stroke-accent" strokeWidth="1.6" />
    </svg>
  );
});
