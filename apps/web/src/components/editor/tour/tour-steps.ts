import i18n from "../../../i18n";

export interface TourStep {
  id: string;
  target: string | null;
  title: string;
  description: string;
  tips?: string[];
  position: "center" | "top" | "bottom" | "left" | "right";
}

export function getTourSteps(): TourStep[] {
  return [
    {
      id: "welcome",
      target: null,
      title: i18n.t("tour.welcome"),
      description: i18n.t("tour.welcomeDesc"),
      position: "center",
    },
    {
      id: "assets",
      target: "[data-tour='assets']",
      title: i18n.t("tour.assetsPanel"),
      description: i18n.t("tour.assetsPanelDesc"),
      tips: [
        "Drag & drop videos, audio, images",
        "AI Gen tab: generate images & backgrounds with AI",
        "Shapes & custom SVG imports",
        "Stickers, backgrounds & overlays",
      ],
      position: "right",
    },
    {
      id: "timeline",
      target: "[data-tour='timeline']",
      title: i18n.t("tour.timeline"),
      description: i18n.t("tour.timelineDesc"),
      tips: ["Press S to split clips", "Space to play/pause", "Scroll to zoom"],
      position: "top",
    },
    {
      id: "preview",
      target: "[data-tour='preview']",
      title: i18n.t("tour.preview"),
      description: i18n.t("tour.previewDesc"),
      tips: [
        "Arrow keys for frame navigation",
        "Click to scrub",
        "Fullscreen available",
      ],
      position: "left",
    },
    {
      id: "inspector",
      target: "[data-tour='inspector']",
      title: i18n.t("tour.inspector"),
      description: i18n.t("tour.inspectorDesc"),
      tips: [
        "Transform, effects, color grading",
        "Keyframe any property",
        "AI-powered tools",
      ],
      position: "left",
    },
    {
      id: "complete",
      target: null,
      title: i18n.t("tour.youreReady"),
      description: i18n.t("tour.youreReadyDesc", { key: "?" }),
      position: "center",
    },
  ];
}

export const ONBOARDING_KEY = "openreel-onboarding-complete";
