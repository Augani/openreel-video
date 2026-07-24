export interface MoGraphTourStep {
  id: string;
  target: string | null;
  title: string;
  description: string;
  tips?: string[];
  position: "center" | "top" | "bottom" | "left" | "right";
  action?: "highlight" | "demo";
}

export const MOGRAPH_TOUR_STEPS: MoGraphTourStep[] = [
  {
    id: "intro",
    target: null,
    title: "Motion Graphics & Animation",
    description:
      "A quick map of the current animation tools: keyframes in the Inspector, timing in the timeline, and motion scenes from the left action rail.",
    position: "center",
  },
  {
    id: "keyframes-inspector",
    target: "[data-tour='inspector']",
    title: "Keyframe Animation",
    description:
      "Select a clip and open its animation controls in the Inspector. Add keyframes to animate position, scale, rotation, opacity, and more.",
    tips: [
      "Click the diamond icon to add a keyframe at current time",
      "Each property can have its own animation curve",
      "Choose from 30+ easing presets for smooth motion",
    ],
    position: "left",
  },
  {
    id: "keyframes-timeline",
    target: "[data-tour='timeline']",
    title: "Timeline Keyframe View",
    description:
      "The lower timeline is where animation timing becomes visible. Expand tracks and drag keyframe diamonds to adjust timing.",
    tips: [
      "Diamond markers show keyframe positions",
      "Drag horizontally to change timing",
      "Click the curve between keyframes to edit easing",
    ],
    position: "top",
  },
  {
    id: "keyframe-editor",
    target: "[data-tour='toolbar']",
    title: "Graph Editor",
    description:
      "Use the action rail on the far left to open animation utilities, including the Keyframe Editor for precise curve control.",
    tips: [
      "Drag keyframe points to adjust time and value",
      "Select multiple keyframes with Shift+click",
      "Apply easing presets to selected keyframes",
    ],
    position: "bottom",
  },
  {
    id: "motion-path",
    target: "[data-tour='preview']",
    title: "Motion Paths",
    description:
      "Create smooth movement along custom paths. Enable Motion Path mode to draw bezier curves directly on the preview canvas.",
    tips: [
      "Click on the canvas to add path points",
      "Drag control handles to curve the path",
      "Elements follow the path as they animate",
      "Great for flying logos and dynamic text",
    ],
    position: "left",
  },
  {
    id: "particle-effects",
    target: "[data-tour='inspector']",
    title: "Particle Effects",
    description:
      "Add cinematic particle effects like confetti, sparkles, dust, and explosions. Find them in the Inspector's Particle Effects section.",
    tips: [
      "Choose from preset effects or customize",
      "Adjust particle count, speed, and colors",
      "Set timing for when effects appear",
      "Combine with keyframes for dramatic reveals",
    ],
    position: "left",
  },
  {
    id: "emphasis-animations",
    target: "[data-tour='inspector']",
    title: "Emphasis Animations",
    description:
      "Make elements pop with attention-grabbing animations. Pulse, bounce, shake, wiggle, and more - perfect for highlighting important content.",
    tips: [
      "24 built-in emphasis presets",
      "Set duration and loop count",
      "Combine with entrance/exit animations",
    ],
    position: "left",
  },
  {
    id: "text-animations",
    target: "[data-tour='inspector']",
    title: "Text Animation Presets",
    description:
      "Animate text with professional presets. Characters can fade in, slide, bounce, or appear with typewriter effects.",
    tips: [
      "25 text animation styles available",
      "Per-character or per-word animation",
      "Customize timing and easing",
    ],
    position: "left",
  },
  {
    id: "complete",
    target: null,
    title: "Start Animating!",
    description:
      "You're ready to create professional motion graphics. Select a clip and start experimenting with keyframes and effects.",
    tips: [
      "Press K to add a keyframe at playhead",
      "Use ? to see all keyboard shortcuts",
      "Combine effects for unique animations",
    ],
    position: "center",
  },
];

export const MOGRAPH_TOUR_KEY = "openreel-mograph-tour-complete";
