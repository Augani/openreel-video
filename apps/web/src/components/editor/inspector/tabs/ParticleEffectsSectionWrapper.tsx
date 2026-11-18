import React, { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { getParticleOwner, type ParticleConfig } from "@openreel/core";
import { ParticleEffectsSection } from "../ParticleEffectsSection";
import { useProjectStore } from "../../../../stores/project-store";
import { useUIStore } from "../../../../stores/ui-store";
import { useTimelineStore } from "../../../../stores/timeline-store";
import { editClipParticles } from "../../../../services/clip-particles";
import { trackEditorDraftWrite } from "../../../../services/editor-field-drafts";
import { toast } from "../../../../stores/notification-store";
export const ParticleEffectsSectionWrapper: React.FC<{
  clipId: string;
  clipDuration: number;
  clipStartTime: number;
}> = ({ clipId }) => {
  const frameRate = useProjectStore(
    (state) => state.project.settings.frameRate,
  );
  const clip = useProjectStore((state) =>
    getParticleOwner(state.project, clipId),
  );
  const projectId = useProjectStore((state) => state.project.id),
    history = useProjectStore((state) => state.actionHistory);
  const rawEffects = useProjectStore(
    useShallow((state) =>
      (state.project.particleEffects ?? []).filter(
        (effect) => effect.clipId === clipId,
      ),
    ),
  );
  const effects = useMemo(
    () =>
      rawEffects.map((effect) => ({
        ...effect,
        startTime:
          (clip?.startTime ?? 0) +
          effect.startTime -
          (effect.clipStartTime ?? clip?.startTime ?? 0),
      })),
    [rawEffects, clip?.startTime],
  );
  const locked = useProjectStore(
    (state) =>
      !state.project.timeline.tracks.some(
        (track) =>
          !track.locked &&
          track.id === getParticleOwner(state.project, clipId)?.trackId,
      ),
  );
  const exporting = useUIStore(
    (state) =>
      state.exportState.isExporting || state.effectApplicationClipId !== null,
  );
  const processing = useTimelineStore((state) =>
    Boolean(state.playbackLockedReason),
  );
  if (!clip) return null;
  const scope = { projectId, clipId, history };
  const run = (update: Parameters<typeof editClipParticles>[1]) => {
    const operation = trackEditorDraftWrite(
      editClipParticles(scope, update),
      scope,
    );
    void operation.catch((error) =>
      toast.error(
        "Particle edit failed",
        error instanceof Error ? error.message : "Try the change again.",
      ),
    );
    return operation;
  };
  const config = (
    id: string,
    change:
      | Partial<ParticleConfig>
      | ((current: ParticleConfig) => Partial<ParticleConfig>),
  ) =>
    run((current) =>
      current.map((effect) => {
        if (effect.id !== id) return effect;
        const next = {
          ...effect.config,
          ...(typeof change === "function" ? change(effect.config) : change),
        };
        return JSON.stringify(next) === JSON.stringify(effect.config)
          ? effect
          : { ...effect, config: next };
      }),
    );
  return (
    <ParticleEffectsSection
      key={`${projectId}:${clipId}`}
      clipId={clipId}
      clipDuration={clip.duration}
      clipStartTime={clip.startTime}
      frameRate={frameRate}
      effects={effects}
      disabled={locked || exporting || processing}
      onAddEffect={(effect) =>
        run((current, project) => {
          const owner = getParticleOwner(project, clipId)!;
          return [...current, { ...effect, clipStartTime: owner.startTime }];
        })
      }
      onUpdateEffect={config}
      onRemoveEffect={(id) =>
        run((current) => current.filter((effect) => effect.id !== id))
      }
      onToggleEffect={(id) =>
        run((current) =>
          current.map((effect) =>
            effect.id === id ? { ...effect, enabled: !effect.enabled } : effect,
          ),
        )
      }
      onUpdateTiming={(id, startTime, duration) =>
        run((current, project) => {
          const owner = getParticleOwner(project, clipId)!;
          if (
            !Number.isFinite(startTime) ||
            !Number.isFinite(duration) ||
            duration <= 0 ||
            startTime < owner.startTime ||
            startTime + duration > owner.startTime + owner.duration + 1e-9
          )
            return current;
          return current.map((effect) =>
            effect.id === id
              ? {
                  ...effect,
                  startTime,
                  duration,
                  clipStartTime: owner.startTime,
                }
              : effect,
          );
        })
      }
    />
  );
};
