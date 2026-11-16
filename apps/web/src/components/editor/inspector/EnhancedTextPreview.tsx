import {
  Textarea as ShadcnTextarea,
  cn as uiCn,
  Button,
  Card,
} from "@openreel/ui";
import React from "react";




import { Sparkles } from "@/icons/lucide-compat";

interface EnhancedTextPreviewProps {
  enhancedPreview: string;
  onUpdate: (text: string) => void;
  onDiscard: () => void;
}

export const EnhancedTextPreview: React.FC<EnhancedTextPreviewProps> = ({
  enhancedPreview,
  onUpdate,
  onDiscard,
}) => {
  return (
    <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 space-y-1.5 border border-amber-500/20 bg-amber-500/5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Sparkles size={9} className="text-amber-400" />
          <span className="text-[9px] font-medium text-amber-400">
            Enhanced - edit below then Generate
          </span>
        </div>
        <Button onClick={onDiscard} type="button" aria-label="Discard" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 bg-transparent hover:bg-bg-2 text-[9px] text-fg-3 hover:text-red-400 transition-colors">
          <span className="truncate">{"Discard"}</span>
        </Button>
      </div>
      <ShadcnTextarea
        value={enhancedPreview}
        aria-label={"Enhanced preview"}
        onChange={(event) => onUpdate(event.currentTarget.value)}
        style={{ width: "100%" }}
        className={uiCn(
          "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]",
          "min-h-[5.75rem] resize-y leading-5",
          undefined,
          "text-[10px] md:text-[10px]",
        )}
      />
    </Card>
  );
};
