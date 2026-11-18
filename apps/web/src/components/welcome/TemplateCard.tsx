import React, { memo } from "react";
import { Play, Clock, Layers, Star, Crown } from "@/icons/lucide-compat";
import type { TemplateCatalogEntry } from "../../services/template-catalog";
import { Button } from "@openreel/ui";
import { TemplateThumb } from "./TemplateThumb";

interface TemplateCardProps {
  template: TemplateCatalogEntry;
  onClick: (template: TemplateCatalogEntry) => void;
  isLoading?: boolean;
}

export const TemplateCard: React.FC<TemplateCardProps> = memo(
  function TemplateCard({
    template,
    onClick,
    isLoading = false,
  }: TemplateCardProps) {
    const formatDuration = (seconds: number): string => {
      if (seconds < 60) return `${seconds}s`;
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    };

    return (
      <Button
        variant="ghost"
        onClick={() => onClick(template)}
        disabled={isLoading}
        aria-busy={isLoading}
        type="button"
        aria-label={template.name}
        className="group/card h-auto min-w-0 items-stretch justify-start whitespace-normal text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 p-0 group relative flex flex-col rounded-xl bg-background-tertiary border border-border overflow-hidden transition-all duration-200 hover:bg-background-elevated hover:border-border-hover hover:shadow-lg hover:-translate-y-0.5"
      >
        <div className="relative aspect-video w-full shrink-0 overflow-hidden">
          <TemplateThumb
            template={template}
            alt={template.name}
            className="transition-transform duration-300 group-hover:scale-105"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />

          {template.previewVideoUrl && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
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
            </div>
          )}
        </div>

        <div className="p-3 text-left">
          <span className="font-medium text-sm text-text-primary truncate group-hover:text-primary transition-colors">
            {template.name}
          </span>

          <div className="flex items-center gap-3 mt-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Clock size={11} />
              <span>{formatDuration(template.duration)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Layers size={11} />
              <span>{template.placeholderCount} editable</span>
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
      </Button>
    );
  },
);
