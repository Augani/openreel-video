import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Search, Loader2, Layers } from "lucide-react";
import { Input } from "@openreel/ui";
import { useEngineStore } from "../../stores/engine-store";
import {
  SOCIAL_MEDIA_CATEGORY_INFO,
  type SocialMediaCategory,
  type ScriptableTemplate,
  type Clip,
} from "@openreel/core";
import { templateCloudService } from "../../services/template-cloud-service";
import { CategoryTabs } from "./CategoryTabs";
import { TemplateCard } from "./TemplateCard";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

interface PlaceholderClip extends Clip {
  isPlaceholder?: boolean;
  placeholderId?: string;
}

interface TemplateGalleryProps {
  onTemplateApplied?: () => void;
}

export const TemplateGallery: React.FC<TemplateGalleryProps> = ({
  onTemplateApplied,
}) => {
  const getTemplateEngine = useEngineStore((state) => state.getTemplateEngine);

  const [templates, setTemplates] = useState<ScriptableTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    SocialMediaCategory | "all"
  >("all");
  const [selectedTemplate, setSelectedTemplate] =
    useState<ScriptableTemplate | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    const loadTemplates = async () => {
      setIsLoading(true);
      try {
        const templateEngine = await getTemplateEngine();
        await templateEngine.initialize();
        const builtinTemplates = templateEngine.getBuiltinTemplates();
        const cloudTemplates =
          await templateCloudService.listScriptableTemplates();

        const allTemplates = [
          ...(builtinTemplates.map((t) => {
            const placeholderClipMap = new Map<
              string,
              { clipId: string; trackId: string }
            >();
            for (const track of t.timeline.tracks) {
              for (const clip of track.clips) {
                const pClip = clip as PlaceholderClip;
                if (pClip.isPlaceholder && pClip.placeholderId) {
                  placeholderClipMap.set(pClip.placeholderId, {
                    clipId: clip.id,
                    trackId: track.id,
                  });
                }
              }
            }

            return {
              ...t,
              placeholders: t.placeholders.map((p) => {
                const clipInfo = placeholderClipMap.get(p.id);
                return {
                  ...p,
                  targets: clipInfo
                    ? [
                        {
                          clipId: clipInfo.clipId,
                          trackId: clipInfo.trackId,
                          property: "content",
                        },
                      ]
                    : [],
                  defaultValue: p.defaultValue as unknown,
                };
              }),
              socialCategory: mapCategoryToSocial(t.category),
            };
          }) as ScriptableTemplate[]),
          ...cloudTemplates,
        ];

        const unique = Array.from(
          new Map(allTemplates.map((t) => [t.id, t])).values(),
        );

        setTemplates(unique);
      } catch (error) {
        console.error("Failed to load templates:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadTemplates();
  }, [getTemplateEngine]);

  const filteredTemplates = useMemo(() => {
    let result = templates;

    if (selectedCategory !== "all") {
      result = result.filter(
        (t) =>
          t.socialCategory === selectedCategory ||
          t.category === selectedCategory,
      );
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query) ||
          t.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    return result;
  }, [templates, selectedCategory, searchQuery]);

  const handleSelectTemplate = useCallback((template: ScriptableTemplate) => {
    setSelectedTemplate(template);
    setShowPreview(true);
  }, []);

  const handleClosePreview = useCallback(() => {
    setShowPreview(false);
    setSelectedTemplate(null);
  }, []);

  const handleApplyTemplate = useCallback(() => {
    handleClosePreview();
    onTemplateApplied?.();
  }, [handleClosePreview, onTemplateApplied]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = { all: templates.length };
    for (const category of SOCIAL_MEDIA_CATEGORY_INFO) {
      stats[category.id] = templates.filter(
        (t) => t.socialCategory === category.id || t.category === category.id,
      ).length;
    }
    return stats;
  }, [templates]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl" />
          <Loader2 className="relative w-10 h-10 text-primary animate-spin" />
        </div>
        <p className="text-sm text-text-muted mt-6">Loading templates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted z-10"
          />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="pl-11 bg-background-tertiary border-border rounded-xl text-text-primary"
          />
        </div>
      </div>

      <CategoryTabs
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        categoryStats={categoryStats}
      />

      {filteredTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-background-tertiary flex items-center justify-center mb-4">
            <Layers size={24} className="text-text-muted" />
          </div>
          <p className="text-base font-medium text-text-primary mb-1">
            No templates found
          </p>
          <p className="text-sm text-text-muted">
            Try adjusting your search or filter
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onClick={() => handleSelectTemplate(template)}
            />
          ))}
        </div>
      )}

      {showPreview && selectedTemplate && (
        <TemplatePreviewModal
          template={selectedTemplate}
          onClose={handleClosePreview}
          onApply={handleApplyTemplate}
        />
      )}
    </div>
  );
};

function mapCategoryToSocial(category: string): SocialMediaCategory {
  const mapping: Record<string, SocialMediaCategory> = {
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
  return mapping[category] || "custom";
}

export default TemplateGallery;
