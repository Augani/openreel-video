import type { Project, ProjectSettings, MediaItem } from "./project";
import type { Timeline, Track, Clip, Subtitle } from "./timeline";

export interface Template {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: TemplateCategory;
  readonly thumbnailUrl: string | null;
  readonly previewUrl: string | null;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly settings: ProjectSettings;
  readonly timeline: TemplateTimeline;
  /** Saved project content beyond the timeline; absent on legacy templates. */
  readonly projectContent?: TemplateProjectContent;
  readonly placeholders: TemplatePlaceholder[];
  readonly tags: string[];
  readonly author?: string;
  readonly version: string;
}

export type TemplateProjectContent = Omit<
  Project,
  "id" | "name" | "createdAt" | "modifiedAt" | "settings" | "timeline"
>;

export type TemplateCategory =
  | "social-media"
  | "youtube"
  | "tiktok"
  | "instagram"
  | "business"
  | "personal"
  | "slideshow"
  | "intro-outro"
  | "lower-third"
  | "motion"
  | "custom";

export interface TemplateTimeline
  extends Omit<Timeline, "tracks" | "subtitles"> {
  readonly tracks: TemplateTrack[];
  readonly subtitles: TemplateSubtitle[];
  /** Earlier save dialogs stored graphics here without applying them. */
  readonly graphics?: {
    readonly shapes: NonNullable<Project["shapeClips"]>;
    readonly svgs: NonNullable<Project["svgClips"]>;
    readonly stickers: NonNullable<Project["stickerClips"]>;
  };
}

export interface TemplateTrack extends Omit<Track, "clips"> {
  readonly clips: TemplateClip[];
}

export interface TemplateClip extends Clip {
  readonly placeholderId?: string;
  readonly isPlaceholder: boolean;
}

export interface TemplateSubtitle extends Subtitle {
  readonly placeholderId?: string;
  readonly isPlaceholder: boolean;
}

export type PlaceholderType = "text" | "media" | "subtitle";

export interface TemplatePlaceholder {
  readonly id: string;
  readonly type: PlaceholderType;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
  readonly defaultValue?: string;
  readonly constraints?: PlaceholderConstraints;
}

export interface PlaceholderConstraints {
  readonly minDuration?: number;
  readonly maxDuration?: number;
  readonly aspectRatio?: number;
  readonly mediaTypes?: Array<"video" | "audio" | "image">;
  readonly maxLength?: number;
}

export interface TemplateReplacements {
  readonly [placeholderId: string]: PlaceholderReplacement;
}

export interface PlaceholderReplacement {
  readonly type: PlaceholderType;
  readonly value: string;
  readonly mediaBlob?: Blob;
  readonly media?: Pick<MediaItem, "name" | "type" | "metadata">;
}

export interface TemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly category: TemplateCategory;
  readonly thumbnailUrl: string | null;
  readonly placeholderCount: number;
  readonly duration: number;
}

export const TEMPLATE_CATEGORIES: Array<{
  id: TemplateCategory;
  name: string;
  icon: string;
}> = [
  { id: "social-media", name: "Social Media", icon: "share" },
  { id: "youtube", name: "YouTube", icon: "youtube" },
  { id: "tiktok", name: "TikTok", icon: "smartphone" },
  { id: "instagram", name: "Instagram", icon: "instagram" },
  { id: "business", name: "Business", icon: "briefcase" },
  { id: "personal", name: "Personal", icon: "user" },
  { id: "slideshow", name: "Slideshow", icon: "images" },
  { id: "intro-outro", name: "Intro/Outro", icon: "play" },
  { id: "lower-third", name: "Lower Third", icon: "subtitles" },
  { id: "motion", name: "Motion", icon: "sparkles" },
  { id: "custom", name: "Custom", icon: "folder" },
];
