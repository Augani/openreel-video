import React, { useState } from "react";
import {
  Play,
  Clock,
  Layers,
  Smartphone,
  Monitor,
  Square,
  Star,
  Crown,
} from "lucide-react";
import type { ScriptableTemplate, SocialMediaCategory } from "@openreel/core";
import { SOCIAL_MEDIA_PRESETS } from "@openreel/core";

interface TemplateCardProps {
  template: ScriptableTemplate;
  onClick: () => void;
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  tiktok: Smartphone,
  "instagram-reels": Smartphone,
  "instagram-stories": Smartphone,
  "instagram-post": Square,
  "youtube-shorts": Smartphone,
  "youtube-video": Monitor,
  facebook: Square,
  twitter: Monitor,
  linkedin: Monitor,
  pinterest: Smartphone,
  intro: Play,
  outro: Play,
  promo: Star,
  "lower-third": Monitor,
  slideshow: Layers,
  custom: Square,
};

const CATEGORY_GRADIENTS: Record<string, string> = {
  tiktok: "from-pink-500 to-cyan-500",
  "instagram-reels": "from-purple-500 to-pink-500",
  "instagram-stories": "from-amber-500 to-pink-500",
  "instagram-post": "from-purple-500 to-pink-500",
  "youtube-shorts": "from-red-500 to-orange-500",
  "youtube-video": "from-red-600 to-red-400",
  facebook: "from-blue-600 to-blue-400",
  twitter: "from-sky-500 to-blue-500",
  linkedin: "from-blue-700 to-blue-500",
  pinterest: "from-red-500 to-rose-400",
  intro: "from-emerald-500 to-pink-500",
  outro: "from-pink-500 to-emerald-500",
  promo: "from-amber-500 to-orange-500",
  "lower-third": "from-emerald-500 to-teal-500",
  slideshow: "from-teal-500 to-cyan-500",
  custom: "from-zinc-500 to-zinc-400",
};

export const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  onClick,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const category: SocialMediaCategory = template.socialCategory || "custom";
  const preset = SOCIAL_MEDIA_PRESETS[category];
  const isVertical = preset && preset.height > preset.width;
  const Icon = CATEGORY_ICONS[category] || Square;
  const gradient =
    CATEGORY_GRADIENTS[category] || "from-primary to-emerald-500";

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative flex flex-col rounded-xl bg-background-tertiary border border-border overflow-hidden transition-all duration-200 hover:bg-background-elevated hover:border-border-hover hover:shadow-lg hover:-translate-y-0.5"
    >
      <div
        className={`relative flex items-center justify-center overflow-hidden ${
          isVertical ? "aspect-[9/16] max-h-48" : "aspect-video"
        }`}
      >
        {template.thumbnailUrl ? (
          <img
            src={template.thumbnailUrl}
            alt={template.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div
            className={`w-full h-full bg-gradient-to-br ${gradient} opacity-40 flex items-center justify-center`}
          >
            <Icon
              size={32}
              className="text-text-primary opacity-60 group-hover:opacity-80 transition-all duration-200"
            />
          </div>
        )}

        <div
          className={`absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent transition-opacity duration-200 ${isHovered ? "opacity-100" : "opacity-0"}`}
        />

        {template.previewVideoUrl && isHovered && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-11 h-11 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center border border-border">
              <Play
                size={18}
                className="text-text-primary ml-0.5"
                fill="currentColor"
              />
            </div>
          </div>
        )}

        {template.featured && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-amber-500 text-black text-[10px] font-semibold rounded-full flex items-center gap-1">
            <Star size={10} fill="currentColor" />
            Featured
          </div>
        )}

        {template.premium && (
          <div className="absolute top-2 right-2 px-2 py-0.5 bg-primary text-black text-[10px] font-semibold rounded-full flex items-center gap-1">
            <Crown size={10} />
            Pro
          </div>
        )}
      </div>

      <div className="p-3 text-left">
        <h3 className="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">
          {template.name}
        </h3>

        <div className="flex items-center gap-3 mt-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Clock size={11} />
            <span>{formatDuration(template.timeline.duration)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Layers size={11} />
            <span>{template.placeholders.length} editable</span>
          </div>
        </div>

        {template.tags.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 overflow-hidden">
            {template.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-[10px] bg-background rounded text-text-muted"
              >
                {tag}
              </span>
            ))}
            {template.tags.length > 2 && (
              <span className="text-[10px] text-text-muted">
                +{template.tags.length - 2}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
};

export default TemplateCard;
