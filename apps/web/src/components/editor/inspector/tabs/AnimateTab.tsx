import React from "react";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Box, ExternalLink } from "@/icons/lucide-compat";
import {
  KeyframesSection,
  ClipTransitionSection,
  MotionPresetsPanel,
  MotionPathSection,
  EmphasisAnimationSection,
  TextAnimationSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { useRouter } from "../../../../hooks/use-router";
import { useProjectStore } from "../../../../stores/project-store";

export interface AnimateTabProps {
  clipId: string;
  clipType: string | null;
  showTextSection: boolean;
}

export const AnimateTab: React.FC<AnimateTabProps> = ({
  clipId,
  clipType,
  showTextSection,
}) => {
  const { navigate } = useRouter();
  const motionCompositionId = useProjectStore((state) => {
    const clip = state.project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((candidate) => candidate.id === clipId);
    return typeof clip?.metadata?.motionCompositionId === "string"
      ? clip.metadata.motionCompositionId
      : null;
  });
  const motionComposition = useProjectStore((state) =>
    motionCompositionId
      ? (state.project.motionCompositions ?? []).find(
          (composition) => composition.id === motionCompositionId,
        )
      : undefined,
  );

  return (
    <>
      {motionCompositionId && motionComposition && (
        <InspectorSection title="Motion Scene" sectionId="motion-scene">
          <ClickableCard
            label={`Open ${motionComposition.name} motion scene`}
            className="flex w-full items-center justify-between rounded-md border border-border bg-bg-2 px-3 py-2 text-left text-sm text-fg hover:bg-hover"
            onClick={() =>
              navigate("motion", { compositionId: motionCompositionId })
            }
          >
            <Text as="span" type="body" className="flex min-w-0 items-center gap-2">
              <Box size={16} className="text-accent" />
              <Text as="span" type="body" className="truncate">
                {motionComposition.name}
              </Text>
            </Text>
            <ExternalLink size={14} className="text-fg-3" />
          </ClickableCard>
        </InspectorSection>
      )}
      <InspectorSection title="Keyframes" sectionId="keyframes">
        <KeyframesSection clipId={clipId} />
      </InspectorSection>
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title="Transitions"
          sectionId="transitions"
          defaultOpen={false}
        >
          <ClipTransitionSection clipId={clipId} />
        </InspectorSection>
      )}
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title="Motion Presets"
          sectionId="motion-presets"
          defaultOpen={false}
        >
          <MotionPresetsPanel clipId={clipId} />
        </InspectorSection>
      )}
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title="Motion Path"
          sectionId="motion-path"
          defaultOpen={false}
        >
          <MotionPathSection clipId={clipId} />
        </InspectorSection>
      )}
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title="Emphasis Animation"
          sectionId="emphasis-animation"
          defaultOpen={false}
        >
          <EmphasisAnimationSection clipId={clipId} />
        </InspectorSection>
      )}
      {showTextSection && (
        <InspectorSection
          title="Text Animation"
          sectionId="text-animation"
          defaultOpen={false}
        >
          <TextAnimationSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
