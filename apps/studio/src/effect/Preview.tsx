import { useEffect, useRef, useState, useCallback } from "react";
import { useScene } from "./store";
import { PreviewEngine, type PerfSample, type Quality } from "./preview/PreviewEngine";
import { VideoSource } from "./preview/VideoSource";
import { SampleClipSelector } from "./SampleClipSelector";

export function Preview({ onPerf }: { onPerf?: (p: PerfSample) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const { state } = useScene();
  const [quality, setQuality] = useState<Quality>("balanced");
  const [showMask, setShowMask] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new PreviewEngine(canvasRef.current);
    engineRef.current = engine;
    if (onPerf) engine.onPerf(onPerf);
    engine.start();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [onPerf]);

  useEffect(() => {
    engineRef.current?.setScene(state.scene);
  }, [state.scene]);

  useEffect(() => {
    engineRef.current?.setQuality(quality);
  }, [quality]);

  const handleSource = useCallback((source: VideoSource) => {
    engineRef.current?.setSource(source);
  }, []);

  return (
    <section className="flex h-full flex-1 flex-col bg-zinc-950">
      <SampleClipSelector onSourceChange={handleSource} />
      <div className="flex flex-1 items-center justify-center">
        <canvas ref={canvasRef} className="max-h-full max-w-full" />
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-900 px-4 py-2 text-xs">
        <button
          type="button"
          onClick={() => setShowMask((v) => !v)}
          className={`rounded border px-2 py-1 ${showMask ? "border-blue-500 text-white" : "border-zinc-800 text-zinc-400"}`}
        >
          Mask
        </button>
        {(["perf", "balanced", "full"] as Quality[]).map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setQuality(q)}
            className={`rounded border px-2 py-1 capitalize ${quality === q ? "border-blue-500 text-white" : "border-zinc-800 text-zinc-400"}`}
          >
            {q}
          </button>
        ))}
      </div>
    </section>
  );
}
