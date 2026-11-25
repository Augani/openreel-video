import React from "react";
import {
  KeyframesSection,
  ClipTransitionSection,
  MotionPresetsPanel,
  EmphasisAnimationSection,
  TextAnimationSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { TextScrollSection } from "../TextScrollSection";
import { SavedStylesSection } from "../SavedStylesSection";
import { lazyWithRetry } from "../lazy-retry";

// gsap (~280 KB) is only needed once a clip's Motion Path section is shown.
const MotionPathSection = lazyWithRetry(() => import("../MotionPathSection").then((module) => ({ default: module.MotionPathSection })));

interface AnimateTabProps {
  clipId: string;
  clipType: string | null;
  showTextSection: boolean;
}

export const AnimateTab: React.FC<AnimateTabProps> = ({
  clipId,
  clipType,
  showTextSection,
}) => {
  return (
    <>
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
          <React.Suspense fallback={null}>
            <MotionPathSection clipId={clipId} />
          </React.Suspense>
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
      {showTextSection && (
        <InspectorSection title="Roll / Crawl" sectionId="text-scroll" defaultOpen={false}>
          <TextScrollSection clipId={clipId} />
        </InspectorSection>
      )}
      {showTextSection && (
        <InspectorSection title="Saved Styles" sectionId="text-saved-styles" defaultOpen={false}>
          <SavedStylesSection kind="text" targetId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
