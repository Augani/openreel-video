import type { ProjectSettings } from "./project";
import type { Timeline } from "./timeline";
import type {
  TemplateCategory,
  TemplateProjectContent,
  PlaceholderReplacement,
  TemplatePlaceholder,
  PlaceholderConstraints,
} from "./template";

export type ExtendedPlaceholderType =
  | "text"
  | "media"
  | "subtitle"
  | "shape"
  | "effect"
  | "transform"
  | "keyframe"
  | "color"
  | "number"
  | "boolean"
  | "audio"
  | "style"
  | "font"
  | "animation";

export interface PlaceholderTarget {
  readonly clipId?: string;
  readonly trackId?: string;
  readonly effectId?: string;
  readonly keyframeId?: string;
  readonly property: string;
}

export interface PlaceholderUIHints {
  readonly inputType:
    | "text"
    | "textarea"
    | "slider"
    | "color"
    | "select"
    | "toggle"
    | "media-picker"
    | "font-picker"
    | "animation-picker";
  readonly group?: string;
  readonly order?: number;
  readonly advanced?: boolean;
  readonly previewable?: boolean;
  readonly options?: Array<{ value: string; label: string }>;
}

export interface ExtendedPlaceholderConstraints extends PlaceholderConstraints {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly pattern?: string;
  readonly allowedValues?: string[];
  readonly allowedFonts?: string[];
  readonly allowedAnimations?: string[];
}

export interface ExtendedPlaceholder {
  readonly id: string;
  readonly type: ExtendedPlaceholderType;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
  readonly defaultValue: unknown;
  readonly targets: PlaceholderTarget[];
  readonly constraints?: ExtendedPlaceholderConstraints;
  readonly uiHints?: PlaceholderUIHints;
}

export type SocialMediaCategory =
  | "tiktok"
  | "instagram-reels"
  | "instagram-stories"
  | "instagram-post"
  | "youtube-shorts"
  | "youtube-video"
  | "facebook"
  | "twitter"
  | "linkedin"
  | "pinterest"
  | "intro"
  | "outro"
  | "promo"
  | "lower-third"
  | "slideshow"
  | "custom";

interface SocialMediaPreset {
  readonly width: number;
  readonly height: number;
  readonly frameRate?: number;
  readonly maxDuration?: number;
  readonly recommendedDuration?: number;
  readonly safeZone?: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
}

export const SOCIAL_MEDIA_PRESETS: Record<
  SocialMediaCategory,
  SocialMediaPreset
> = {
  tiktok: {
    width: 1080,
    height: 1920,
    frameRate: 30,
    maxDuration: 180,
    recommendedDuration: 15,
    safeZone: { top: 150, bottom: 300, left: 40, right: 40 },
  },
  "instagram-reels": {
    width: 1080,
    height: 1920,
    frameRate: 30,
    maxDuration: 90,
    recommendedDuration: 30,
    safeZone: { top: 200, bottom: 280, left: 40, right: 40 },
  },
  "instagram-stories": {
    width: 1080,
    height: 1920,
    frameRate: 30,
    maxDuration: 15,
    recommendedDuration: 10,
    safeZone: { top: 200, bottom: 200, left: 40, right: 40 },
  },
  "instagram-post": {
    width: 1080,
    height: 1080,
    frameRate: 30,
    maxDuration: 60,
    recommendedDuration: 30,
  },
  "youtube-shorts": {
    width: 1080,
    height: 1920,
    frameRate: 30,
    maxDuration: 60,
    recommendedDuration: 30,
    safeZone: { top: 100, bottom: 200, left: 40, right: 40 },
  },
  "youtube-video": {
    width: 1920,
    height: 1080,
    frameRate: 30,
  },
  facebook: {
    width: 1080,
    height: 1080,
    frameRate: 30,
    maxDuration: 240,
    recommendedDuration: 60,
  },
  twitter: {
    width: 1280,
    height: 720,
    frameRate: 30,
    maxDuration: 140,
    recommendedDuration: 45,
  },
  linkedin: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxDuration: 600,
    recommendedDuration: 90,
  },
  pinterest: {
    width: 1000,
    height: 1500,
    frameRate: 30,
    maxDuration: 60,
    recommendedDuration: 15,
  },
  intro: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    recommendedDuration: 5,
  },
  outro: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    recommendedDuration: 10,
  },
  promo: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    recommendedDuration: 30,
  },
  "lower-third": {
    width: 1920,
    height: 1080,
    frameRate: 30,
    recommendedDuration: 5,
  },
  slideshow: {
    width: 1920,
    height: 1080,
    frameRate: 30,
  },
  custom: {
    width: 1920,
    height: 1080,
    frameRate: 30,
  },
};

export interface TemplateScene {
  readonly id: string;
  readonly label: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly color?: string;
}

export interface ScriptableTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: TemplateCategory;
  readonly socialCategory?: SocialMediaCategory;
  readonly thumbnailUrl: string | null;
  readonly previewUrl: string | null;
  readonly previewVideoUrl?: string | null;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly settings: ProjectSettings;
  readonly timeline: Timeline;
  readonly projectContent?: TemplateProjectContent;
  readonly placeholders: ExtendedPlaceholder[];
  readonly scenes?: TemplateScene[];
  readonly tags: string[];
  readonly author?: string;
  readonly version: string;
  readonly featured?: boolean;
  readonly premium?: boolean;
}

export interface ExtendedPlaceholderReplacement {
  readonly type: ExtendedPlaceholderType;
  readonly value: unknown;
  readonly mediaBlob?: Blob;
  readonly media?: PlaceholderReplacement["media"];
}

export interface ScriptableTemplateReplacements {
  readonly [placeholderId: string]: ExtendedPlaceholderReplacement;
}

export interface TemplateValidationError {
  readonly placeholderId: string;
  readonly message: string;
  readonly type: "missing" | "invalid" | "constraint";
}

export interface TemplateApplicationResult {
  readonly success: boolean;
  readonly errors: TemplateValidationError[];
  readonly warnings: string[];
}

export function isExtendedPlaceholder(
  placeholder: TemplatePlaceholder | ExtendedPlaceholder,
): placeholder is ExtendedPlaceholder {
  return (
    "targets" in placeholder &&
    Array.isArray((placeholder as ExtendedPlaceholder).targets)
  );
}

export function createProjectSettingsFromPreset(
  preset: SocialMediaPreset,
): ProjectSettings {
  return {
    width: preset.width,
    height: preset.height,
    frameRate: preset.frameRate || 30,
    sampleRate: 48000,
    channels: 2,
  };
}

export const SOCIAL_MEDIA_CATEGORY_INFO: Array<{
  id: SocialMediaCategory;
  name: string;
  icon: string;
  platform: string;
}> = [
  { id: "tiktok", name: "TikTok", icon: "smartphone", platform: "TikTok" },
  { id: "instagram-reels", name: "Reels", icon: "film", platform: "Instagram" },
  {
    id: "instagram-stories",
    name: "Stories",
    icon: "clock",
    platform: "Instagram",
  },
  { id: "instagram-post", name: "Post", icon: "square", platform: "Instagram" },
  {
    id: "youtube-shorts",
    name: "Shorts",
    icon: "smartphone",
    platform: "YouTube",
  },
  { id: "youtube-video", name: "Video", icon: "monitor", platform: "YouTube" },
  { id: "facebook", name: "Facebook", icon: "users", platform: "Facebook" },
  { id: "twitter", name: "Twitter/X", icon: "at-sign", platform: "Twitter" },
  { id: "linkedin", name: "LinkedIn", icon: "briefcase", platform: "LinkedIn" },
  {
    id: "pinterest",
    name: "Pinterest",
    icon: "bookmark",
    platform: "Pinterest",
  },
  { id: "intro", name: "Intro", icon: "play", platform: "General" },
  { id: "outro", name: "Outro", icon: "square", platform: "General" },
  { id: "promo", name: "Promo", icon: "megaphone", platform: "General" },
  { id: "lower-third", name: "Lower Third", icon: "type", platform: "General" },
  { id: "slideshow", name: "Slideshow", icon: "images", platform: "General" },
  { id: "custom", name: "Custom", icon: "settings", platform: "Custom" },
];
