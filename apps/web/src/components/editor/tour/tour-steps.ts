export interface TourStep {
  id: string;
  target: string | null;
  title: string;
  description: string;
  tips?: string[];
  position: "center" | "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    target: null,
    title: "Welcome to OpenReel",
    description: "Let's take a quick tour of the editor",
    position: "center",
  },
  {
    id: "assets",
    target: "[data-tour='assets']",
    title: "Assets Panel",
    description: "Your creative toolkit. Import media, generate AI content, add shapes, stickers, and custom SVGs.",
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
    title: "Timeline",
    description: "Arrange and edit your clips. Drag to move, drag edges to trim.",
    tips: ["Press S to split clips", "Space to play/pause", "Scroll to zoom"],
    position: "top",
  },
  {
    id: "preview",
    target: "[data-tour='preview']",
    title: "Preview",
    description: "Watch your video in real-time as you edit.",
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
    title: "Inspector",
    description:
      "Select a clip to see its properties. Add effects, adjust colors, animate.",
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
    title: "You're Ready!",
    description: "Start creating! Press ? anytime for keyboard shortcuts.",
    position: "center",
  },
];

export const ONBOARDING_KEY = "openreel-onboarding-complete";
