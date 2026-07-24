import React from "react";
import {
  Smartphone,
  Monitor,
  Square,
  Play,
  Star,
  Layers,
  Briefcase,
  Bookmark,
  AtSign,
  Users,
  Type,
  Settings,
  LayoutGrid,
} from "@/icons/lucide-compat";
import {
  SOCIAL_MEDIA_CATEGORY_INFO,
  type SocialMediaCategory,
} from "@openreel/core";
import { ToolcraftButton as Button } from "@openreel/ui";

interface CategoryTabsProps {
  selectedCategory: SocialMediaCategory | "all";
  onSelectCategory: (category: SocialMediaCategory | "all") => void;
  categoryStats: Record<string, number>;
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  tiktok: Smartphone,
  "instagram-reels": Smartphone,
  "instagram-stories": Smartphone,
  "instagram-post": Square,
  "youtube-shorts": Smartphone,
  "youtube-video": Monitor,
  facebook: Users,
  twitter: AtSign,
  linkedin: Briefcase,
  pinterest: Bookmark,
  intro: Play,
  outro: Play,
  promo: Star,
  "lower-third": Type,
  slideshow: Layers,
  custom: Settings,
  all: LayoutGrid,
};

const PLATFORMS = ["TikTok", "Instagram", "YouTube", "General"];

const PLATFORM_CATEGORIES: Record<string, SocialMediaCategory[]> = {
  TikTok: ["tiktok"],
  Instagram: ["instagram-reels", "instagram-stories", "instagram-post"],
  YouTube: ["youtube-shorts", "youtube-video"],
  General: ["intro", "outro", "promo", "lower-third", "slideshow", "custom"],
};

export const CategoryTabs: React.FC<CategoryTabsProps> = ({
  selectedCategory,
  onSelectCategory,
  categoryStats,
}) => {
  const [expandedPlatform, setExpandedPlatform] = React.useState<string | null>(
    null,
  );

  const handlePlatformClick = (platform: string) => {
    if (expandedPlatform === platform) {
      setExpandedPlatform(null);
    } else {
      setExpandedPlatform(platform);
      const categories = PLATFORM_CATEGORIES[platform];
      if (categories && categories.length === 1) {
        onSelectCategory(categories[0]);
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <Button
          label="All"
          onClick={() => {
            onSelectCategory("all");
            setExpandedPlatform(null);
          }}
          variant={selectedCategory === "all" ? "primary" : "secondary"}
          size="sm"
          icon={<LayoutGrid size={14} aria-hidden />}
          endContent={
            <span
              className={`text-xs ${selectedCategory === "all" ? "text-black/60" : "text-text-muted"}`}
            >
              {categoryStats.all || 0}
            </span>
          }
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200 ${
            selectedCategory === "all"
              ? "bg-primary text-black"
              : "bg-background-tertiary text-text-secondary hover:text-text-primary hover:bg-background-elevated"
          }`}
        />

        {PLATFORMS.map((platform) => {
          const categories = PLATFORM_CATEGORIES[platform];
          const isExpanded = expandedPlatform === platform;
          const isActive = categories.includes(
            selectedCategory as SocialMediaCategory,
          );
          const Icon = CATEGORY_ICONS[categories[0]] || Square;
          const count = categories.reduce(
            (sum, cat) => sum + (categoryStats[cat] || 0),
            0,
          );

          return (
            <Button
              key={platform}
              label={platform}
              onClick={() => handlePlatformClick(platform)}
              variant={isActive || isExpanded ? "primary" : "secondary"}
              size="sm"
              icon={<Icon size={14} aria-hidden />}
              endContent={count > 0 ? (
                <span
                  className={`text-xs ${isActive || isExpanded ? "text-black/60" : "text-text-muted"}`}
                >
                  {count}
                </span>
              ) : undefined}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200 ${
                isActive || isExpanded
                  ? "bg-primary text-black"
                  : "bg-background-tertiary text-text-secondary hover:text-text-primary hover:bg-background-elevated"
              }`}
            />
          );
        })}
      </div>

      {expandedPlatform && PLATFORM_CATEGORIES[expandedPlatform].length > 1 && (
        <div className="flex items-center gap-2 pl-2 overflow-x-auto pb-1">
          {PLATFORM_CATEGORIES[expandedPlatform].map((category) => {
            const info = SOCIAL_MEDIA_CATEGORY_INFO.find(
              (c) => c.id === category,
            );
            const count = categoryStats[category] || 0;
            const Icon = CATEGORY_ICONS[category] || Square;

            return (
              <Button
                key={category}
                label={info?.name || category}
                onClick={() => onSelectCategory(category)}
                variant={selectedCategory === category ? "primary" : "secondary"}
                size="sm"
                icon={<Icon size={12} aria-hidden />}
                endContent={count > 0 ? (
                  <span
                    className={`text-[10px] ${selectedCategory === category ? "text-primary/70" : "text-text-muted"}`}
                  >
                    {count}
                  </span>
                ) : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                  selectedCategory === category
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "bg-background text-text-muted hover:text-text-secondary hover:bg-background-tertiary"
                }`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CategoryTabs;
