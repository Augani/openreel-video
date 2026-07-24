import { DEFAULT_SHAPE_STYLE } from "../graphics/types";
import { motionEngine } from "./motion-engine";
import type { MotionTemplateCategory, MotionTemplateVariable } from "./motion-template-types";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeLayer,
  MotionTextLayer,
  MotionVariable,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

export interface MotionPreset {
  readonly id: string;
  readonly name: string;
  readonly category: MotionTemplateCategory;
  readonly description: string;
  readonly variables: readonly MotionTemplateVariable[];
  create(): MotionComposition;
}

interface PresetSceneOptions {
  readonly name: string;
  readonly duration: number;
  readonly backgroundColor: string;
  readonly width?: number;
  readonly height?: number;
  readonly variables: readonly MotionTemplateVariable[];
  readonly layers: (composition: MotionComposition) => MotionLayer[];
}

const TEMPLATE_CATEGORIES: readonly MotionTemplateCategory[] = [
  "ads",
  "app-ui-demos",
  "lower-thirds",
  "product-shots",
  "social-hooks",
  "kinetic-typography",
  "logo-reveals",
  "end-screens",
];

const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const MOTION_PRESETS: readonly MotionPreset[] = [
  createPreset({
    id: "motion-ad-card",
    name: "Ad Card",
    category: "ads",
    description: "A clean animated headline scene for short product ads.",
    variables: [
      textVariable("headline", "Headline", "Launch faster"),
      textVariable("subheadline", "Subheadline", "Turn product moments into polished ads."),
      colorVariable("brand-color", "Brand color", "#14b8a6"),
    ],
    create: () =>
      createPresetScene({
        name: "Ad Card",
        duration: 6,
        backgroundColor: "#111827",
        variables: [
          textVariable("headline", "Headline", "Launch faster"),
          textVariable("subheadline", "Subheadline", "Turn product moments into polished ads."),
          colorVariable("brand-color", "Brand color", "#14b8a6"),
        ],
        layers: (composition) => [
          shapeLayer(composition, {
            id: "ad-bg-wash",
            name: "Brand Wash",
            x: composition.width * 0.5,
            y: composition.height * 0.5,
            width: composition.width * 1.25,
            height: composition.height * 0.95,
            color: "#1f2937",
            opacity: 0.9,
            cornerRadius: 0,
            keyframes: scaleIn(0, 0.7, 0.96, 1),
          }),
          shapeLayer(composition, {
            id: "ad-accent-bar",
            name: "Accent Bar",
            x: composition.width * 0.5,
            y: composition.height * 0.68,
            width: 620,
            height: 18,
            color: "#14b8a6",
            cornerRadius: 999,
            variableBindings: [{ variableId: "brand-color", target: "shape.fill.color" }],
            keyframes: [
              kf("transform.scale.x", 0, 0, "ease-out"),
              kf("transform.scale.x", 0.8, 1, "ease-out"),
            ],
          }),
          textLayer(composition, {
            id: "ad-headline",
            name: "Headline",
            text: "Launch faster",
            x: composition.width * 0.5,
            y: composition.height * 0.46,
            fontSize: 112,
            fontWeight: 850,
            color: "#ffffff",
            variableBindings: [{ variableId: "headline", target: "text.content" }],
            keyframes: slideAndFade("y", 0, 0.75, composition.height * 0.46, 80, 0, 1),
          }),
          textLayer(composition, {
            id: "ad-subheadline",
            name: "Subheadline",
            text: "Turn product moments into polished ads.",
            x: composition.width * 0.5,
            y: composition.height * 0.57,
            fontSize: 42,
            fontWeight: 500,
            color: "#d1d5db",
            variableBindings: [{ variableId: "subheadline", target: "text.content" }],
            keyframes: fadeIn(0.35, 1),
          }),
        ],
      }),
  }),
  createPreset({
    id: "motion-app-ui-demo",
    name: "App UI Demo",
    category: "app-ui-demos",
    description: "Animated interface cards for product launch walkthroughs.",
    variables: [
      textVariable("headline", "Headline", "Your workflow, automated"),
      colorVariable("brand-color", "Brand color", "#60a5fa"),
    ],
    create: () =>
      createPresetScene({
        name: "App UI Demo",
        duration: 8,
        backgroundColor: "#0b1020",
        variables: [
          textVariable("headline", "Headline", "Your workflow, automated"),
          colorVariable("brand-color", "Brand color", "#60a5fa"),
        ],
        layers: (composition) => [
          shapeLayer(composition, {
            id: "ui-window",
            name: "App Window",
            x: composition.width * 0.5,
            y: composition.height * 0.55,
            width: 1060,
            height: 620,
            color: "#f8fafc",
            cornerRadius: 28,
            keyframes: slideAndFade("y", 0.15, 0.8, composition.height * 0.55, 90, 0, 1),
          }),
          shapeLayer(composition, {
            id: "ui-sidebar",
            name: "Sidebar",
            x: composition.width * 0.29,
            y: composition.height * 0.55,
            width: 250,
            height: 560,
            color: "#e2e8f0",
            cornerRadius: 18,
            keyframes: fadeIn(0.35, 0.9),
          }),
          shapeLayer(composition, {
            id: "ui-primary-card",
            name: "Primary Card",
            x: composition.width * 0.58,
            y: composition.height * 0.48,
            width: 560,
            height: 210,
            color: "#60a5fa",
            cornerRadius: 24,
            variableBindings: [{ variableId: "brand-color", target: "shape.fill.color" }],
            keyframes: slideAndFade("x", 0.55, 1.15, composition.width * 0.58, -90, 0, 1),
          }),
          shapeLayer(composition, {
            id: "ui-cursor",
            name: "Cursor",
            x: composition.width * 0.68,
            y: composition.height * 0.48,
            width: 42,
            height: 42,
            shapeType: "triangle",
            color: "#111827",
            keyframes: [
              kf("transform.position.x", 1.15, composition.width * 0.68, "ease"),
              kf("transform.position.y", 1.15, composition.height * 0.48, "ease"),
              kf("transform.position.x", 2.2, composition.width * 0.54, "ease-in-out"),
              kf("transform.position.y", 2.2, composition.height * 0.63, "ease-in-out"),
            ],
          }),
          textLayer(composition, {
            id: "ui-headline",
            name: "Headline",
            text: "Your workflow, automated",
            x: composition.width * 0.5,
            y: composition.height * 0.17,
            fontSize: 66,
            fontWeight: 800,
            color: "#ffffff",
            variableBindings: [{ variableId: "headline", target: "text.content" }],
            keyframes: fadeIn(0, 0.65),
          }),
        ],
      }),
  }),
  createPreset({
    id: "motion-lower-third",
    name: "Lower Third",
    category: "lower-thirds",
    description: "A reusable animated lower-third composition.",
    variables: [
      textVariable("name", "Name", "Avery Stone"),
      textVariable("title", "Title", "Creative Director"),
      colorVariable("brand-color", "Brand color", "#14b8a6"),
    ],
    create: () =>
      createPresetScene({
        name: "Lower Third",
        duration: 4,
        backgroundColor: "transparent",
        variables: [
          textVariable("name", "Name", "Avery Stone"),
          textVariable("title", "Title", "Creative Director"),
          colorVariable("brand-color", "Brand color", "#14b8a6"),
        ],
        layers: (composition) => [
          shapeLayer(composition, {
            id: "lt-panel",
            name: "Name Plate",
            x: composition.width * 0.32,
            y: composition.height * 0.78,
            width: 720,
            height: 138,
            color: "#0f172a",
            opacity: 0.92,
            cornerRadius: 18,
            keyframes: slideAndFade("x", 0, 0.55, composition.width * 0.32, -120, 0, 1),
          }),
          shapeLayer(composition, {
            id: "lt-accent",
            name: "Accent",
            x: composition.width * 0.14,
            y: composition.height * 0.78,
            width: 18,
            height: 120,
            color: "#14b8a6",
            cornerRadius: 999,
            variableBindings: [{ variableId: "brand-color", target: "shape.fill.color" }],
            keyframes: fadeIn(0.15, 0.45),
          }),
          textLayer(composition, {
            id: "lt-name",
            name: "Name",
            text: "Avery Stone",
            x: composition.width * 0.34,
            y: composition.height * 0.75,
            fontSize: 52,
            fontWeight: 800,
            color: "#ffffff",
            align: "left",
            variableBindings: [{ variableId: "name", target: "text.content" }],
            keyframes: slideAndFade("x", 0.12, 0.55, composition.width * 0.34, -80, 0, 1),
          }),
          textLayer(composition, {
            id: "lt-title",
            name: "Title",
            text: "Creative Director",
            x: composition.width * 0.34,
            y: composition.height * 0.82,
            fontSize: 28,
            fontWeight: 500,
            color: "#cbd5e1",
            align: "left",
            variableBindings: [{ variableId: "title", target: "text.content" }],
            keyframes: fadeIn(0.32, 0.65),
          }),
        ],
      }),
  }),
  createPreset({
    id: "motion-product-shot",
    name: "Product Shot",
    category: "product-shots",
    description: "Hero product frame with feature callouts and brand controls.",
    variables: [
      textVariable("headline", "Headline", "Meet the new dashboard"),
      textVariable("badge", "Badge", "New"),
      colorVariable("brand-color", "Brand color", "#f59e0b"),
    ],
    create: () =>
      createPresetScene({
        name: "Product Shot",
        duration: 7,
        backgroundColor: "#111827",
        variables: [
          textVariable("headline", "Headline", "Meet the new dashboard"),
          textVariable("badge", "Badge", "New"),
          colorVariable("brand-color", "Brand color", "#f59e0b"),
        ],
        layers: (composition) => [
          shapeLayer(composition, {
            id: "product-card",
            name: "Product Frame",
            x: composition.width * 0.5,
            y: composition.height * 0.56,
            width: 920,
            height: 520,
            color: "#f8fafc",
            cornerRadius: 34,
            keyframes: scaleIn(0.18, 0.9, 0.88, 1),
          }),
          shapeLayer(composition, {
            id: "product-screen",
            name: "Media Placeholder",
            x: composition.width * 0.5,
            y: composition.height * 0.57,
            width: 820,
            height: 405,
            color: "#cbd5e1",
            cornerRadius: 24,
            keyframes: fadeIn(0.45, 0.9),
          }),
          shapeLayer(composition, {
            id: "product-badge-pill",
            name: "Badge Pill",
            x: composition.width * 0.29,
            y: composition.height * 0.2,
            width: 148,
            height: 54,
            color: "#f59e0b",
            cornerRadius: 999,
            variableBindings: [{ variableId: "brand-color", target: "shape.fill.color" }],
            keyframes: slideAndFade("y", 0, 0.55, composition.height * 0.2, -30, 0, 1),
          }),
          textLayer(composition, {
            id: "product-badge",
            name: "Badge",
            text: "New",
            x: composition.width * 0.29,
            y: composition.height * 0.203,
            fontSize: 28,
            fontWeight: 800,
            color: "#111827",
            variableBindings: [{ variableId: "badge", target: "text.content" }],
            keyframes: fadeIn(0.05, 0.55),
          }),
          textLayer(composition, {
            id: "product-headline",
            name: "Headline",
            text: "Meet the new dashboard",
            x: composition.width * 0.5,
            y: composition.height * 0.14,
            fontSize: 72,
            fontWeight: 850,
            color: "#ffffff",
            variableBindings: [{ variableId: "headline", target: "text.content" }],
            keyframes: fadeIn(0.2, 0.8),
          }),
        ],
      }),
  }),
  createPreset({
    id: "motion-social-hook",
    name: "Social Hook",
    category: "social-hooks",
    description: "Vertical short-form opener with progress and punchy text.",
    variables: [
      textVariable("hook", "Hook", "Stop scrolling"),
      textVariable("subhook", "Subhook", "This saves hours every week."),
      colorVariable("brand-color", "Brand color", "#f43f5e"),
    ],
    create: () =>
      createPresetScene({
        name: "Social Hook",
        width: 1080,
        height: 1920,
        duration: 5,
        backgroundColor: "#111827",
        variables: [
          textVariable("hook", "Hook", "Stop scrolling"),
          textVariable("subhook", "Subhook", "This saves hours every week."),
          colorVariable("brand-color", "Brand color", "#f43f5e"),
        ],
        layers: (composition) => [
          shapeLayer(composition, {
            id: "social-swipe",
            name: "Color Swipe",
            x: composition.width * 0.5,
            y: composition.height * 0.5,
            width: composition.width,
            height: composition.height,
            color: "#f43f5e",
            variableBindings: [{ variableId: "brand-color", target: "shape.fill.color" }],
            keyframes: [
              kf("transform.scale.y", 0, 0, "ease-out"),
              kf("transform.scale.y", 0.55, 1, "ease-out"),
              kf("transform.opacity", 1.15, 0.28, "ease"),
            ],
          }),
          textLayer(composition, {
            id: "social-hook",
            name: "Hook",
            text: "Stop scrolling",
            x: composition.width * 0.5,
            y: composition.height * 0.42,
            fontSize: 118,
            fontWeight: 900,
            color: "#ffffff",
            variableBindings: [{ variableId: "hook", target: "text.content" }],
            keyframes: slideAndFade("y", 0.1, 0.55, composition.height * 0.42, 100, 0, 1),
          }),
          textLayer(composition, {
            id: "social-subhook",
            name: "Subhook",
            text: "This saves hours every week.",
            x: composition.width * 0.5,
            y: composition.height * 0.54,
            fontSize: 48,
            fontWeight: 650,
            color: "#f8fafc",
            variableBindings: [{ variableId: "subhook", target: "text.content" }],
            keyframes: fadeIn(0.42, 0.9),
          }),
          shapeLayer(composition, {
            id: "social-progress",
            name: "Progress",
            x: composition.width * 0.5,
            y: composition.height * 0.91,
            width: composition.width * 0.82,
            height: 12,
            color: "#ffffff",
            cornerRadius: 999,
            keyframes: [
              kf("transform.scale.x", 0, 0, "linear"),
              kf("transform.scale.x", composition.duration, 1, "linear"),
            ],
          }),
        ],
      }),
  }),
  createPreset({
    id: "motion-kinetic-title",
    name: "Kinetic Title",
    category: "kinetic-typography",
    description: "A staggered animated headline for launches, hooks, and ads.",
    variables: [
      textVariable("word-1", "Word 1", "Design"),
      textVariable("word-2", "Word 2", "Moves"),
      textVariable("word-3", "Word 3", "People"),
      colorVariable("brand-color", "Brand color", "#38bdf8"),
    ],
    create: () =>
      createPresetScene({
        name: "Kinetic Title",
        duration: 5,
        backgroundColor: "#0f172a",
        variables: [
          textVariable("word-1", "Word 1", "Design"),
          textVariable("word-2", "Word 2", "Moves"),
          textVariable("word-3", "Word 3", "People"),
          colorVariable("brand-color", "Brand color", "#38bdf8"),
        ],
        layers: (composition) => [
          textLayer(composition, {
            id: "kinetic-word-1",
            name: "Word 1",
            text: "Design",
            x: composition.width * 0.34,
            y: composition.height * 0.4,
            fontSize: 126,
            fontWeight: 900,
            color: "#ffffff",
            variableBindings: [{ variableId: "word-1", target: "text.content" }],
            keyframes: slideAndFade("x", 0, 0.45, composition.width * 0.34, -120, 0, 1),
          }),
          textLayer(composition, {
            id: "kinetic-word-2",
            name: "Word 2",
            text: "Moves",
            x: composition.width * 0.58,
            y: composition.height * 0.52,
            fontSize: 146,
            fontWeight: 900,
            color: "#38bdf8",
            variableBindings: [
              { variableId: "word-2", target: "text.content" },
              { variableId: "brand-color", target: "text.color" },
            ],
            keyframes: slideAndFade("x", 0.18, 0.58, composition.width * 0.58, 120, 0, 1),
          }),
          textLayer(composition, {
            id: "kinetic-word-3",
            name: "Word 3",
            text: "People",
            x: composition.width * 0.5,
            y: composition.height * 0.66,
            fontSize: 112,
            fontWeight: 800,
            color: "#e2e8f0",
            variableBindings: [{ variableId: "word-3", target: "text.content" }],
            keyframes: slideAndFade("y", 0.36, 0.76, composition.height * 0.66, 110, 0, 1),
          }),
        ],
      }),
  }),
  createPreset({
    id: "motion-logo-reveal",
    name: "Logo Reveal",
    category: "logo-reveals",
    description: "A simple reveal scene ready for logo or SVG replacement.",
    variables: [
      textVariable("brand-name", "Brand name", "OpenReel"),
      colorVariable("brand-color", "Brand color", "#14b8a6"),
    ],
    create: () =>
      createPresetScene({
        name: "Logo Reveal",
        duration: 5,
        backgroundColor: "transparent",
        variables: [
          textVariable("brand-name", "Brand name", "OpenReel"),
          colorVariable("brand-color", "Brand color", "#14b8a6"),
        ],
        layers: (composition) => [
          shapeLayer(composition, {
            id: "logo-ring",
            name: "Logo Ring",
            x: composition.width * 0.5,
            y: composition.height * 0.43,
            width: 230,
            height: 230,
            shapeType: "ellipse",
            color: "#14b8a6",
            opacity: 0.18,
            variableBindings: [{ variableId: "brand-color", target: "shape.fill.color" }],
            keyframes: scaleIn(0, 0.9, 0.35, 1),
          }),
          shapeLayer(composition, {
            id: "logo-mark",
            name: "Logo Mark Placeholder",
            x: composition.width * 0.5,
            y: composition.height * 0.43,
            width: 132,
            height: 132,
            color: "#14b8a6",
            cornerRadius: 30,
            variableBindings: [{ variableId: "brand-color", target: "shape.fill.color" }],
            keyframes: [
              ...scaleIn(0.18, 0.78, 0.65, 1),
              kf("transform.rotation", 0.18, -18, "ease-out"),
              kf("transform.rotation", 0.78, 0, "ease-out"),
            ],
          }),
          textLayer(composition, {
            id: "logo-name",
            name: "Brand Name",
            text: "OpenReel",
            x: composition.width * 0.5,
            y: composition.height * 0.61,
            fontSize: 74,
            fontWeight: 850,
            color: "#ffffff",
            variableBindings: [{ variableId: "brand-name", target: "text.content" }],
            keyframes: fadeIn(0.62, 1.15),
          }),
        ],
      }),
  }),
  createPreset({
    id: "motion-end-screen",
    name: "End Screen",
    category: "end-screens",
    description: "Outro card with two placeholders and a strong call to action.",
    variables: [
      textVariable("headline", "Headline", "Keep watching"),
      textVariable("cta", "CTA", "Subscribe for more"),
      colorVariable("brand-color", "Brand color", "#a78bfa"),
    ],
    create: () =>
      createPresetScene({
        name: "End Screen",
        duration: 6,
        backgroundColor: "#111827",
        variables: [
          textVariable("headline", "Headline", "Keep watching"),
          textVariable("cta", "CTA", "Subscribe for more"),
          colorVariable("brand-color", "Brand color", "#a78bfa"),
        ],
        layers: (composition) => [
          textLayer(composition, {
            id: "end-headline",
            name: "Headline",
            text: "Keep watching",
            x: composition.width * 0.5,
            y: composition.height * 0.18,
            fontSize: 82,
            fontWeight: 850,
            color: "#ffffff",
            variableBindings: [{ variableId: "headline", target: "text.content" }],
            keyframes: fadeIn(0, 0.5),
          }),
          shapeLayer(composition, {
            id: "end-card-left",
            name: "Video Placeholder Left",
            x: composition.width * 0.33,
            y: composition.height * 0.52,
            width: 520,
            height: 300,
            color: "#1f2937",
            cornerRadius: 24,
            keyframes: slideAndFade("x", 0.22, 0.8, composition.width * 0.33, -90, 0, 1),
          }),
          shapeLayer(composition, {
            id: "end-card-right",
            name: "Video Placeholder Right",
            x: composition.width * 0.67,
            y: composition.height * 0.52,
            width: 520,
            height: 300,
            color: "#1f2937",
            cornerRadius: 24,
            keyframes: slideAndFade("x", 0.34, 0.92, composition.width * 0.67, 90, 0, 1),
          }),
          shapeLayer(composition, {
            id: "end-cta-pill",
            name: "CTA Pill",
            x: composition.width * 0.5,
            y: composition.height * 0.8,
            width: 430,
            height: 72,
            color: "#a78bfa",
            cornerRadius: 999,
            variableBindings: [{ variableId: "brand-color", target: "shape.fill.color" }],
            keyframes: scaleIn(0.55, 1.05, 0.82, 1),
          }),
          textLayer(composition, {
            id: "end-cta",
            name: "CTA",
            text: "Subscribe for more",
            x: composition.width * 0.5,
            y: composition.height * 0.805,
            fontSize: 34,
            fontWeight: 800,
            color: "#111827",
            variableBindings: [{ variableId: "cta", target: "text.content" }],
            keyframes: fadeIn(0.68, 1.12),
          }),
        ],
      }),
  }),
];

export function getMotionPreset(id: string): MotionPreset | undefined {
  return MOTION_PRESETS.find((preset) => preset.id === id);
}

export function getMotionPresetCategories(): readonly MotionTemplateCategory[] {
  return TEMPLATE_CATEGORIES;
}

function createPreset(
  preset: Omit<MotionPreset, "variables"> & {
    readonly variables: readonly MotionTemplateVariable[];
  },
): MotionPreset {
  return preset;
}

function createPresetScene(options: PresetSceneOptions): MotionComposition {
  const composition = motionEngine.createComposition({
    name: options.name,
    width: options.width,
    height: options.height,
    duration: options.duration,
    backgroundColor: options.backgroundColor,
  });
  return {
    ...composition,
    variables: toMotionVariables(options.variables),
    layers: options.layers(composition),
    modifiedAt: Date.now(),
  };
}

function textVariable(
  id: string,
  label: string,
  defaultValue: string,
): MotionTemplateVariable {
  return { id, label, type: "text", defaultValue };
}

function colorVariable(
  id: string,
  label: string,
  defaultValue: string,
): MotionTemplateVariable {
  return { id, label, type: "color", defaultValue };
}

function toMotionVariables(
  variables: readonly MotionTemplateVariable[],
): MotionVariable[] {
  return variables.map((variable) => ({
    id: variable.id,
    name: variable.label,
    type: variable.type,
    value: variable.defaultValue,
  }));
}

function textLayer(
  composition: MotionComposition,
  options: {
    readonly id: string;
    readonly name: string;
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly fontSize: number;
    readonly fontWeight: number;
    readonly color: string;
    readonly align?: CanvasTextAlign;
    readonly variableBindings?: readonly {
      readonly variableId: string;
      readonly target: "text.content" | "text.color";
    }[];
    readonly keyframes?: MotionTextLayer["keyframes"];
  },
): MotionTextLayer {
  return {
    id: uid(options.id),
    type: "text",
    name: options.name,
    startTime: 0,
    duration: composition.duration,
    visible: true,
    locked: false,
    transform: transform(options.x, options.y),
    keyframes: options.keyframes ?? [],
    variableBindings: options.variableBindings?.map((binding) => ({
      id: uid("motion-binding"),
      variableId: binding.variableId,
      target: binding.target,
    })),
    text: options.text,
    style: {
      fontFamily: "Inter",
      fontSize: options.fontSize,
      fontWeight: options.fontWeight,
      color: options.color,
      align: options.align ?? "center",
      lineHeight: 1.05,
    },
  };
}

function shapeLayer(
  composition: MotionComposition,
  options: {
    readonly id: string;
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly color: string;
    readonly shapeType?: MotionShapeLayer["shapeType"];
    readonly opacity?: number;
    readonly cornerRadius?: number;
    readonly variableBindings?: readonly {
      readonly variableId: string;
      readonly target: "shape.fill.color" | "shape.stroke.color";
    }[];
    readonly keyframes?: MotionShapeLayer["keyframes"];
  },
): MotionShapeLayer {
  return {
    id: uid(options.id),
    type: "shape",
    name: options.name,
    startTime: 0,
    duration: composition.duration,
    visible: true,
    locked: false,
    transform: transform(options.x, options.y, options.opacity ?? 1),
    keyframes: options.keyframes ?? [],
    variableBindings: options.variableBindings?.map((binding) => ({
      id: uid("motion-binding"),
      variableId: binding.variableId,
      target: binding.target,
    })),
    shapeType: options.shapeType ?? "rectangle",
    width: options.width,
    height: options.height,
    style: {
      ...DEFAULT_SHAPE_STYLE,
      fill: {
        type: "solid",
        color: options.color,
        opacity: 1,
      },
      stroke: {
        color: options.color,
        width: 0,
        opacity: 0,
      },
      cornerRadius: options.cornerRadius ?? 0,
    },
  };
}

function transform(
  x: number,
  y: number,
  opacity = 1,
): MotionLayer["transform"] {
  return {
    ...DEFAULT_MOTION_TRANSFORM,
    position: { x, y },
    opacity,
  };
}

function fadeIn(start: number, end: number): MotionLayer["keyframes"] {
  return [
    kf("transform.opacity", start, 0, "ease-out"),
    kf("transform.opacity", end, 1, "ease-out"),
  ];
}

function scaleIn(
  start: number,
  end: number,
  fromScale: number,
  toScale: number,
): MotionLayer["keyframes"] {
  return [
    kf("transform.scale.x", start, fromScale, "ease-out"),
    kf("transform.scale.y", start, fromScale, "ease-out"),
    kf("transform.opacity", start, 0, "ease-out"),
    kf("transform.scale.x", end, toScale, "ease-out"),
    kf("transform.scale.y", end, toScale, "ease-out"),
    kf("transform.opacity", end, 1, "ease-out"),
  ];
}

function slideAndFade(
  axis: "x" | "y",
  start: number,
  end: number,
  target: number,
  offset: number,
  fromOpacity: number,
  toOpacity: number,
): MotionLayer["keyframes"] {
  const property = `transform.position.${axis}`;
  return [
    kf("transform.opacity", start, fromOpacity, "ease-out"),
    kf(property, start, target + offset, "ease-out"),
    kf("transform.opacity", end, toOpacity, "ease-out"),
    kf(property, end, target, "ease-out"),
  ];
}

function kf(
  property: string,
  time: number,
  value: number | string,
  easing: MotionLayer["keyframes"][number]["easing"],
): MotionLayer["keyframes"][number] {
  return {
    id: uid("motion-kf"),
    property,
    time,
    value,
    easing,
  };
}
