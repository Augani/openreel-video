import { useState, useCallback, useEffect } from "react";
import {
  Clock,
  Layers,
  ArrowRight,
  Smartphone,
  Monitor,
  Square,
  FolderOpen,
} from "lucide-react";
import { Button, Switch, Label } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { SOCIAL_MEDIA_PRESETS, type SocialMediaCategory } from "@openreel/core";
import { TemplateGallery } from "./TemplateGallery";
import { RecentProjects } from "./RecentProjects";
import { useRouter } from "../../hooks/use-router";
import { useEditorPreload } from "../../hooks/useEditorPreload";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";

interface FormatOption {
  id: string;
  preset: SocialMediaCategory;
  label: string;
  description: string;
  dimensions: string;
  icon: React.ElementType;
  gradient: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: "vertical",
    preset: "tiktok",
    label: "Vertical",
    description: "TikTok, Reels, Shorts",
    dimensions: "1080 × 1920",
    icon: Smartphone,
    gradient: "from-violet-500/20 to-fuchsia-500/20",
  },
  {
    id: "horizontal",
    preset: "youtube-video",
    label: "Horizontal",
    description: "YouTube, Vimeo, Web",
    dimensions: "1920 × 1080",
    icon: Monitor,
    gradient: "from-blue-500/20 to-cyan-500/20",
  },
  {
    id: "square",
    preset: "instagram-post",
    label: "Square",
    description: "Instagram, Facebook",
    dimensions: "1080 × 1080",
    icon: Square,
    gradient: "from-orange-500/20 to-rose-500/20",
  },
];

const OpenReelLogo: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg
    viewBox="0 0 490 490"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path
      d="M245 24.5C123.223 24.5 24.5 123.223 24.5 245s98.723 220.5 220.5 220.5 220.5-98.723 220.5-220.5S366.777 24.5 245 24.5Z"
      stroke="currentColor"
      strokeWidth="30.625"
    />
    <g>
      <path
        d="M245 98v73.5"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="M392 245h-73.5"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="M245 392v-73.5"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="M98 245h73.5"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="m348.941 141.059-51.965 51.965"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="m348.941 348.941-51.965-51.965"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="m141.059 348.941 51.965-51.965"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="m141.059 141.059 51.965 51.965"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
    </g>
    <path
      d="M294 245a49 49 0 0 1-49 49 49 49 0 0 1-49-49 49 49 0 0 1 98 0"
      fill="currentColor"
    />
  </svg>
);

type ViewMode = "home" | "templates" | "recent";

interface WelcomeScreenProps {
  initialTab?: "templates" | "recent";
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ initialTab }) => {
  const setSkipWelcomeScreen = useUIStore(
    (state) => state.setSkipWelcomeScreen,
  );
  const skipWelcomeScreen = useUIStore((state) => state.skipWelcomeScreen);
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const { navigate } = useRouter();
  const { track } = useAnalytics();

  const [viewMode, setViewMode] = useState<ViewMode>(initialTab ?? "home");
  const [hoveredFormat, setHoveredFormat] = useState<string | null>(null);

  useEditorPreload(true);

  const handleCreateProject = useCallback(
    (option: FormatOption) => {
      const preset = SOCIAL_MEDIA_PRESETS[option.preset];
      createNewProject(`New ${option.label} Video`, {
        width: preset.width,
        height: preset.height,
        frameRate: preset.frameRate,
      });
      track(AnalyticsEvents.PROJECT_CREATED, {
        preset: option.preset,
        width: preset.width,
        height: preset.height,
        frameRate: preset.frameRate ?? 30,
        source: "quick_start",
      });
      navigate("editor");
    },
    [createNewProject, navigate, track],
  );

  const handleTemplateApplied = useCallback(() => {
    navigate("editor");
  }, [navigate]);

  const handleProjectSelected = useCallback(() => {
    navigate("editor");
  }, [navigate]);

  useEffect(() => {
    if (skipWelcomeScreen) {
      navigate("editor");
    }
  }, [skipWelcomeScreen, navigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewMode !== "home") {
          setViewMode("home");
        } else {
          navigate("editor");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, viewMode]);

  if (viewMode === "templates") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode("home")}
          >
            <ArrowRight className="rotate-180" size={16} />
            Back
          </Button>
          <h2 className="text-sm font-medium text-text-primary">Templates</h2>
          <div className="w-16" />
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <TemplateGallery onTemplateApplied={handleTemplateApplied} />
        </div>
      </div>
    );
  }

  if (viewMode === "recent") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode("home")}
          >
            <ArrowRight className="rotate-180" size={16} />
            Back
          </Button>
          <h2 className="text-sm font-medium text-text-primary">
            Recent Projects
          </h2>
          <div className="w-16" />
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <RecentProjects onProjectSelected={handleProjectSelected} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,197,94,0.05),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(34,197,94,0.03),transparent_50%)]" />

      <div className="relative h-full flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-3xl">
          <div className="flex flex-col items-center text-center mb-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 text-primary">
                <OpenReelLogo className="w-full h-full" />
              </div>
              <span className="text-xl font-semibold text-text-primary tracking-tight">
                Open Reel Video
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-bold text-text-primary tracking-tight mb-3">
              From idea to export.
            </h1>
            <p className="text-xl text-text-secondary mb-8">
              In your browser.
            </p>
            <p className="text-base text-text-muted max-w-md">
              Pick a format and start creating. You can change this anytime.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-10">
            {FORMAT_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isHovered = hoveredFormat === option.id;

              return (
                <button
                  key={option.id}
                  onClick={() => handleCreateProject(option)}
                  onMouseEnter={() => setHoveredFormat(option.id)}
                  onMouseLeave={() => setHoveredFormat(null)}
                  className={`
                    group relative flex flex-col items-center p-6 rounded-2xl
                    bg-background-secondary border border-border
                    hover:border-primary/40 hover:bg-background-tertiary
                    transition-all duration-200
                    ${isHovered ? "scale-[1.02] shadow-lg shadow-primary/5" : ""}
                  `}
                >
                  <div
                    className={`
                    absolute inset-0 rounded-2xl bg-gradient-to-br ${option.gradient}
                    opacity-0 group-hover:opacity-100 transition-opacity duration-300
                  `}
                  />

                  <div className="relative z-10 flex flex-col items-center">
                    <div
                      className={`
                      w-16 h-16 mb-4 rounded-xl flex items-center justify-center
                      bg-background-tertiary group-hover:bg-primary/10
                      transition-colors duration-200
                    `}
                    >
                      <Icon
                        size={28}
                        className="text-text-muted group-hover:text-primary transition-colors"
                      />
                    </div>

                    <h3 className="text-lg font-semibold text-text-primary mb-1">
                      {option.label}
                    </h3>
                    <p className="text-sm text-text-muted mb-3">
                      {option.description}
                    </p>
                    <span className="text-xs font-mono text-text-muted/70 bg-background-tertiary px-2 py-1 rounded">
                      {option.dimensions}
                    </span>
                  </div>

                  <div
                    className={`
                    absolute bottom-4 left-1/2 -translate-x-1/2
                    flex items-center gap-1 text-sm font-medium text-primary
                    opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0
                    transition-all duration-200
                  `}
                  >
                    Start creating
                    <ArrowRight size={14} />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => setViewMode("templates")}
              className="rounded-xl"
            >
              <Layers size={16} />
              Browse templates
            </Button>
            <Button
              variant="outline"
              onClick={() => setViewMode("recent")}
              className="rounded-xl"
            >
              <Clock size={16} />
              Recent projects
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("editor")}
              className="rounded-xl"
            >
              <FolderOpen size={16} />
              Open editor
            </Button>
          </div>
        </div>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="skip-welcome"
              checked={skipWelcomeScreen}
              onCheckedChange={setSkipWelcomeScreen}
            />
            <Label
              htmlFor="skip-welcome"
              className="text-xs text-text-muted cursor-pointer"
            >
              Skip on startup
            </Label>
          </div>

          <span className="text-text-muted/30">·</span>

          <p className="text-xs text-text-muted/60">
            Press{" "}
            <kbd className="px-1.5 py-0.5 bg-background-tertiary border border-border rounded text-text-muted font-mono text-[10px]">
              Esc
            </kbd>{" "}
            to skip
          </p>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
