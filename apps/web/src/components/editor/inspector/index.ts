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

// Color Grading
export { ColorGradingSection } from "./ColorGradingSection";
export {
  ColorWheelsControl,
  DEFAULT_COLOR_WHEEL_VALUES,
} from "./ColorWheelsControl";
export { CurvesEditor, DEFAULT_CURVES } from "./CurvesEditor";
export { LUTLoader } from "./LUTLoader";
export { HSLControls, DEFAULT_HSL_VALUES } from "./HSLControls";
export { ScopesPanel } from "./ScopesPanel";
export type { ScopeViewType } from "./ScopesPanel";
export { FilterPresetsPanel } from "./FilterPresetsPanel";

// Text & Titles
export { TextSection } from "./TextSection";
export { TextAnimationSection } from "./TextAnimationSection";
export { AutoCaptionPanel } from "./AutoCaptionPanel";

// Graphics & Shapes
export { ShapeSection } from "./ShapeSection";
export { SVGSection } from "./SVGSection";
export { SVGImporter } from "./SVGImporter";
export { StickerPicker } from "./StickerPicker";
export { StickerPickerPanel } from "./StickerPickerPanel";

// Audio
export { AudioEffectsSection } from "./AudioEffectsSection";
export { AudioDuckingSection } from "./AudioDuckingSection";
export { AutoCutSilenceSection } from "./AutoCutSilenceSection";
export { MusicLibraryPanel } from "./MusicLibraryPanel";
export { TextToSpeechPanel } from "./TextToSpeechPanel";

// Transitions & Keyframes
export { TransitionInspector } from "./TransitionInspector";
export { ClipTransitionSection } from "./ClipTransitionSection";
export { KeyframesSection } from "./KeyframesSection";
export { BlendingSection } from "./BlendingSection";
export { Transform3DSection } from "./Transform3DSection";

// Motion Presets
export { MotionPresetsPanel } from "./MotionPresetsPanel";

// Motion Paths
export { MotionPathSection } from "./MotionPathSection";

// Emphasis Animation
export { EmphasisAnimationSection } from "./EmphasisAnimationSection";

// Beat Sync
export { BeatSyncSection } from "./BeatSyncSection";

// Advanced Features
export { MotionTrackingSection } from "./MotionTrackingSection";
export { NestedSequenceSection } from "./NestedSequenceSection";
export { AdjustmentLayerSection } from "./AdjustmentLayerSection";
export { MultiCameraPanel } from "./MultiCameraPanel";
export { AutoReframeSection } from "./AutoReframeSection";

// Photo Editing
export { PhotoLayersSection } from "./PhotoLayersSection";
export { RetouchingSection } from "./RetouchingSection";

// Templates & History
export { TemplatesBrowserPanel } from "./TemplatesBrowserPanel";
export { TemplateVariablesPanel } from "./TemplateVariablesPanel";
export { HistoryPanel } from "./HistoryPanel";

// Markers & Scenes
export { MarkersPanel } from "./MarkersPanel";
export { SceneNavigatorPanel } from "./SceneNavigatorPanel";

// Particle Effects
export { ParticleEffectsSection } from "./ParticleEffectsSection";
