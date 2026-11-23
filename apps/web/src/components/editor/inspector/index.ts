/**
 * Inspector Section Components
 *
 * Context-aware inspector sections for different clip types.
 */

// Video Effects
export { VideoEffectsSection } from "./VideoEffectsSection";
export { GreenScreenSection } from "./GreenScreenSection";
export { MaskSection } from "./MaskSection";
export { SpeedRampSection } from "./SpeedRampSection";
export { PiPSection } from "./PiPSection";
export { NoiseReductionSection } from "./NoiseReductionSection";
export { BackgroundRemovalSection } from "./BackgroundRemovalSection";
export { CropSection } from "./CropSection";
export { SpeedSection } from "./SpeedSection";
export { StabilizationSection } from "./StabilizationSection";

// Color Grading
export { ColorGradingSection } from "./ColorGradingSection";

// Text & Titles
export { TextSection } from "./TextSection";
export { TextAnimationSection } from "./TextAnimationSection";
export { AudioTextSyncPanel } from "./AudioTextSyncPanel";

// Graphics & Shapes
export { ShapeSection } from "./ShapeSection";
export { SVGSection } from "./SVGSection";
export { AlignmentSection } from "./AlignmentSection";

// Audio
export { AudioEffectsSection } from "./AudioEffectsSection";
export { RepairSection } from "./RepairSection";
export { AudioDuckingSection } from "./AudioDuckingSection";
export { AutoCutSilenceSection } from "./AutoCutSilenceSection";

// Transitions & Keyframes
export { ClipTransitionSection } from "./ClipTransitionSection";
export { KeyframesSection } from "./KeyframesSection";
export { BlendingSection } from "./BlendingSection";
export { Transform3DSection } from "./Transform3DSection";

// Motion Presets
export { MotionPresetsPanel } from "./MotionPresetsPanel";

// Motion Paths
// MotionPathSection is not re-exported: it pulls gsap (~280 KB), so AnimateTab loads it lazily.

// Emphasis Animation
export { EmphasisAnimationSection } from "./EmphasisAnimationSection";

// Advanced Features
export { MotionTrackingSection } from "./MotionTrackingSection";
export { PlanarTrackingSection } from "./PlanarTrackingSection";
export { NestedSequenceSection } from "./NestedSequenceSection";
export { AdjustmentLayerSection } from "./AdjustmentLayerSection";
export { AutoReframeSection } from "./AutoReframeSection";

// Text Behind Subject
export { BehindSubjectSection } from "./BehindSubjectSection";

export { EssentialSoundSection } from "./EssentialSoundSection";
