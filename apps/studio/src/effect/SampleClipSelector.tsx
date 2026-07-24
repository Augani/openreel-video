import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { useScene } from "./store";
import { loadSampleClips } from "./sample-clips";
import { VideoSource, type SampleClip } from "./preview/VideoSource";

export function SampleClipSelector({ onSourceChange }: { onSourceChange: (source: VideoSource) => void }) {
  const { state, dispatch } = useScene();
  const [clips, setClips] = useState<SampleClip[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSampleClips().then(setClips).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const clip = clips.find((c) => c.id === state.scene.sampleClipId);
    if (clip) onSourceChange(VideoSource.fromSampleClip(clip));
  }, [clips, state.scene.sampleClipId, onSourceChange]);

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const src = VideoSource.fromFile(file);
      onSourceChange(src);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-zinc-900 bg-zinc-950 px-4 py-2 text-xs">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">Sample</span>
      <select
        aria-label="Sample clip"
        value={state.scene.sampleClipId}
        onChange={(e) => dispatch({ type: "setSampleClip", sampleClipId: e.target.value })}
        className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-200"
      >
        {clips.map((c) => (
          <option key={c.id} value={c.id}>{c.label} ({c.aspect})</option>
        ))}
      </select>
      <label className="flex cursor-pointer items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-zinc-300 hover:border-zinc-700">
        <Icon name="upload" size={12} />
        <span>Use your own</span>
        <input type="file" accept="video/*" onChange={onUpload} className="hidden" />
      </label>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
