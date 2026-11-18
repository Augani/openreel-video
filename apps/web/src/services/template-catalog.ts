import type {
  ScriptableTemplate,
  SocialMediaCategory,
  Template,
  TemplateSummary,
} from "@openreel/core";
import {
  isExtendedPlaceholder,
  SOCIAL_MEDIA_CATEGORY_INFO,
} from "@openreel/core";

export interface TemplateCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  socialCategory: SocialMediaCategory;
  thumbnailUrl: string | null;
  previewVideoUrl?: string | null;
  featured?: boolean;
  premium?: boolean;
  tags: string[];
  duration: number;
  placeholderCount: number;
  source: "builtin" | "local" | "cloud";
  template?: ScriptableTemplate;
}

function socialCategoryForTemplate(
  category: string,
): SocialMediaCategory {
  const categories: Record<string, SocialMediaCategory> = {
    "social-media": "tiktok",
    youtube: "youtube-video",
    tiktok: "tiktok",
    instagram: "instagram-reels",
    business: "promo",
    personal: "custom",
    slideshow: "slideshow",
    "intro-outro": "intro",
    "lower-third": "lower-third",
    custom: "custom",
  };
  return categories[category] ?? "custom";
}

/** Retain every legacy target, including repeated words and saved captions. */
export function toScriptableTemplate(template: Template): ScriptableTemplate {
  const category =
    "socialCategory" in template &&
    SOCIAL_MEDIA_CATEGORY_INFO.some(
      (info) => info.id === template.socialCategory,
    )
      ? (template.socialCategory as SocialMediaCategory)
      : socialCategoryForTemplate(template.category);
  return {
    ...template,
    socialCategory: category,
    placeholders: template.placeholders.map((field) =>
      isExtendedPlaceholder(field)
        ? field
        : {
            ...field,
            defaultValue: field.defaultValue,
            targets:
              field.type === "subtitle"
                ? template.timeline.subtitles
                    .filter(
                      (caption) =>
                        caption.isPlaceholder &&
                        caption.placeholderId === field.id,
                    )
                    .map((caption) => ({
                      clipId: caption.id,
                      property: "text",
                    }))
                : template.timeline.tracks.flatMap((track) =>
                    track.clips
                      .filter(
                        (clip) =>
                          clip.isPlaceholder && clip.placeholderId === field.id,
                      )
                      .map((clip) => ({
                        clipId: clip.id,
                        trackId: track.id,
                        property:
                          field.type === "media" ? "mediaId" : "content",
                      })),
                  ),
          },
    ),
  };
}

export function catalogFromTemplate(
  template: ScriptableTemplate,
  source: TemplateCatalogEntry["source"],
): TemplateCatalogEntry {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    socialCategory: SOCIAL_MEDIA_CATEGORY_INFO.some(
      (info) => info.id === template.socialCategory,
    )
      ? template.socialCategory!
      : socialCategoryForTemplate(template.category),
    thumbnailUrl: template.thumbnailUrl,
    previewVideoUrl: template.previewVideoUrl,
    featured: template.featured,
    premium: template.premium,
    tags: template.tags,
    duration: template.timeline.duration,
    placeholderCount: template.placeholders.length,
    source,
    template,
  };
}

export function catalogFromSummary(
  summary: TemplateSummary,
): TemplateCatalogEntry {
  return {
    ...summary,
    description: "",
    tags: [],
    socialCategory: socialCategoryForTemplate(summary.category),
    source: "local",
  };
}

/** Local originals win a duplicate ID; display data never requires loading every media Blob. */
export function mergeTemplateCatalog(
  current: TemplateCatalogEntry[],
  incoming: TemplateCatalogEntry[],
): TemplateCatalogEntry[] {
  const priority = { builtin: 0, cloud: 1, local: 2 },
    entries = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    const before = entries.get(entry.id);
    if (!before || priority[entry.source] >= priority[before.source])
      entries.set(entry.id, entry);
  }
  return [...entries.values()];
}
