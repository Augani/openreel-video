type InspectorTabId =
  | "transform"
  | "color"
  | "effects"
  | "audio"
  | "speed"
  | "animate"
  | "ai"
  | "style";

export type InspectorClipType =
  | "video"
  | "image"
  | "audio"
  | "text"
  | "shape"
  | "svg"
  | "sticker";

const TABS_BY_CLIP_TYPE: Record<InspectorClipType, InspectorTabId[]> = {
  video: ["transform", "color", "effects", "audio", "speed", "animate", "ai"],
  image: ["transform", "color", "effects", "speed", "animate", "ai"],
  audio: ["audio", "speed", "ai"],
  text: ["transform", "style", "effects", "animate"],
  shape: ["transform", "style", "effects", "animate"],
  svg: ["transform", "style", "effects", "animate"],
  sticker: ["transform", "effects", "animate"],
};

export function getTabIdsForClipType(
  clipType: InspectorClipType | null,
): InspectorTabId[] {
  if (!clipType) return [];
  return TABS_BY_CLIP_TYPE[clipType];
}

interface InspectorTabOption {
  value: InspectorTabId;
  label: string;
}

/** Keep the authored media/text tabs while presenting only real graphic panels. */
const PRESENTED_TABS: Record<InspectorClipType, readonly InspectorTabOption[]> = {
  video: [{ value: "transform", label: "Video" }, { value: "audio", label: "Audio" }, { value: "speed", label: "Speed" }, { value: "color", label: "Color" }, { value: "ai", label: "AI" }],
  image: [{ value: "transform", label: "Image" }, { value: "speed", label: "Speed" }, { value: "color", label: "Color" }, { value: "ai", label: "AI" }],
  audio: [{ value: "audio", label: "Audio" }, { value: "speed", label: "Speed" }, { value: "ai", label: "AI" }],
  text: [{ value: "style", label: "Text" }, { value: "animate", label: "Animation" }, { value: "transform", label: "Transform" }],
  shape: [{ value: "style", label: "Shape" }, { value: "animate", label: "Animation" }, { value: "transform", label: "Transform" }, { value: "effects", label: "Effects" }],
  svg: [{ value: "style", label: "SVG" }, { value: "animate", label: "Animation" }, { value: "transform", label: "Transform" }, { value: "effects", label: "Effects" }],
  sticker: [{ value: "transform", label: "Transform" }, { value: "animate", label: "Animation" }, { value: "effects", label: "Effects" }],
};

export const ANIMATION_SECTION_IDS = ["keyframes", "transitions", "motion-presets", "motion-path", "emphasis-animation", "text-animation", "animation"] as const;
export const EFFECT_SECTION_IDS = ["effects-overview", "applied-effects", "video-effects", "motion-tracking", "background-removal", "particle-effects", "chroma-key", "green-screen", "pip", "masking", "text-behind-subject"] as const;

export function getInspectorTabOptions(type: InspectorClipType | null): readonly InspectorTabOption[] {
  return type ? PRESENTED_TABS[type] : [];
}

export function getInspectorTabForSection(type: InspectorClipType | null, section: string): InspectorTabId | null {
  if (!type) return null;
  if ((section === "shape-properties" && type !== "shape") || (section === "svg-properties" && type !== "svg")
    || (["text-properties", "text-materials", "text-animation"].includes(section) && type !== "text")) return null;
  const options = getInspectorTabOptions(type);
  let tab: InspectorTabId = "transform";
  if (["text-properties", "text-materials", "shape-properties", "svg-properties"].includes(section)) tab = "style";
  else if (["color-grading", "primary-color", "hsl-secondary", "comparison-view"].includes(section)) tab = "color";
  else if (["auto-captions", "editable-captions", "audio-text-sync", "ai-enhancement", "multicam", "auto-reframe", "auto-edit", "ai-highlights"].includes(section)) tab = "ai";
  else if (["advanced-audio", "clip-audio", "audio-effects", "noise-reduction", "background-noise-removal", "auto-cut-silence", "audio-ducking", "beat-sync", "voice-over"].includes(section)) tab = "audio";
  else if (section.includes("speed") || section === "stabilization") tab = "speed";
  else if ((ANIMATION_SECTION_IDS as readonly string[]).includes(section)) tab = type === "video" || type === "image" ? "transform" : "animate";
  else if ((EFFECT_SECTION_IDS as readonly string[]).includes(section)) tab = options.some(option => option.value === "effects") ? "effects" : "transform";
  return options.some(option => option.value === tab) ? tab : null;
}
