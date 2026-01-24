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
      "Learn how to create professional animations with keyframes, motion paths, and particle effects.",
    position: "center",
  },
  {
    id: "keyframes-inspector",
    target: "[data-tour='inspector']",
    title: "Keyframe Animation",
    description:
      "Select any clip and expand the Keyframes section in the Inspector. Add keyframes to animate position, scale, rotation, and opacity over time.",
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
      "Click the expand arrow on any track header to reveal keyframe sub-tracks. Drag keyframe diamonds to adjust timing visually.",
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
      "Open the Keyframe Editor panel from the toolbar for precise control. Edit value curves, copy/paste keyframes, and fine-tune animations.",
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
      "19 text animation styles available",
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
