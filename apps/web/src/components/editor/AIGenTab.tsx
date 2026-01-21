import React, { useState } from "react";
import {
  Mic,
  Subtitles,
  Palette,
  Music,
  Video,
  Layers,
  ChevronRight,
  Wand2,
  FileStack,
  Volume2,
} from "lucide-react";
import { ScrollArea } from "@openreel/ui";
import { AutoCaptionPanel } from "./inspector/AutoCaptionPanel";
import { TextToSpeechPanel } from "./inspector/TextToSpeechPanel";
import { FilterPresetsPanel } from "./inspector/FilterPresetsPanel";
import { MusicLibraryPanel } from "./inspector/MusicLibraryPanel";
import { TemplatesBrowserPanel } from "./inspector/TemplatesBrowserPanel";
import { MultiCameraPanel } from "./inspector/MultiCameraPanel";

type FeatureId = "templates" | "captions" | "tts" | "filters" | "music" | "multicam" | null;

interface FeatureCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  iconColor: string;
  iconBg: string;
  activeBorder: string;
  activeBg: string;
  activeRing: string;
  isActive: boolean;
  onClick: () => void;
}

const FeatureCard: React.FC<FeatureCardProps> = ({
  icon: Icon,
  title,
  description,
  iconColor,
  iconBg,
  activeBorder,
  activeBg,
  activeRing,
  isActive,
  onClick,
}) => (
  <button
    onClick={onClick}
    className={`w-full min-w-0 p-3 rounded-xl border text-left transition-all group ${
      isActive
        ? `${activeBorder} ${activeBg} ring-1 ${activeRing}`
        : "border-border bg-background-tertiary hover:border-border-strong hover:bg-background-elevated"
    }`}
  >
    <div className="flex items-center gap-3 min-w-0">
      <div
        className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center transition-colors ${
          isActive ? iconBg : "bg-background-secondary group-hover:bg-background-tertiary"
        }`}
      >
        <Icon size={20} className={isActive ? iconColor : "text-text-secondary group-hover:text-text-primary"} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-text-primary truncate">
            {title}
          </span>
          <ChevronRight
            size={14}
            className={`shrink-0 transition-transform ${isActive ? "rotate-90 text-text-primary" : "text-text-muted group-hover:text-text-secondary"}`}
          />
        </div>
        <p className="text-[10px] text-text-muted mt-0.5 truncate">{description}</p>
      </div>
    </div>
  </button>
);

interface FeatureSectionProps {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}

const FeatureSection: React.FC<FeatureSectionProps> = ({ title, icon: Icon, children }) => (
  <div className="space-y-2 min-w-0">
    <div className="flex items-center gap-2 px-1">
      <Icon size={12} className="text-text-muted shrink-0" />
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{title}</span>
    </div>
    <div className="space-y-1.5 min-w-0">{children}</div>
  </div>
);

export const AIGenTab: React.FC = () => {
  const [activeFeature, setActiveFeature] = useState<FeatureId>(null);

  const handleFeatureClick = (id: FeatureId) => {
    setActiveFeature(activeFeature === id ? null : id);
  };

  const renderActivePanel = () => {
    switch (activeFeature) {
      case "templates":
        return <TemplatesBrowserPanel />;
      case "captions":
        return <AutoCaptionPanel />;
      case "tts":
        return <TextToSpeechPanel />;
      case "filters":
        return <FilterPresetsPanel />;
      case "music":
        return <MusicLibraryPanel />;
      case "multicam":
        return <MultiCameraPanel />;
      default:
        return null;
    }
  };

  if (activeFeature) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden w-full min-w-0">
        <button
          onClick={() => setActiveFeature(null)}
          className="flex items-center gap-2 px-4 py-3 text-text-secondary hover:text-text-primary transition-colors border-b border-border bg-background-secondary shrink-0"
        >
          <ChevronRight size={14} className="rotate-180" />
          <span className="text-[11px] font-medium">Back to AI Tools</span>
        </button>
        <ScrollArea className="flex-1 w-full">
          <div className="p-4 w-full min-w-0 overflow-hidden">{renderActivePanel()}</div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 w-full">
      <div className="p-4 space-y-6 min-w-0">
        <div className="text-center pb-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 mb-3">
            <Wand2 size={24} className="text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-text-primary">AI-Powered Tools</h2>
          <p className="text-[11px] text-text-muted mt-1">Automate your editing with intelligent features</p>
        </div>

        <FeatureSection title="Content Generation" icon={Wand2}>
          <FeatureCard
            icon={Mic}
            title="Text to Speech"
            description="Generate natural voiceovers from text"
            iconColor="text-blue-400"
            iconBg="bg-blue-500/20"
            activeBorder="border-blue-500/50"
            activeBg="bg-blue-500/10"
            activeRing="ring-blue-500/30"
            isActive={activeFeature === "tts"}
            onClick={() => handleFeatureClick("tts")}
          />
          <FeatureCard
            icon={Subtitles}
            title="Auto Captions"
            description="Automatically generate subtitles from audio"
            iconColor="text-purple-400"
            iconBg="bg-purple-500/20"
            activeBorder="border-purple-500/50"
            activeBg="bg-purple-500/10"
            activeRing="ring-purple-500/30"
            isActive={activeFeature === "captions"}
            onClick={() => handleFeatureClick("captions")}
          />
        </FeatureSection>

        <FeatureSection title="Templates & Presets" icon={FileStack}>
          <FeatureCard
            icon={Layers}
            title="Project Templates"
            description="Start with pre-built project structures"
            iconColor="text-green-400"
            iconBg="bg-green-500/20"
            activeBorder="border-green-500/50"
            activeBg="bg-green-500/10"
            activeRing="ring-green-500/30"
            isActive={activeFeature === "templates"}
            onClick={() => handleFeatureClick("templates")}
          />
          <FeatureCard
            icon={Palette}
            title="Filter Presets"
            description="Apply cinematic color grades instantly"
            iconColor="text-orange-400"
            iconBg="bg-orange-500/20"
            activeBorder="border-orange-500/50"
            activeBg="bg-orange-500/10"
            activeRing="ring-orange-500/30"
            isActive={activeFeature === "filters"}
            onClick={() => handleFeatureClick("filters")}
          />
        </FeatureSection>

        <FeatureSection title="Media Library" icon={Volume2}>
          <FeatureCard
            icon={Music}
            title="Music & Sound Effects"
            description="Browse royalty-free audio for your projects"
            iconColor="text-pink-400"
            iconBg="bg-pink-500/20"
            activeBorder="border-pink-500/50"
            activeBg="bg-pink-500/10"
            activeRing="ring-pink-500/30"
            isActive={activeFeature === "music"}
            onClick={() => handleFeatureClick("music")}
          />
        </FeatureSection>

        <FeatureSection title="Pro Tools" icon={Video}>
          <FeatureCard
            icon={Video}
            title="Multi-Camera Editing"
            description="Sync and switch between multiple angles"
            iconColor="text-cyan-400"
            iconBg="bg-cyan-500/20"
            activeBorder="border-cyan-500/50"
            activeBg="bg-cyan-500/10"
            activeRing="ring-cyan-500/30"
            isActive={activeFeature === "multicam"}
            onClick={() => handleFeatureClick("multicam")}
          />
        </FeatureSection>

        <div className="pt-2 border-t border-border">
          <p className="text-[9px] text-text-muted text-center">
            More AI features coming soon — image generation, auto-edit, and more
          </p>
        </div>
      </div>
    </ScrollArea>
  );
};

export default AIGenTab;
