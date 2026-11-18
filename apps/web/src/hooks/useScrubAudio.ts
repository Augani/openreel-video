import { useEffect, useRef } from "react";
import { ScrubGrainThrottle, type AudioClipSchedule } from "@openreel/core";
import { useScrubAudioStore } from "../stores/scrub-audio-store";

export interface ScrubAudioTarget {
  playScrubGrains(schedules: readonly AudioClipSchedule[], time: number): number;
  stopScrubGrains(): void;
  resume(): Promise<void>;
}

interface Options {
  /** True while the playhead is being dragged (and nothing is playing). */
  scrubbing: boolean;
  position: number | null;
  /** The clips (with decoded audio) around `time`, as the playback scheduler builds them. */
  getSchedules: (time: number) => AudioClipSchedule[];
  getGraph: () => ScrubAudioTarget;
  /** Seconds on a monotonic clock; injectable for tests. */
  now?: () => number;
}

/**
 * Audible scrubbing: while `scrubbing`, every playhead move fires a short grain per audible clip
 * through the realtime graph (so track mute, solo, fader and automation apply). Does nothing when the
 * user turned scrub audio off.
 */
export function useScrubAudio({ scrubbing, position, getSchedules, getGraph, now }: Options): void {
  const enabled = useScrubAudioStore((state) => state.enabled);
  const throttle = useRef(new ScrubGrainThrottle());
  const played = useRef(false);
  const latest = useRef({ getSchedules, getGraph, now });
  latest.current = { getSchedules, getGraph, now };

  useEffect(() => {
    if (!scrubbing || !enabled || position === null) return;
    const clock = latest.current.now ?? (() => performance.now() / 1000);
    if (!throttle.current.take(clock(), position)) return;
    try {
      const graph = latest.current.getGraph();
      void graph.resume().catch(() => {});
      played.current = true;
      graph.playScrubGrains(latest.current.getSchedules(position), position);
    } catch {
      /* audio unavailable (tests, locked-down browsers) */
    }
  }, [scrubbing, enabled, position]);

  useEffect(() => {
    if (scrubbing && enabled) return;
    throttle.current.reset();
    if (!played.current) return;
    played.current = false;
    try {
      latest.current.getGraph().stopScrubGrains();
    } catch {
      /* audio unavailable */
    }
  }, [scrubbing, enabled]);
}
