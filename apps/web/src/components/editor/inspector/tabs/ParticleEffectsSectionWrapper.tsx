import React from "react";
import { ParticleEffectsSection } from "../";
import {
  getParticleEngine,
  type ParticleEffect,
  type ParticleConfig,
} from "@openreel/core";

export const ParticleEffectsSectionWrapper: React.FC<{
  clipId: string;
  clipDuration: number;
  clipStartTime: number;
}> = ({ clipId, clipDuration, clipStartTime }) => {
  const [updateTrigger, setUpdateTrigger] = React.useState(0);
  const particleEngine = React.useMemo(() => getParticleEngine(), []);

  const effects = React.useMemo(() => {
    return particleEngine.getEffectsForClip(clipId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, particleEngine, updateTrigger]);

  const handleAddEffect = React.useCallback(
    (effect: ParticleEffect) => {
      particleEngine.addEffect(effect);
      setUpdateTrigger((v) => v + 1);
    },
    [particleEngine]
  );

  const handleUpdateEffect = React.useCallback(
    (effectId: string, config: Partial<ParticleConfig>) => {
      particleEngine.updateEffect(effectId, config);
      setUpdateTrigger((v) => v + 1);
    },
    [particleEngine]
  );

  const handleRemoveEffect = React.useCallback(
    (effectId: string) => {
      particleEngine.removeEffect(effectId);
      setUpdateTrigger((v) => v + 1);
    },
    [particleEngine]
  );

  const handleToggleEffect = React.useCallback(
    (effectId: string, enabled: boolean) => {
      particleEngine.toggleEffect(effectId, enabled);
      setUpdateTrigger((v) => v + 1);
    },
    [particleEngine]
  );

  const handleUpdateTiming = React.useCallback(
    (effectId: string, startTime: number, duration: number) => {
      particleEngine.updateEffectTiming(effectId, startTime, duration);
      setUpdateTrigger((v) => v + 1);
    },
    [particleEngine]
  );

  return (
    <ParticleEffectsSection
      clipId={clipId}
      clipDuration={clipDuration}
      clipStartTime={clipStartTime}
      effects={effects}
      onAddEffect={handleAddEffect}
      onUpdateEffect={handleUpdateEffect}
      onRemoveEffect={handleRemoveEffect}
      onToggleEffect={handleToggleEffect}
      onUpdateTiming={handleUpdateTiming}
    />
  );
};
