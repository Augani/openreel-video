import { useEffect, useRef } from "react";
import type { MediaItem, MotionAudioClip, MotionComposition } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { MotionAudioPlayback } from "../motion-audio-playback";

const EMPTY_CLIPS: readonly MotionAudioClip[] = [];
const SEEK_JUMP_THRESHOLD = 0.35;

export function useMotionAudioPlayback(
  composition: MotionComposition | null,
): void {
  const engineRef = useRef<MotionAudioPlayback | null>(null);
  const isPlaying = useMotionStore((state) => state.isPlaying);
  const playhead = useMotionStore((state) => state.playhead);
  const playbackRate = useMotionStore((state) => state.playbackRate);
  const previewMuted = useMotionStore((state) => state.previewMuted);
  const mediaItems = useProjectStore(
    (state) => state.project.mediaLibrary.items,
  );

  const audioClips = composition?.audioClips ?? EMPTY_CLIPS;
  const compositionId = composition?.id ?? null;

  const audioClipsRef = useRef<readonly MotionAudioClip[]>(audioClips);
  const mediaItemsRef = useRef<readonly MediaItem[]>(mediaItems);
  const playheadRef = useRef(playhead);
  const rateRef = useRef(playbackRate);
  const lastPlayheadRef = useRef(playhead);
  const lastRateRef = useRef(playbackRate);
  audioClipsRef.current = audioClips;
  mediaItemsRef.current = mediaItems;
  playheadRef.current = playhead;
  rateRef.current = playbackRate;

  useEffect(() => {
    const engine = new MotionAudioPlayback();
    engine.setMuted(useMotionStore.getState().previewMuted);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setMuted(previewMuted);
  }, [previewMuted]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.stop();
    engine.clearCache();
  }, [compositionId]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (isPlaying) {
      lastPlayheadRef.current = playheadRef.current;
      void engine.play(
        audioClipsRef.current,
        mediaItemsRef.current,
        playheadRef.current,
        rateRef.current,
      );
    } else {
      engine.stop();
    }
  }, [isPlaying]);

  useEffect(() => {
    const engine = engineRef.current;
    const rateChanged = lastRateRef.current !== playbackRate;
    lastRateRef.current = playbackRate;
    if (!engine || !isPlaying || !rateChanged) return;
    engine.setRate(playbackRate);
    void engine.play(
      audioClipsRef.current,
      mediaItemsRef.current,
      playheadRef.current,
      playbackRate,
    );
  }, [playbackRate, isPlaying]);

  useEffect(() => {
    const engine = engineRef.current;
    const previous = lastPlayheadRef.current;
    lastPlayheadRef.current = playhead;
    if (!engine || !isPlaying) return;
    const jumpedBack = playhead < previous - 0.001;
    const jumpedFar = Math.abs(playhead - previous) > SEEK_JUMP_THRESHOLD;
    if (jumpedBack || jumpedFar) {
      void engine.play(
        audioClipsRef.current,
        mediaItemsRef.current,
        playhead,
        rateRef.current,
      );
    }
  }, [playhead, isPlaying]);
}
