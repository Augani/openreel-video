import type { JSX } from "react";
import { useEffect, useState } from "react";
import { listPracticeClips } from "../../../services/onboarding/practice-project";
import type { OpenReelSampleClipInfo } from "../../../types/global";

interface PracticePoster {
  info: OpenReelSampleClipInfo;
  url: string;
}

export function formatClipLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The shipped practice clips as real poster frames with their length and resolution. The clips are tiny
 * and only read when the Learn sheet is open; the first frame comes from the video itself.
 */
export function PracticeClipStrip(): JSX.Element | null {
  const [posters, setPosters] = useState<PracticePoster[]>([]);

  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void (async () => {
      let infos: OpenReelSampleClipInfo[] = [];
      try {
        infos = (await listPracticeClips()).filter((clip) => clip.kind === "video");
      } catch {
        return;
      }
      const api = window.openreel?.samples;
      if (!api || infos.length === 0 || typeof URL.createObjectURL !== "function") return;
      const loaded: PracticePoster[] = [];
      for (const info of infos.slice(0, 3)) {
        try {
          const data = await api.get(info.id);
          if (!data) continue;
          const url = URL.createObjectURL(new Blob([data.bytes], { type: data.mimeType }));
          urls.push(url);
          loaded.push({ info, url });
        } catch {
          // A clip that cannot be read just has no poster.
        }
      }
      if (alive) setPosters(loaded);
    })();
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  if (posters.length === 0) return null;
  return (
    <span className="mt-3 grid grid-cols-3 gap-2" data-testid="practice-clip-strip">
      {posters.map(({ info, url }) => (
        <span key={info.id} className="min-w-0">
          <span className="relative block aspect-video overflow-hidden rounded-md bg-bg-3">
            <video
              src={`${url}#t=0.5`}
              preload="metadata"
              muted
              playsInline
              aria-hidden="true"
              className="h-full w-full object-cover"
            />
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
              {formatClipLength(info.durationSec)}
            </span>
          </span>
          <span className="mt-1 block truncate text-[11px] text-fg-2">{info.name}</span>
          {info.width && info.height ? (
            <span className="block truncate text-[10px] text-fg-3">
              {info.width}×{info.height}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}
