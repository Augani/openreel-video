import { useEffect, useRef } from "react";
import type { MotionComposition } from "@openreel/core";
import { groupMotionLayers, ungroupMotionLayers } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { advanceMotionPlayhead } from "../playback";
import {
  getMotionStagePlaybackPreviewSettings,
  getMotionStagePreviewFrameStepSeconds,
} from "../stage-preview-mode";
import { useMotionStore } from "../stores/motion-store";

export function useMotionPlayback(
  composition: MotionComposition | null,
): void {
  const isPlaying = useMotionStore((state) => state.isPlaying);
  const togglePlayback = useMotionStore((state) => state.togglePlayback);
  const lastTickRef = useRef<number | null>(null);
  const pendingDeltaRef = useRef(0);

  useEffect(() => {
    if (!composition || !isPlaying) {
      lastTickRef.current = null;
      pendingDeltaRef.current = 0;
      return;
    }

    let raf = 0;
    const tick = (now: number) => {
      const previous = lastTickRef.current ?? now;
      lastTickRef.current = now;
      pendingDeltaRef.current += Math.max(0, (now - previous) / 1000);
      const state = useMotionStore.getState();
      const playbackPreviewSettings = getMotionStagePlaybackPreviewSettings(
        {
          mode: state.previewMode,
          resolution: state.previewResolution,
        },
        true,
      );
      const frameStepSeconds = getMotionStagePreviewFrameStepSeconds(
        composition.frameRate,
        playbackPreviewSettings,
      );
      if (frameStepSeconds) {
        const rate = Math.min(
          4,
          Math.max(0.25, Number.isFinite(state.playbackRate) ? state.playbackRate : 1),
        );
        const minDeltaSeconds = frameStepSeconds / rate;
        if (pendingDeltaRef.current < minDeltaSeconds) {
          raf = requestAnimationFrame(tick);
          return;
        }
      }

      const deltaSeconds = pendingDeltaRef.current;
      pendingDeltaRef.current = 0;
      const result = advanceMotionPlayhead({
        currentTime: state.playhead,
        deltaSeconds,
        duration: composition.duration,
        playbackRate: state.playbackRate,
        loop: state.loopPlayback,
        frameStepSeconds,
        workAreaStart: state.workAreaStart,
        workAreaEnd: state.workAreaEnd,
      });

      state.setPlayhead(result.time);
      if (!result.isPlaying) {
        state.pause();
        lastTickRef.current = null;
        pendingDeltaRef.current = 0;
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [composition, isPlaying]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && key === "z") {
        event.preventDefault();
        const { undo, redo } = useProjectStore.getState();
        void (event.shiftKey ? redo() : undo());
        return;
      }

      if (commandKey && key === "y") {
        event.preventDefault();
        void useProjectStore.getState().redo();
        return;
      }

      if (commandKey && key === "a" && composition) {
        event.preventDefault();
        useMotionStore
          .getState()
          .setSelectedLayers(composition.layers.map((layer) => layer.id));
        return;
      }

      if (commandKey && key === "g" && composition) {
        const { selectedLayerIds, setSelectedLayers } = useMotionStore.getState();
        const projectState = useProjectStore.getState();
        // Read the freshly-committed composition so chained group ops don't
        // clobber each other via a stale closed-over prop.
        const live =
          projectState.project.motionCompositions?.find(
            (candidate) => candidate.id === composition.id,
          ) ?? composition;
        const upsert = projectState.upsertMotionComposition;
        if (event.shiftKey) {
          const groupIds = live.layers
            .filter(
              (layer) =>
                layer.type === "group" && selectedLayerIds.includes(layer.id),
            )
            .map((layer) => layer.id);
          if (groupIds.length === 0) return;
          event.preventDefault();
          const childIds = live.layers
            .filter((layer) => layer.parentId && groupIds.includes(layer.parentId))
            .map((layer) => layer.id);
          void upsert(ungroupMotionLayers(live, groupIds));
          setSelectedLayers(childIds);
        } else {
          if (selectedLayerIds.length === 0) return;
          const result = groupMotionLayers(live, selectedLayerIds, {
            name: "Group",
          });
          if (!result) return;
          event.preventDefault();
          void upsert(result.composition);
          setSelectedLayers([result.groupLayerId]);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        const { pause, selectLayer } = useMotionStore.getState();
        pause();
        selectLayer(null);
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
        return;
      }

      if (!composition) return;
      if (event.key === "Home") {
        event.preventDefault();
        const { workAreaStart, setPlayhead } = useMotionStore.getState();
        setPlayhead(workAreaStart ?? 0);
      } else if (event.key === "End") {
        event.preventDefault();
        const { workAreaEnd, setPlayhead } = useMotionStore.getState();
        setPlayhead(workAreaEnd ?? composition.duration);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composition, togglePlayback]);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}
