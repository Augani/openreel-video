import React, { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openreel/ui";
import { useEngineStore } from "../../../stores/engine-store";
import { indicatorView, useDroppedFrameIndicatorPrefs, type IndicatorTone } from "./dropped-frame-indicator-state";

/** The part of PlaybackController the indicator reads; lets tests and other sources plug in. */
export interface DroppedFrameSource {
  getDroppedFrames(): number;
  resetDroppedFrames(): void;
  subscribeDroppedFrames(listener: (count: number) => void): () => void;
}

const TONE_CLASS: Record<IndicatorTone, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  off: "border border-current bg-transparent opacity-40",
};

function useDroppedFrames(source: DroppedFrameSource | null): number {
  const [count, setCount] = useState(() => source?.getDroppedFrames() ?? 0);
  useEffect(() => {
    if (!source) {
      setCount(0);
      return undefined;
    }
    setCount(source.getDroppedFrames());
    return source.subscribeDroppedFrames(setCount);
  }, [source]);
  return count;
}

/**
 * Premiere's dropped frame indicator for the Program monitor: a dot that is green while playback
 * has dropped nothing and turns yellow with the running count from the first dropped frame. The count
 * restarts with every playback run. Clicking it opens the monitor setting that turns it off (and back on).
 */
export const DroppedFrameIndicator: React.FC<{ source?: DroppedFrameSource | null }> = ({ source }) => {
  const engineSource = useEngineStore((s) => s.playbackController);
  const effective = source === undefined ? engineSource : source;
  const count = useDroppedFrames(effective);
  const enabled = useDroppedFrameIndicatorPrefs((s) => s.enabled);
  const setEnabled = useDroppedFrameIndicatorPrefs((s) => s.setEnabled);
  const view = indicatorView(count, enabled);

  return (
    <div className="absolute right-2 top-2 z-10" data-testid="dropped-frame-indicator" data-tone={view.tone}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={view.label}
            title={view.label}
            className="flex h-5 items-center gap-1 rounded-full bg-black/40 px-1.5 text-[10px] font-medium leading-none text-white/90 hover:bg-black/60"
          >
            <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${TONE_CLASS[view.tone]}`} />
            {view.text ? <span data-testid="dropped-frame-count">{view.text}</span> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuCheckboxItem checked={enabled} onCheckedChange={setEnabled}>
            Show dropped frame indicator
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!effective || count === 0} onSelect={() => effective?.resetDroppedFrames()}>
            Reset count
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
