import { useEffect, useRef } from "react";
import { useRouter } from "../hooks/use-router";
import { useProjectStore } from "../stores/project-store";
import {
  resolveMotionCreatorCompositionId,
  resolveMotionCreatorPreviewTime,
} from "./composition-selection";
import { MotionCreatorShell } from "./MotionCreatorShell";
import { useMotionPlayback } from "./hooks/use-motion-playback";
import { useMotionAudioPlayback } from "./hooks/use-motion-audio-playback";
import { useMotionStore } from "./stores/motion-store";

interface MotionCreatorAppProps {
  embedded?: boolean;
}

export function MotionCreatorApp({ embedded = false }: MotionCreatorAppProps) {
  const { params } = useRouter();
  const hasOpenProject = useProjectStore((state) => state.hasOpenProject);
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const createMotionComposition = useProjectStore(
    (state) => state.createMotionComposition,
  );
  const project = useProjectStore((state) => state.project);
  const compositions = useProjectStore(
    (state) => state.project.motionCompositions ?? [],
  );
  const activeCompositionId = useMotionStore(
    (state) => state.activeCompositionId,
  );
  const setActiveCompositionId = useMotionStore(
    (state) => state.setActiveCompositionId,
  );
  const setPlayhead = useMotionStore((state) => state.setPlayhead);
  const creatingRef = useRef(false);

  useEffect(() => {
    if (!hasOpenProject) {
      createNewProject("New Motion Project");
    }
  }, [createNewProject, hasOpenProject]);

  useEffect(() => {
    if (
      params.compositionId &&
      params.compositionId !== activeCompositionId &&
      compositions.some((item) => item.id === params.compositionId)
    ) {
      setActiveCompositionId(params.compositionId);
      setPlayhead(0.6);
    }
  }, [
    activeCompositionId,
    compositions,
    params.compositionId,
    setActiveCompositionId,
    setPlayhead,
  ]);

  useEffect(() => {
    if (!hasOpenProject || compositions.length > 0 || creatingRef.current) {
      return;
    }
    creatingRef.current = true;
    void createMotionComposition("Motion Scene").then((composition) => {
      if (composition) {
        setActiveCompositionId(composition.id);
        setPlayhead(Math.min(0.6, composition.duration / 2));
      }
      creatingRef.current = false;
    });
  }, [
    compositions.length,
    createMotionComposition,
    hasOpenProject,
    setActiveCompositionId,
    setPlayhead,
  ]);

  useEffect(() => {
    const resolvedId = resolveMotionCreatorCompositionId({
      project,
      compositions,
      activeCompositionId,
      routeCompositionId: params.compositionId,
    });
    if (!resolvedId || resolvedId === activeCompositionId) return;
    const resolvedComposition = compositions.find((item) => item.id === resolvedId);
    setActiveCompositionId(resolvedId);
    setPlayhead(
      resolvedComposition ? resolveMotionCreatorPreviewTime(resolvedComposition) : 0.6,
    );
  }, [
    activeCompositionId,
    compositions,
    params.compositionId,
    project,
    setActiveCompositionId,
    setPlayhead,
  ]);

  const composition =
    compositions.find((item) => item.id === activeCompositionId) ??
    compositions[0] ??
    null;
  useMotionPlayback(composition);
  useMotionAudioPlayback(composition);

  if (!composition) {
    return (
      <div
        className={`flex ${embedded ? "h-full w-full" : "h-screen w-screen"} items-center justify-center bg-[#0c0f14] text-sm text-white/60`}
      >
        Preparing Motion Creator...
      </div>
    );
  }

  return <MotionCreatorShell composition={composition} embedded={embedded} />;
}
