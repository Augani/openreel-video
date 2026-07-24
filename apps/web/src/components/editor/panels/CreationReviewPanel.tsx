import React, { useMemo } from "react";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { Boxes, AlertTriangle, CheckCircle2, Info, X } from "@/icons/lucide-compat";
import type { MotionComposition } from "@openreel/core/motion/types";
import { useProjectStore } from "../../../stores/project-store";
import {
  reviewCreationState,
  type CreationIssueSeverity,
  type CreationSceneReview,
} from "./creation-review";

interface CreationReviewPanelProps {
  onClose?: () => void;
}

const EMPTY_MOTION_COMPOSITIONS: readonly MotionComposition[] = [];

const SEVERITY_ICON: Record<CreationIssueSeverity, React.ReactNode> = {
  error: <AlertTriangle className="h-3.5 w-3.5 text-red-400" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />,
  info: <Info className="h-3.5 w-3.5 text-sky-400" />,
};

const SceneCard: React.FC<{ scene: CreationSceneReview; active: boolean }> = ({
  scene,
  active,
}) => (
  <div
    className={`rounded-lg border p-3 ${
      active ? "border-sky-500/50 bg-sky-500/5" : "border-white/10 bg-white/5"
    }`}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Boxes className="h-4 w-4 text-white/70" />
        <span className="text-sm font-medium text-white/90">{scene.name}</span>
      </div>
      {scene.ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-red-400" />
      )}
    </div>
    <div className="mt-1 text-xs text-white/50">
      {scene.objectCount} object(s) · {scene.cameraCount} camera(s) · {scene.animationCount}{" "}
      animation(s)
    </div>
    {scene.issues.length > 0 && (
      <ul className="mt-2 space-y-1">
        {scene.issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`} className="flex items-center gap-2 text-xs text-white/70">
            {SEVERITY_ICON[issue.severity]}
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

export const CreationReviewPanel: React.FC<CreationReviewPanelProps> = ({ onClose }) => {
  const creation = useProjectStore((state) => state.project.creation);
  const motionCompositions = useProjectStore(
    (state) => state.project.motionCompositions ?? EMPTY_MOTION_COMPOSITIONS,
  );
  const review = useMemo(
    () => reviewCreationState(creation, motionCompositions),
    [creation, motionCompositions],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-white/80" />
          <span className="text-sm font-semibold text-white/90">Creation Review</span>
        </div>
        {onClose && (
          <IconButton
            label="Close creation review"
            icon={<X className="h-4 w-4" aria-hidden />}
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
          />
        )}
      </div>

      {!review.available ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-white/50">
          No agent-created 3D scenes yet. Use the creation tools to build a product, character, or
          scene.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 text-xs text-white/50">
            {review.assetCount} asset(s) · {review.sceneCount} scene(s)
          </div>
          <div className="space-y-2">
            {review.scenes.map((scene) => (
              <SceneCard
                key={scene.sceneId}
                scene={scene}
                active={scene.sceneId === review.activeSceneId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
