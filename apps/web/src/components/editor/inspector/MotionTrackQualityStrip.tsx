import { useMemo } from "react";
import { trackQualityRuns, type TrackingData } from "@openreel/core";

const HEIGHT = 44;
const LOW = 0.7;

/**
 * Per-frame tracking quality: a confidence graph over a colour band (green tracked, amber weak,
 * red hidden/predicted, blue hand-placed). Clicking selects the frame; the host moves the playhead.
 */
export function MotionTrackQualityStrip({ data, frameCount, selectedFrame, onSelect, threshold = LOW }: {
  data: TrackingData; frameCount: number; selectedFrame: number; onSelect: (frame: number) => void; threshold?: number;
}) {
  const total = Math.max(1, frameCount - 1);
  const rows = useMemo(() => {
    const lost = new Set(data.lostFrames), manual = new Set(data.manualFrames ?? []);
    return data.keyframes.map((key, index) => ({ frame: key.frame, confidence: data.confidence[index] ?? 1, lost: lost.has(key.frame), manual: manual.has(key.frame), predicted: data.states?.[index] === "predicted" }));
  }, [data]);
  const runs = useMemo(() => trackQualityRuns(data), [data]);
  const x = (frame: number) => frame / total * 100;
  const points = rows.map(row => `${x(row.frame).toFixed(2)},${(HEIGHT - 2 - Math.min(1, Math.max(0, row.confidence)) * (HEIGHT - 8)).toFixed(2)}`).join(" ");
  const lowCount = rows.filter(row => row.lost).length;
  return <div className="space-y-1.5" data-testid="motion-track-quality">
    <div className="flex items-center justify-between gap-2 text-[10px] text-fg-2">
      <span>Tracking quality</span>
      <span data-testid="motion-track-low-count">{lowCount ? `${lowCount} low-confidence frame${lowCount === 1 ? "" : "s"}` : "All frames confident"}</span>
    </div>
    <svg role="slider" tabIndex={0} aria-label="Tracking quality by frame" aria-valuemin={0} aria-valuemax={total} aria-valuenow={selectedFrame}
      viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" className="block h-11 w-full cursor-pointer rounded-md bg-bg-2"
      onPointerDown={event => {
        const box = event.currentTarget.getBoundingClientRect();
        onSelect(Math.round(Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width))) * total));
      }}
      onKeyDown={event => {
        if (event.key === "ArrowLeft") { event.preventDefault(); onSelect(Math.max(0, selectedFrame - 1)); }
        if (event.key === "ArrowRight") { event.preventDefault(); onSelect(Math.min(total, selectedFrame + 1)); }
      }}>
      {runs.map(run => <rect key={`${run.kind}-${run.start}`} data-run={run.kind} x={x(run.start)} width={Math.max(0.6, x(run.end - run.start + 1))} y={0} height={HEIGHT} className={run.kind === "lost" ? "fill-red-500/25" : "fill-amber-400/20"} />)}
      <line x1={0} x2={100} y1={HEIGHT - 2 - threshold * (HEIGHT - 8)} y2={HEIGHT - 2 - threshold * (HEIGHT - 8)} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" className="stroke-fg-2/50" strokeWidth={1} />
      {points && <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" className="stroke-primary" strokeWidth={1.5} />}
      {rows.filter(row => row.manual).map(row => <rect key={`m-${row.frame}`} data-manual="true" x={x(row.frame) - 0.5} width={1} y={0} height={HEIGHT} className="fill-sky-400" />)}
      <rect data-testid="motion-track-playhead" x={x(selectedFrame) - 0.4} width={0.8} y={0} height={HEIGHT} className="fill-fg-1" />
    </svg>
    <div className="flex items-center gap-3 text-[10px] text-fg-2" aria-hidden>
      <span><i className="mr-1 inline-block size-2 rounded-sm bg-primary" />confidence</span>
      <span><i className="mr-1 inline-block size-2 rounded-sm bg-red-500/60" />hidden</span>
      <span><i className="mr-1 inline-block size-2 rounded-sm bg-amber-400/60" />weak</span>
      <span><i className="mr-1 inline-block size-2 rounded-sm bg-sky-400" />hand-set</span>
    </div>
  </div>;
}
