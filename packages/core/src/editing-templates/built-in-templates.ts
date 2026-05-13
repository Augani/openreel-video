import type {
  EditingTemplate,
  EditingTemplateBinding,
  EditingTemplateOverlay,
  EditingTemplateTransform,
} from "./types";

const full = "full" as const;

const bind = (controlId: string): EditingTemplateBinding => ({ controlId });

const transform = (
  x: number,
  y: number,
  scaleX: number = 1,
  scaleY: number = 1,
  rotation: number = 0,
  anchorX: number = 0.5,
  anchorY: number = 0.5,
): EditingTemplateTransform => ({
  position: { x, y },
  scale: { x: scaleX, y: scaleY },
  rotation,
  anchor: { x: anchorX, y: anchorY },
  opacity: 1,
});

const textOverlay = (overlay: EditingTemplate["recipe"]["overlays"][number]): EditingTemplateOverlay => overlay;

const shapeOverlay = (overlay: EditingTemplate["recipe"]["overlays"][number]): EditingTemplateOverlay => overlay;

export const BUILT_IN_EDITING_TEMPLATES: readonly EditingTemplate[] = [
  {
    id: "cinema-letterbox",
    name: "Cinematic Letterbox",
    description: "Wide-screen bars with grain and vignette.",
    category: "cinema",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["cinema", "letterbox", "grain"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "grainAmount", label: "Grain", type: "number", defaultValue: 0.3, min: 0, max: 1, step: 0.05 },
      { id: "barOpacity", label: "Bar Opacity", type: "number", defaultValue: 1, min: 0, max: 1, step: 0.05 },
    ],
    recipe: {
      effects: [
        { type: "film-grain", params: { intensity: bind("grainAmount"), size: 1.5 } },
        { type: "vignette", params: { intensity: 0.4, radius: 0.8 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.05),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 120,
            style: { fill: { type: "solid", color: "#000000", opacity: bind("barOpacity") }, stroke: { color: "#000000", width: 0, opacity: 0 } },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.95),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 120,
            style: { fill: { type: "solid", color: "#000000", opacity: bind("barOpacity") }, stroke: { color: "#000000", width: 0, opacity: 0 } },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "cinema-light-frame",
    name: "Light Frame",
    description: "A subtle warm edge frame for cinematic shots.",
    category: "cinema",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["cinema", "frame", "warm"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "frameOpacity", label: "Frame Opacity", type: "number", defaultValue: 0.22, min: 0, max: 0.8, step: 0.02 },
    ],
    recipe: {
      effects: [
        { type: "contrast", params: { value: 0.08 } },
        { type: "brightness", params: { value: 0.03 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.5),
          blendOpacity: bind("frameOpacity"),
          content: {
            shapeType: "rectangle",
            width: 1820,
            height: 980,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "#f8c89a", width: 8, opacity: 1 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "cinema-warm-fade",
    name: "Warm Fade",
    description: "Soft warm grade for lifestyle and travel cuts.",
    category: "cinema",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["cinema", "warm", "travel"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "warmth", label: "Warmth", type: "number", defaultValue: 0.14, min: 0, max: 0.4, step: 0.01 },
    ],
    recipe: {
      effects: [
        { type: "brightness", params: { value: 0.02 } },
        { type: "contrast", params: { value: 0.1 } },
        { type: "saturation", params: { value: bind("warmth") } },
      ],
      overlays: [],
      audioEffects: [],
    },
  },
  {
    id: "glitch-digital",
    name: "Digital Glitch",
    description: "RGB drift with moving scanline accents.",
    category: "glitch",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["glitch", "rgb", "scanline"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "glitchAmount", label: "Glitch", type: "number", defaultValue: 0.18, min: 0, max: 0.6, step: 0.02 },
    ],
    recipe: {
      effects: [
        { type: "chromatic-aberration", params: { intensity: 4 } },
        { type: "film-grain", params: { intensity: bind("glitchAmount"), size: 2 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.2),
          keyframes: [
            { time: 0, property: "position.y", value: 0.18 },
            { time: 0.4, property: "position.y", value: 0.74 },
            { time: 0.8, property: "position.y", value: 0.32 },
            { time: 1, property: "position.y", value: 0.86 },
          ],
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 32,
            style: {
              fill: { type: "solid", color: "rgba(0,255,255,0.12)", opacity: 1 },
              stroke: { color: "rgba(0,255,255,0.12)", width: 0, opacity: 0 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "glitch-rgb-scan",
    name: "RGB Scan",
    description: "Thin scanlines and channel separation.",
    category: "glitch",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["glitch", "scan", "rgb"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "chromatic-aberration", params: { intensity: 6 } },
        { type: "contrast", params: { value: 0.08 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.5),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 1020,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(255,0,128,0.25)", width: 2, opacity: 1 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "glitch-static-frame",
    name: "Static Frame",
    description: "Noisy border treatment with light distortion.",
    category: "glitch",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["glitch", "static", "noise"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "film-grain", params: { intensity: 0.45, size: 2.3 } },
        { type: "contrast", params: { value: 0.15 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.5),
          content: {
            shapeType: "rectangle",
            width: 1860,
            height: 1020,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(255,255,255,0.18)", width: 12, opacity: 1 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "retro-vhs",
    name: "VHS Tape",
    description: "Classic tape softness with transport text.",
    category: "retro",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["retro", "vhs", "tape"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "chromatic-aberration", params: { intensity: 3 } },
        { type: "film-grain", params: { intensity: 0.6, size: 2.5 } },
        { type: "blur", params: { radius: 0.5 } },
        { type: "vignette", params: { intensity: 0.45, radius: 0.7 } },
      ],
      overlays: [
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.08, 0.9, 1, 1, 0, 0, 0.5),
          content: {
            text: "PLAY >",
            style: { fontFamily: "JetBrains Mono", fontSize: 28, color: "rgba(255,255,255,0.85)", fontWeight: 600, textAlign: "left", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 1 },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.92, 0.9, 1, 1, 0, 1, 0.5),
          content: {
            text: "SP",
            style: { fontFamily: "JetBrains Mono", fontSize: 22, color: "rgba(255,255,255,0.65)", fontWeight: 600, textAlign: "right", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 1 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "retro-crt-monitor",
    name: "CRT Monitor",
    description: "Soft corner frame and green terminal vibe.",
    category: "retro",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["retro", "crt", "monitor"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "contrast", params: { value: 0.12 } },
        { type: "brightness", params: { value: -0.04 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.5),
          content: {
            shapeType: "rectangle",
            width: 1840,
            height: 1000,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(105,255,173,0.25)", width: 6, opacity: 1 },
              cornerRadius: 18,
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "retro-old-film",
    name: "Old Film",
    description: "High grain monochrome with gate marker text.",
    category: "retro",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["retro", "film", "mono"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "film-grain", params: { intensity: 0.75, size: 2.8 } },
        { type: "contrast", params: { value: 0.22 } },
        { type: "brightness", params: { value: -0.08 } },
      ],
      overlays: [
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "intro", duration: 1.2 },
          transform: transform(0.08, 0.08, 1, 1, 0, 0, 0.5),
          content: {
            text: "ROLL 04",
            style: { fontFamily: "JetBrains Mono", fontSize: 22, color: "rgba(255,255,255,0.8)", fontWeight: 600, textAlign: "left", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 1 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "retro-sepia-drift",
    name: "Sepia Drift",
    description: "Subtle vintage warmth with a soft border.",
    category: "retro",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["retro", "sepia", "vintage"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "brightness", params: { value: 0.04 } },
        { type: "contrast", params: { value: 0.06 } },
        { type: "saturation", params: { value: -0.08 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.5),
          blendOpacity: 0.3,
          content: {
            shapeType: "rectangle",
            width: 1860,
            height: 1020,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "#7d5b39", width: 10, opacity: 1 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "social-recording",
    name: "Recording Camera",
    description: "Classic REC indicator, timer, and frame border.",
    category: "social",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["social", "rec", "recording"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.045, 0.055),
          emphasisAnimation: { type: "pulse", speed: 1, intensity: 0.55, loop: true },
          content: {
            shapeType: "circle",
            width: 14,
            height: 14,
            style: {
              fill: { type: "solid", color: "#ff4d4d", opacity: 1 },
              stroke: { color: "#ff4d4d", width: 0, opacity: 0 },
            },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.075, 0.055, 1, 1, 0, 0, 0.5),
          content: {
            text: "REC",
            style: { fontFamily: "Inter", fontSize: 18, color: "#ff4d4d", fontWeight: 700, textAlign: "left", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 2 },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.94, 0.06, 1, 1, 0, 1, 0.5),
          content: {
            text: "00:00:00",
            style: { fontFamily: "JetBrains Mono", fontSize: 18, color: "rgba(255,255,255,0.85)", fontWeight: 600, textAlign: "right", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 1 },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.5),
          content: {
            shapeType: "rectangle",
            width: 1760,
            height: 920,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(255,255,255,0.32)", width: 4, opacity: 1 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "social-facecam-frame",
    name: "Facecam Frame",
    description: "Corner frame for reaction and gameplay clips.",
    category: "social",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["social", "facecam", "reaction"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.78, 0.76),
          content: {
            shapeType: "rectangle",
            width: 560,
            height: 320,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(255,255,255,0.9)", width: 6, opacity: 1 },
              cornerRadius: 22,
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "social-countdown-lead",
    name: "Countdown Lead",
    description: "Short intro count-in for tutorials and hooks.",
    category: "social",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["social", "countdown", "hook"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [],
      overlays: [
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "intro", duration: 2 },
          transform: transform(0.5, 0.18),
          keyframes: [
            { time: 0, property: "opacity", value: 0 },
            { time: 0.2, property: "opacity", value: 1 },
            { time: 0.8, property: "opacity", value: 1 },
            { time: 1, property: "opacity", value: 0 },
          ],
          content: {
            text: "3 2 1",
            style: { fontFamily: "Inter", fontSize: 82, color: "#ffffff", fontWeight: 800, textAlign: "center", verticalAlign: "middle", lineHeight: 1, letterSpacing: 8 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "social-comment-pop",
    name: "Comment Pop",
    description: "Pinned comment bubble for social callouts.",
    category: "social",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["social", "comment", "bubble"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: { kind: "intro", duration: 3 },
          transform: transform(0.5, 0.15),
          content: {
            shapeType: "rectangle",
            width: 1080,
            height: 140,
            style: {
              fill: { type: "solid", color: "rgba(255,255,255,0.92)", opacity: 1 },
              stroke: { color: "rgba(0,0,0,0.08)", width: 2, opacity: 1 },
              cornerRadius: 999,
            },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "intro", duration: 3 },
          transform: transform(0.5, 0.15),
          content: {
            text: "Pinned: Drop your best take below",
            style: { fontFamily: "Inter", fontSize: 30, color: "#111111", fontWeight: 700, textAlign: "center", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 0 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "branding-watermark-drift",
    name: "Watermark Drift",
    description: "Soft moving corner watermark for brand protection.",
    category: "branding",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["branding", "watermark", "corner"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "watermarkText", label: "Watermark", type: "text", defaultValue: "@openreel" },
      { id: "watermarkOpacity", label: "Opacity", type: "number", defaultValue: 0.45, min: 0.1, max: 1, step: 0.05 },
    ],
    recipe: {
      effects: [],
      overlays: [
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.88, 0.92, 1, 1, 0, 1, 0.5),
          keyframes: [
            { time: 0, property: "position.x", value: 0.88 },
            { time: 0.5, property: "position.x", value: 0.84 },
            { time: 1, property: "position.x", value: 0.88 },
          ],
          blendOpacity: bind("watermarkOpacity"),
          content: {
            text: "{control.watermarkText}",
            style: { fontFamily: "Inter", fontSize: 22, color: "rgba(255,255,255,0.92)", fontWeight: 600, textAlign: "right", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 0.5 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "branding-copyright",
    name: "Moving Copyright",
    description: "Full-width copyright crawl for delivered cuts.",
    category: "branding",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["branding", "copyright", "crawl"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [],
      overlays: [
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.5, 0.95),
          keyframes: [
            { time: 0, property: "position.x", value: 1.2 },
            { time: 0.1, property: "position.x", value: 0.5 },
            { time: 0.9, property: "position.x", value: 0.5 },
            { time: 1, property: "position.x", value: -0.2 },
          ],
          content: {
            text: "Copyright {year} All Rights Reserved",
            style: { fontFamily: "Inter", fontSize: 18, color: "rgba(255,255,255,0.7)", fontWeight: 500, textAlign: "center", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 0.5 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "branding-lower-third",
    name: "Lower Third",
    description: "Simple branded name tag.",
    category: "branding",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["branding", "lower third", "name"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "name", label: "Name", type: "text", defaultValue: "Open Reel" },
      { id: "role", label: "Role", type: "text", defaultValue: "Creator" },
      { id: "accent", label: "Accent", type: "color", defaultValue: "#7bf1a8" },
    ],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: { kind: "intro", duration: 4 },
          transform: transform(0.18, 0.88, 1, 1, 0, 0, 0.5),
          content: {
            shapeType: "rectangle",
            width: 520,
            height: 124,
            style: {
              fill: { type: "solid", color: "rgba(7,7,10,0.76)", opacity: 1 },
              stroke: { color: bind("accent"), width: 4, opacity: 1 },
              cornerRadius: 18,
            },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "intro", duration: 4 },
          transform: transform(0.11, 0.865, 1, 1, 0, 0, 0.5),
          content: {
            text: "{control.name}",
            style: { fontFamily: "Inter", fontSize: 34, color: "#ffffff", fontWeight: 800, textAlign: "left", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 0 },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "intro", duration: 4 },
          transform: transform(0.11, 0.905, 1, 1, 0, 0, 0.5),
          content: {
            text: "{control.role}",
            style: { fontFamily: "Inter", fontSize: 22, color: "rgba(255,255,255,0.72)", fontWeight: 500, textAlign: "left", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 0 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "branding-subscribe-tag",
    name: "Subscribe Tag",
    description: "End-card subscribe banner.",
    category: "branding",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["branding", "subscribe", "end card"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: { kind: "outro", duration: 3.5 },
          transform: transform(0.5, 0.88),
          content: {
            shapeType: "rectangle",
            width: 760,
            height: 110,
            style: {
              fill: { type: "solid", color: "#ff3b30", opacity: 1 },
              stroke: { color: "#ff3b30", width: 0, opacity: 0 },
              cornerRadius: 999,
            },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "outro", duration: 3.5 },
          transform: transform(0.5, 0.88),
          content: {
            text: "Subscribe for the next drop",
            style: { fontFamily: "Inter", fontSize: 28, color: "#ffffff", fontWeight: 800, textAlign: "center", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 0.5 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "color-warm-pop",
    name: "Warm Pop",
    description: "Golden warmth with gentle contrast.",
    category: "color",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["color", "warm", "pop"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "brightness", params: { value: 0.05 } },
        { type: "contrast", params: { value: 0.12 } },
        { type: "saturation", params: { value: 0.14 } },
      ],
      overlays: [],
      audioEffects: [],
    },
  },
  {
    id: "color-cool-bloom",
    name: "Cool Bloom",
    description: "Softer cooler palette for night and tech footage.",
    category: "color",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["color", "cool", "tech"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "brightness", params: { value: -0.02 } },
        { type: "contrast", params: { value: 0.08 } },
        { type: "saturation", params: { value: -0.08 } },
      ],
      overlays: [],
      audioEffects: [],
    },
  },
  {
    id: "color-dramatic-noir",
    name: "Dramatic Noir",
    description: "High-contrast moody look.",
    category: "color",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["color", "dramatic", "noir"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "contrast", params: { value: 0.2 } },
        { type: "brightness", params: { value: -0.08 } },
        { type: "vignette", params: { intensity: 0.55, radius: 0.72 } },
      ],
      overlays: [],
      audioEffects: [],
    },
  },
  {
    id: "color-vintage-wash",
    name: "Vintage Wash",
    description: "Low-contrast faded stock feel.",
    category: "color",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["color", "vintage", "fade"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "brightness", params: { value: 0.08 } },
        { type: "contrast", params: { value: -0.05 } },
        { type: "saturation", params: { value: -0.12 } },
      ],
      overlays: [],
      audioEffects: [],
    },
  },
  {
    id: "overlay-focus-frame",
    name: "Focus Frame",
    description: "Center guide frame with crosshair accents.",
    category: "overlay",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["overlay", "focus", "frame"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.5),
          content: {
            shapeType: "rectangle",
            width: 1360,
            height: 760,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(255,255,255,0.4)", width: 4, opacity: 1 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.5),
          content: {
            shapeType: "line",
            width: 120,
            height: 6,
            style: {
              fill: { type: "solid", color: "rgba(255,255,255,0.55)", opacity: 1 },
              stroke: { color: "rgba(255,255,255,0.55)", width: 0, opacity: 0 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "overlay-soft-border",
    name: "Soft Border",
    description: "Thin elegant border for editorial framing.",
    category: "overlay",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["overlay", "border", "editorial"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.5),
          content: {
            shapeType: "rectangle",
            width: 1840,
            height: 1000,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(255,255,255,0.24)", width: 5, opacity: 1 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "overlay-spotlight-title",
    name: "Spotlight Title",
    description: "Headline treatment for hero moments.",
    category: "text-effects",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["text", "headline", "hero"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "headline", label: "Headline", type: "text", defaultValue: "Headline" },
    ],
    recipe: {
      effects: [],
      overlays: [
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "intro", duration: 4 },
          transform: transform(0.5, 0.18),
          content: {
            text: "{control.headline}",
            style: { fontFamily: "Inter", fontSize: 88, color: "#ffffff", fontWeight: 800, textAlign: "center", verticalAlign: "middle", lineHeight: 0.95, letterSpacing: -1 },
            animation: { preset: "slide-up", inDuration: 0.45, outDuration: 0.35, params: { easing: "easeOutCubic" } },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "text-kinetic-punch",
    name: "Kinetic Punch",
    description: "Bold text punch-in for transitions and hooks.",
    category: "text-effects",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["text", "kinetic", "hook"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "caption", label: "Caption", type: "text", defaultValue: "Watch this" },
      { id: "accent", label: "Accent", type: "color", defaultValue: "#ffb100" },
    ],
    recipe: {
      effects: [],
      overlays: [
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "intro", duration: 3 },
          transform: transform(0.5, 0.82),
          emphasisAnimation: { type: "bounce", speed: 1, intensity: 0.5, loop: true },
          content: {
            text: "{control.caption}",
            style: { fontFamily: "Inter", fontSize: 56, color: bind("accent"), fontWeight: 900, textAlign: "center", verticalAlign: "middle", lineHeight: 1, letterSpacing: 0 },
            animation: { preset: "pop", inDuration: 0.3, outDuration: 0.25, params: { easing: "easeOutBack" } },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "text-stamp-upper",
    name: "Stamp Upper",
    description: "Upper-third stamp for chapter labels.",
    category: "text-effects",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["text", "stamp", "chapter"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "label", label: "Label", type: "text", defaultValue: "Chapter One" },
    ],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: { kind: "intro", duration: 3.5 },
          transform: transform(0.5, 0.12),
          content: {
            shapeType: "rectangle",
            width: 720,
            height: 92,
            style: {
              fill: { type: "solid", color: "rgba(255,255,255,0.08)", opacity: 1 },
              stroke: { color: "rgba(255,255,255,0.42)", width: 2, opacity: 1 },
              cornerRadius: 999,
            },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "intro", duration: 3.5 },
          transform: transform(0.5, 0.12),
          content: {
            text: "{control.label}",
            style: { fontFamily: "Inter", fontSize: 32, color: "#ffffff", fontWeight: 700, textAlign: "center", verticalAlign: "middle", lineHeight: 1, letterSpacing: 2 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "text-neon-tag",
    name: "Neon Tag",
    description: "Bright tag for music and nightlife content.",
    category: "text-effects",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["text", "neon", "music"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "tag", label: "Tag", type: "text", defaultValue: "LIVE SET" },
    ],
    recipe: {
      effects: [],
      overlays: [
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.13, 0.14, 1, 1, 0, 0, 0.5),
          emphasisAnimation: { type: "glow", speed: 1, intensity: 0.6, loop: true },
          content: {
            text: "{control.tag}",
            style: { fontFamily: "Inter", fontSize: 34, color: "#66f7ff", fontWeight: 800, textAlign: "left", verticalAlign: "middle", lineHeight: 1, letterSpacing: 1 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "social-live-badge",
    name: "Live Badge",
    description: "Pulsing LIVE indicator for stream-style overlays.",
    category: "social",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["social", "live", "stream"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.92, 0.06),
          emphasisAnimation: { type: "pulse", speed: 0.8, intensity: 0.4, loop: true },
          content: {
            shapeType: "rectangle",
            width: 120,
            height: 40,
            style: {
              fill: { type: "solid", color: "#ff0000", opacity: 1 },
              stroke: { color: "#ff0000", width: 0, opacity: 0 },
              cornerRadius: 8,
            },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.92, 0.06),
          content: {
            text: "LIVE",
            style: { fontFamily: "Inter", fontSize: 16, color: "#ffffff", fontWeight: 800, textAlign: "center", verticalAlign: "middle", lineHeight: 1, letterSpacing: 2 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "social-hashtag-strip",
    name: "Hashtag Strip",
    description: "Bottom hashtag bar for social video posts.",
    category: "social",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["social", "hashtag", "bar"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "tags", label: "Hashtags", type: "text", defaultValue: "#openreel #editing #creative" },
    ],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.94),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 56,
            style: {
              fill: { type: "solid", color: "rgba(0,0,0,0.6)", opacity: 1 },
              stroke: { color: "rgba(0,0,0,0)", width: 0, opacity: 0 },
            },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.5, 0.94),
          content: {
            text: "{control.tags}",
            style: { fontFamily: "Inter", fontSize: 18, color: "rgba(255,255,255,0.9)", fontWeight: 600, textAlign: "center", verticalAlign: "middle", lineHeight: 1, letterSpacing: 0.5 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "cinema-anamorphic-flare",
    name: "Anamorphic Flare",
    description: "Top and bottom bars with blue lens flare accents.",
    category: "cinema",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["cinema", "anamorphic", "flare"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "contrast", params: { value: 0.06 } },
        { type: "vignette", params: { intensity: 0.3, radius: 0.85 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.035),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 80,
            style: {
              fill: { type: "solid", color: "#000000", opacity: 1 },
              stroke: { color: "#000000", width: 0, opacity: 0 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.965),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 80,
            style: {
              fill: { type: "solid", color: "#000000", opacity: 1 },
              stroke: { color: "#000000", width: 0, opacity: 0 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.3, 0.5),
          keyframes: [
            { time: 0, property: "position.x", value: 0.1 },
            { time: 0.5, property: "position.x", value: 0.7 },
            { time: 1, property: "position.x", value: 0.1 },
          ],
          content: {
            shapeType: "rectangle",
            width: 320,
            height: 4,
            style: {
              fill: { type: "solid", color: "rgba(100,180,255,0.15)", opacity: 1 },
              stroke: { color: "rgba(100,180,255,0)", width: 0, opacity: 0 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "cinema-noir-bars",
    name: "Noir Bars",
    description: "Heavy letterbox with deep contrast for dramatic scenes.",
    category: "cinema",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["cinema", "noir", "dramatic"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "contrast", params: { value: 0.18 } },
        { type: "brightness", params: { value: -0.06 } },
        { type: "vignette", params: { intensity: 0.6, radius: 0.65 } },
        { type: "saturation", params: { value: -0.15 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.06),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 140,
            style: {
              fill: { type: "solid", color: "#000000", opacity: 1 },
              stroke: { color: "#000000", width: 0, opacity: 0 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.94),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 140,
            style: {
              fill: { type: "solid", color: "#000000", opacity: 1 },
              stroke: { color: "#000000", width: 0, opacity: 0 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "overlay-grid-guide",
    name: "Grid Guide",
    description: "Rule of thirds grid for composition reference.",
    category: "overlay",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["overlay", "grid", "composition"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "gridOpacity", label: "Grid Opacity", type: "number", defaultValue: 0.2, min: 0.05, max: 0.6, step: 0.05 },
    ],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.333, 0.5),
          content: {
            shapeType: "rectangle",
            width: 2,
            height: 1080,
            style: {
              fill: { type: "solid", color: "rgba(255,255,255,0.2)", opacity: bind("gridOpacity") },
              stroke: { color: "rgba(255,255,255,0)", width: 0, opacity: 0 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.666, 0.5),
          content: {
            shapeType: "rectangle",
            width: 2,
            height: 1080,
            style: {
              fill: { type: "solid", color: "rgba(255,255,255,0.2)", opacity: bind("gridOpacity") },
              stroke: { color: "rgba(255,255,255,0)", width: 0, opacity: 0 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.333),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 2,
            style: {
              fill: { type: "solid", color: "rgba(255,255,255,0.2)", opacity: bind("gridOpacity") },
              stroke: { color: "rgba(255,255,255,0)", width: 0, opacity: 0 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.666),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 2,
            style: {
              fill: { type: "solid", color: "rgba(255,255,255,0.2)", opacity: bind("gridOpacity") },
              stroke: { color: "rgba(255,255,255,0)", width: 0, opacity: 0 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "overlay-corner-brackets",
    name: "Corner Brackets",
    description: "Elegant corner frame markers for cinematic focus.",
    category: "overlay",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["overlay", "brackets", "frame"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.08, 0.1, 1, 1, 0, 0, 0),
          content: {
            shapeType: "rectangle",
            width: 80,
            height: 80,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(255,255,255,0.6)", width: 3, opacity: 1 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.92, 0.1, 1, 1, 0, 1, 0),
          content: {
            shapeType: "rectangle",
            width: 80,
            height: 80,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(255,255,255,0.6)", width: 3, opacity: 1 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.08, 0.9, 1, 1, 0, 0, 1),
          content: {
            shapeType: "rectangle",
            width: 80,
            height: 80,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(255,255,255,0.6)", width: 3, opacity: 1 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.92, 0.9, 1, 1, 0, 1, 1),
          content: {
            shapeType: "rectangle",
            width: 80,
            height: 80,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "rgba(255,255,255,0.6)", width: 3, opacity: 1 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "text-subtitle-bar",
    name: "Subtitle Bar",
    description: "Bottom subtitle with dark backing for readability.",
    category: "text-effects",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["text", "subtitle", "caption"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "subtitle", label: "Subtitle", type: "text", defaultValue: "Your subtitle text here" },
    ],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.88),
          content: {
            shapeType: "rectangle",
            width: 1400,
            height: 64,
            style: {
              fill: { type: "solid", color: "rgba(0,0,0,0.7)", opacity: 1 },
              stroke: { color: "rgba(0,0,0,0)", width: 0, opacity: 0 },
              cornerRadius: 12,
            },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.5, 0.88),
          content: {
            text: "{control.subtitle}",
            style: { fontFamily: "Inter", fontSize: 28, color: "#ffffff", fontWeight: 600, textAlign: "center", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 0 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "text-quote-block",
    name: "Quote Block",
    description: "Centered quote with decorative marks.",
    category: "text-effects",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["text", "quote", "editorial"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "quote", label: "Quote", type: "text", defaultValue: "Create something worth sharing." },
    ],
    recipe: {
      effects: [],
      overlays: [
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "intro", duration: 5 },
          transform: transform(0.5, 0.42),
          content: {
            text: "“",
            style: { fontFamily: "Inter", fontSize: 120, color: "rgba(255,255,255,0.2)", fontWeight: 900, textAlign: "center", verticalAlign: "middle", lineHeight: 0.6, letterSpacing: 0 },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "intro", duration: 5 },
          transform: transform(0.5, 0.5),
          content: {
            text: "{control.quote}",
            style: { fontFamily: "Inter", fontSize: 36, color: "#ffffff", fontWeight: 500, textAlign: "center", verticalAlign: "middle", lineHeight: 1.4, letterSpacing: 0 },
            animation: { preset: "fade", inDuration: 0.6, outDuration: 0.4, params: { easing: "easeOutCubic" } },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "color-teal-orange",
    name: "Teal & Orange",
    description: "Hollywood color grading — cool shadows, warm highlights.",
    category: "color",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["color", "teal", "orange", "hollywood"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "contrast", params: { value: 0.1 } },
        { type: "saturation", params: { value: 0.12 } },
        { type: "brightness", params: { value: 0.02 } },
      ],
      overlays: [],
      audioEffects: [],
    },
  },
  {
    id: "color-monochrome",
    name: "Monochrome",
    description: "Clean black and white with lifted blacks.",
    category: "color",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["color", "monochrome", "black", "white"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "saturation", params: { value: -1 } },
        { type: "contrast", params: { value: 0.15 } },
        { type: "brightness", params: { value: 0.04 } },
      ],
      overlays: [],
      audioEffects: [],
    },
  },
  {
    id: "glitch-datamosh",
    name: "Datamosh",
    description: "Heavy grain and color separation for chaotic energy.",
    category: "glitch",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["glitch", "datamosh", "chaos"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "chromatic-aberration", params: { intensity: 8 } },
        { type: "film-grain", params: { intensity: 0.55, size: 3 } },
        { type: "contrast", params: { value: 0.2 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.4),
          keyframes: [
            { time: 0, property: "position.y", value: 0.12 },
            { time: 0.15, property: "position.y", value: 0.88 },
            { time: 0.3, property: "position.y", value: 0.25 },
            { time: 0.5, property: "position.y", value: 0.72 },
            { time: 0.7, property: "position.y", value: 0.4 },
            { time: 0.85, property: "position.y", value: 0.92 },
            { time: 1, property: "position.y", value: 0.15 },
          ],
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 16,
            style: {
              fill: { type: "solid", color: "rgba(255,0,100,0.08)", opacity: 1 },
              stroke: { color: "rgba(255,0,100,0)", width: 0, opacity: 0 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "branding-end-card",
    name: "End Card",
    description: "Full outro card with name and call to action.",
    category: "branding",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["branding", "end card", "outro"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "channel", label: "Channel Name", type: "text", defaultValue: "Your Channel" },
      { id: "cta", label: "Call to Action", type: "text", defaultValue: "Subscribe for more" },
    ],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: { kind: "outro", duration: 5 },
          transform: transform(0.5, 0.5),
          content: {
            shapeType: "rectangle",
            width: 1920,
            height: 1080,
            style: {
              fill: { type: "solid", color: "rgba(0,0,0,0.85)", opacity: 1 },
              stroke: { color: "rgba(0,0,0,0)", width: 0, opacity: 0 },
            },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "outro", duration: 5 },
          transform: transform(0.5, 0.42),
          content: {
            text: "{control.channel}",
            style: { fontFamily: "Inter", fontSize: 56, color: "#ffffff", fontWeight: 800, textAlign: "center", verticalAlign: "middle", lineHeight: 1, letterSpacing: -1 },
            animation: { preset: "fade", inDuration: 0.5, outDuration: 0.3, params: { easing: "easeOutCubic" } },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: { kind: "outro", duration: 5 },
          transform: transform(0.5, 0.55),
          content: {
            text: "{control.cta}",
            style: { fontFamily: "Inter", fontSize: 24, color: "rgba(255,255,255,0.7)", fontWeight: 500, textAlign: "center", verticalAlign: "middle", lineHeight: 1, letterSpacing: 0.5 },
            animation: { preset: "fade", inDuration: 0.7, outDuration: 0.3, params: { easing: "easeOutCubic" } },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "social-viewer-count",
    name: "Viewer Count",
    description: "Animated viewer/like counter badge.",
    category: "social",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["social", "viewers", "counter"],
    supportedTargets: ["video", "image"],
    controls: [
      { id: "count", label: "Count", type: "text", defaultValue: "1.2K watching" },
    ],
    recipe: {
      effects: [],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.92, 0.94),
          content: {
            shapeType: "rectangle",
            width: 180,
            height: 36,
            style: {
              fill: { type: "solid", color: "rgba(0,0,0,0.65)", opacity: 1 },
              stroke: { color: "rgba(255,255,255,0.15)", width: 1, opacity: 1 },
              cornerRadius: 18,
            },
          },
        }),
        textOverlay({
          type: "text",
          trackType: "text",
          timing: full,
          transform: transform(0.92, 0.94),
          content: {
            text: "{control.count}",
            style: { fontFamily: "Inter", fontSize: 13, color: "rgba(255,255,255,0.9)", fontWeight: 600, textAlign: "center", verticalAlign: "middle", lineHeight: 1, letterSpacing: 0.3 },
          },
        }),
      ],
      audioEffects: [],
    },
  },
  {
    id: "retro-polaroid",
    name: "Polaroid",
    description: "White border frame with warm vintage tones.",
    category: "retro",
    thumbnailUrl: null,
    previewUrl: null,
    tags: ["retro", "polaroid", "frame"],
    supportedTargets: ["video", "image"],
    recipe: {
      effects: [
        { type: "brightness", params: { value: 0.03 } },
        { type: "saturation", params: { value: -0.06 } },
        { type: "contrast", params: { value: 0.05 } },
      ],
      overlays: [
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.5),
          content: {
            shapeType: "rectangle",
            width: 1700,
            height: 900,
            style: {
              fill: { type: "none", opacity: 0 },
              stroke: { color: "#f5f0e8", width: 40, opacity: 1 },
            },
          },
        }),
        shapeOverlay({
          type: "shape",
          trackType: "graphics",
          timing: full,
          transform: transform(0.5, 0.94),
          content: {
            shapeType: "rectangle",
            width: 1700,
            height: 80,
            style: {
              fill: { type: "solid", color: "#f5f0e8", opacity: 1 },
              stroke: { color: "#f5f0e8", width: 0, opacity: 0 },
            },
          },
        }),
      ],
      audioEffects: [],
    },
  },
] as const;