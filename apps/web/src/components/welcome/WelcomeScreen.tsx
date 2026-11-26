import {
  useState,
  useCallback,
  useEffect,
  useId,
  useRef,
  lazy,
  Suspense,
} from "react";
import {
  Clock,
  Layers,
  ArrowRight,
  Smartphone,
  Monitor,
  Square,
  FolderOpen,
} from "@/icons/lucide-compat";
import { Switch, Label } from "@openreel/ui";
import { Button } from "@openreel/ui";
import { cn } from "@openreel/ui";

import { useProjectStore } from "../../stores/project-store";
import { createEditorProject } from "../../services/project-creation";
import { useUIStore } from "../../stores/ui-store";
import { SOCIAL_MEDIA_PRESETS, type SocialMediaCategory } from "@openreel/core";
import { useRouter } from "../../hooks/use-router";
import { useEditorPreload } from "../../hooks/useEditorPreload";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import { usePhoneEditor } from "../../hooks/usePhoneEditor";
import { useOnboardingStore } from "../../stores/onboarding-store";
import { PathBand } from "../onboarding/shell/PathBand";
import { isDesktopRuntime, useOnboardingGate } from "../onboarding/shell/useOnboardingGate";
import { withUserProjectCreation } from "../onboarding/shell/project-intent";
import { useT } from "@openreel/i18n/react";

const isDesktop =
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

const MobileProjectHome = lazy(() =>
  import("./MobileProjectHome").then((module) => ({
    default: module.MobileProjectHome,
  })),
);

const TemplateGallery = lazy(() =>
  import("./TemplateGallery").then((module) => ({
    default: module.TemplateGallery,
  })),
);
const RecentProjects = lazy(() =>
  import("./RecentProjects").then((module) => ({
    default: module.RecentProjects,
  })),
);

const LoadingView = () => {
  const t = useT();
  return (
    <div role="status" className="p-6 text-center text-text-secondary">
      {t("Loading…")}
    </div>
  );
};

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
    gradient: "from-emerald-500/20 to-teal-500/20",
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
  const t = useT();
  const skipId = useId();
  const phone = usePhoneEditor();
  const setSkipWelcomeScreen = useUIStore(
    (state) => state.setSkipWelcomeScreen,
  );
  const skipWelcomeScreen = useUIStore((state) => state.skipWelcomeScreen);
  const { navigate } = useRouter();
  const { track } = useAnalytics();
  const gate = useOnboardingGate();
  const bandOpen = useOnboardingStore((state) => state.bandOpen === true);
  // Any other deliberate choice on the welcome screen retires the first-run band.
  const dismissBand = useCallback(() => {
    if (isDesktopRuntime()) useOnboardingStore.getState().skip("user");
  }, []);

  const [viewMode, setViewMode] = useState<ViewMode>(initialTab ?? "home");
  const [creating, setCreating] = useState(false),
    [creationError, setCreationError] = useState<string | null>(null);
  const creation = useRef<AbortController | null>(null);
  useEffect(() => () => creation.current?.abort(), []);

  useEditorPreload(true);

  const handleCreateProject = useCallback(
    async (option: FormatOption) => {
      if (creation.current) return;
      const controller = new AbortController();
      creation.current = controller;
      setCreating(true);
      setCreationError(null);
      const preset = SOCIAL_MEDIA_PRESETS[option.preset];
      try {
        const created = await withUserProjectCreation(() =>
          createEditorProject({
            name: `New ${option.label} Video`,
            settings: {
              width: preset.width,
              height: preset.height,
              frameRate: preset.frameRate,
            },
            signal: controller.signal,
          }),
        );
        if (useProjectStore.getState().project.id !== created.id) return;
        // The format is already chosen: keep EmptyProjectStart from asking again (spec 3.4).
        // Choosing a format is the strongest "I know what I want" signal: retire the band, but only now
        // that a project exists (a failed or aborted creation keeps onboarding).
        if (isDesktopRuntime()) {
          const onboarding = useOnboardingStore.getState();
          onboarding.skip("format");
          onboarding.markFormatChosen(created.id);
        }
        track(AnalyticsEvents.PROJECT_CREATED, {
          preset: option.preset,
          width: preset.width,
          height: preset.height,
          frameRate: preset.frameRate ?? 30,
          source: "quick_start",
        });
        navigate("editor");
      } catch (reason) {
        if (!controller.signal.aborted)
          setCreationError(
            reason instanceof Error
              ? reason.message
              : "Could not create project. Try again.",
          );
      } finally {
        if (creation.current === controller) creation.current = null;
        if (!controller.signal.aborted) setCreating(false);
      }
    },
    [navigate, track],
  );

  const handleTemplateApplied = useCallback(() => {
    navigate("editor");
  }, [navigate]);

  const handleProjectSelected = useCallback(() => {
    navigate("editor");
  }, [navigate]);

  useEffect(() => {
    if (skipWelcomeScreen && !initialTab && !bandOpen) {
      navigate("editor");
    }
  }, [skipWelcomeScreen, initialTab, navigate, bandOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        phone ||
        e.defaultPrevented ||
        (e.target instanceof Element &&
          e.target.closest(
            "input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox]",
          ))
      )
        return;
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
  }, [navigate, viewMode, phone]);

  if (phone)
    return (
      <Suspense fallback={<LoadingView />}>
        <MobileProjectHome initialTab={initialTab} />
      </Suspense>
    );

  if (viewMode === "templates") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <Button
            onClick={() => setViewMode("home")}
            type="button"
            aria-label={t("Back")}
            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {<ArrowRight className="rotate-180" size={16} aria-hidden />}
            </span>
            <span className="truncate">{t("Back")}</span>
          </Button>
          <span className="font-medium text-sm text-text-primary">
            {t("Templates")}
          </span>
          <div className="w-16" />
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <Suspense fallback={<LoadingView />}>
            <TemplateGallery onTemplateApplied={handleTemplateApplied} />
          </Suspense>
        </div>
      </div>
    );
  }

  if (viewMode === "recent") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <Button
            onClick={() => setViewMode("home")}
            type="button"
            aria-label={t("Back")}
            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {<ArrowRight className="rotate-180" size={16} aria-hidden />}
            </span>
            <span className="truncate">{t("Back")}</span>
          </Button>
          <span className="font-medium text-sm text-text-primary">
            {t("Recent Projects")}
          </span>
          <div className="w-16" />
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <Suspense fallback={<LoadingView />}>
            <RecentProjects onProjectSelected={handleProjectSelected} />
          </Suspense>
        </div>
      </div>
    );
  }

  // First-run mode (the path band is showing) compacts the page so the band, the format cards and the
  // footer all fit the 1024x700 minimum window without scrolling (spec 2.1 "Fit").
  const compact = gate.showBand;
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,197,94,0.05),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(34,197,94,0.03),transparent_50%)]" />

      <div data-testid="welcome-scroller" className="relative h-full overflow-y-auto">
        <div className="flex min-h-full flex-col items-center px-6 py-4">
          <div className="my-auto w-full max-w-3xl">
            <div
              className={cn(
                "flex flex-col items-center text-center",
                compact ? "mb-3" : "mb-12",
              )}
            >
              <div className={cn("flex items-center gap-3", compact ? "mb-2" : "mb-6")}>
                <div className={cn("text-primary", compact ? "w-10 h-10" : "w-12 h-12")}>
                  <OpenReelLogo className="w-full h-full" />
                </div>
                <span className="font-semibold text-xl text-text-primary tracking-tight">
                  Open Reel Video
                </span>
              </div>

              <span
                className={cn(
                  "font-bold text-text-primary tracking-tight",
                  compact ? "text-3xl mb-1" : "text-4xl sm:text-5xl mb-3",
                )}
              >
                {t("From idea to export.")}
              </span>
              <span
                className={cn(
                  "font-normal text-text-secondary",
                  compact ? "text-base" : "text-xl mb-8",
                )}
              >
                {isDesktop ? t("On your desktop.") : t("In your browser.")}
              </span>
              {!compact && (
                <span className="font-normal text-base text-text-muted max-w-md">
                  {t("Pick a format and start creating. You can change this anytime.")}
                </span>
              )}
            </div>

            <PathBand />

            {compact && (
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-3">
                {t("Or just pick a format and start")}
              </p>
            )}
            <div className={cn("grid grid-cols-3", compact ? "gap-3 mb-4" : "gap-4 mb-10")}>
              {FORMAT_OPTIONS.map((option) => {
                const Icon = option.icon;

                return (
                  <Button
                    variant="ghost"
                    key={option.id}
                    onClick={() => handleCreateProject(option)}
                    type="button"
                    aria-label={t("Create {name} project", { name: t(option.label) })}
                    disabled={creating}
                    className={cn(
                      "group relative flex h-auto min-w-0 flex-col items-center whitespace-normal rounded-2xl border border-border bg-bg-1 text-left",
                      "transition-[background-color,border-color,box-shadow] duration-200 motion-reduce:transition-none",
                      "hover:border-accent/40 hover:bg-bg-2 hover:shadow-glow",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                      compact ? "p-4" : "p-6",
                    )}
                  >
                    <div
                      className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${option.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300 motion-reduce:transition-none`}
                    />

                    <div className="relative z-10 flex flex-col items-center">
                      <div
                        className={cn(
                          "flex items-center justify-center rounded-xl bg-bg-2 transition-colors duration-200 group-hover:bg-accent-soft motion-reduce:transition-none",
                          compact ? "w-10 h-10 mb-2" : "w-16 h-16 mb-4",
                        )}
                      >
                        <Icon
                          size={compact ? 20 : 28}
                          className="text-fg-3 transition-colors group-hover:text-accent"
                        />
                      </div>

                      <span
                        className={cn(
                          "font-semibold text-fg",
                          compact ? "text-base mb-0.5" : "text-lg mb-1",
                        )}
                      >
                        {t(option.label)}
                      </span>
                      <span
                        className={cn(
                          "font-normal text-fg-3",
                          compact ? "text-xs mb-2" : "text-sm mb-3",
                        )}
                      >
                        {t(option.description)}
                      </span>
                      <span className="text-xs font-mono text-fg-3/80 bg-bg-2 px-2 py-1 rounded">
                        {option.dimensions}
                      </span>
                    </div>

                    {!compact && (
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 text-sm font-medium text-accent opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-200 motion-reduce:transition-none">
                        {t("Start creating")}
                        <ArrowRight size={14} />
                      </div>
                    )}
                  </Button>
                );
              })}
            </div>

            {creating && (
              <p role="status" className="mb-4 text-center text-xs text-fg-3">
                {t("Saving current work and creating project...")}
              </p>
            )}
            {creationError && (
              <p role="alert" className="mb-4 text-center text-xs text-red-400">
                {creationError}
              </p>
            )}
            <div className="flex items-center justify-center gap-3">
              <Button
                onClick={() => {
                  dismissBand();
                  setViewMode("templates");
                }}
                type="button"
                aria-label={t("Browse templates")}
                disabled={creating}
                className="inline-flex min-w-0 items-center justify-center gap-1.5 font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg rounded-xl"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {<Layers size={16} aria-hidden />}
                </span>
                <span className="truncate">{t("Browse templates")}</span>
              </Button>
              <Button
                onClick={() => {
                  dismissBand();
                  setViewMode("recent");
                }}
                type="button"
                aria-label={t("Recent projects")}
                disabled={creating}
                className="inline-flex min-w-0 items-center justify-center gap-1.5 font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg rounded-xl"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {<Clock size={16} aria-hidden />}
                </span>
                <span className="truncate">{t("Recent projects")}</span>
              </Button>
              <Button
                onClick={() => {
                  dismissBand();
                  navigate("editor");
                }}
                type="button"
                aria-label={t("Open editor")}
                disabled={creating}
                className="inline-flex min-w-0 items-center justify-center gap-1.5 font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg rounded-xl"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {<FolderOpen size={16} aria-hidden />}
                </span>
                <span className="truncate">{t("Open editor")}</span>
              </Button>
            </div>
          </div>

          <div className="mt-3 flex shrink-0 items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id={skipId}
                disabled={creating}
                checked={skipWelcomeScreen}
                onCheckedChange={setSkipWelcomeScreen}
              />
              <Label htmlFor={skipId} className="text-xs text-fg-3">
                {t("Skip on startup")}
              </Label>
            </div>

            {gate.enabled && !gate.showBand && (
              <>
                <span className="text-text-muted/30">·</span>
                <button
                  type="button"
                  onClick={() => useOnboardingStore.getState().reopenBand()}
                  className="rounded text-xs text-fg-3 outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                >
                  {t("Setup")}
                </button>
              </>
            )}

            {!compact && (
              <>
                <span className="text-text-muted/30">·</span>

                <span className="font-normal text-xs text-text-muted/60">
                  {t("Press")}{" "}
                  <kbd className="px-1.5 py-0.5 bg-background-tertiary border border-border rounded text-text-muted font-mono text-[10px]">
                    {t("Esc")}
                  </kbd>{" "}
                  {t("to skip")}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
