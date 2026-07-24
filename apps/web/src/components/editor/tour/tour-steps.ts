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
    description:
      "A quick map of the current editor layout: tools on the left, playback in the center, timeline below, and properties on the right.",
    position: "center",
  },
  {
    id: "assets",
    target: "[data-tour='assets']",
    title: "Media and Creative Tools",
    description:
      "This left panel changes with the tool rail: import media, add text, graphics, effects, and transitions from here.",
    tips: [
      "Media holds imported videos, audio, and images",
      "Use the left rail to switch to Text, Graphics, Effects, or Transitions",
      "Drag assets from this panel onto the timeline",
      "The import and record controls live at the top of this panel",
    ],
    position: "right",
  },
  {
    id: "timeline",
    target: "[data-tour='timeline']",
    title: "Timeline",
    description:
      "Arrange clips on tracks, trim edges, split selections, and use the zoom controls on the right side of the timeline bar.",
    tips: [
      "Press S to split the selected clip",
      "Drag clip edges to trim",
      "Use Add track when you need another video or audio lane",
    ],
    position: "top",
  },
  {
    id: "preview",
    target: "[data-tour='preview']",
    title: "Player",
    description:
      "The center player shows the current frame and playback controls. Crop, fit, and review changes here before export.",
    tips: [
      "Use playback controls under the canvas",
      "The green dot means live preview is active",
      "Fullscreen and fit tools are in the player controls",
    ],
    position: "left",
  },
  {
    id: "inspector",
    target: "[data-tour='inspector']",
    title: "Inspector",
    description:
      "Select a clip to edit its properties. Transform, color, effects, speed, and animation controls appear here.",
    tips: [
      "Use the top tabs to switch between property groups",
      "Color grading and effects are clip-specific",
      "Keyframe-capable controls show animation options when a clip is selected",
    ],
    position: "left",
  },
  {
    id: "complete",
    target: null,
    title: "You're Ready",
    description:
      "You now know where the main tools live. Use the action rail on the far left to reopen tours, settings, and project utilities.",
    position: "center",
  },
];

export const ONBOARDING_KEY = "openreel-onboarding-complete";
