import type { TextStyle } from "../text/types";
import type { ShapeStyle, ShapeType } from "../graphics/types";
import {
  GRAPHIC_TEMPLATE_SCHEMA_VERSION,
  type GraphicAxisPin,
  type GraphicLayer,
  type GraphicMotion,
  type GraphicParameter,
  type GraphicTemplate,
  type GraphicTemplateCategory,
} from "./types";

/** Built-in Essential Graphics templates. Design frame 1920x1080, origin top-left. */

const FONT = "Inter";

interface LayerExtra {
  readonly pin?: GraphicLayer["pin"];
  readonly motionIn?: GraphicMotion;
  readonly motionOut?: GraphicMotion;
  readonly opacity?: number;
  readonly visible?: boolean;
  readonly rotation?: number;
}

const rect = (
  id: string, name: string, x: number, y: number, width: number, height: number,
  fill: string, extra: LayerExtra = {}, shapeType: ShapeType = "rectangle", style: Partial<ShapeStyle> = {},
): GraphicLayer => ({
  id, name, kind: "shape", visible: extra.visible ?? true, x, y, width, height, rotation: extra.rotation ?? 0,
  opacity: extra.opacity ?? 1,
  ...(extra.pin ? { pin: extra.pin } : {}),
  ...(extra.motionIn ? { motionIn: extra.motionIn } : {}),
  ...(extra.motionOut ? { motionOut: extra.motionOut } : {}),
  shape: { shapeType, style: { fill: { type: "solid", color: fill, opacity: 1 }, stroke: { color: "#000000", width: 0, opacity: 1 }, ...style } },
});

const label = (
  id: string, name: string, content: string, x: number, y: number, width: number, height: number,
  style: Partial<TextStyle>, extra: LayerExtra = {},
): GraphicLayer => ({
  id, name, kind: "text", visible: extra.visible ?? true, x, y, width, height, rotation: extra.rotation ?? 0,
  opacity: extra.opacity ?? 1,
  ...(extra.pin ? { pin: extra.pin } : {}),
  ...(extra.motionIn ? { motionIn: extra.motionIn } : {}),
  ...(extra.motionOut ? { motionOut: extra.motionOut } : {}),
  text: {
    text: content,
    style: {
      fontFamily: FONT, fontWeight: 700, color: "#ffffff", textAlign: "left", lineHeight: 1.15, letterSpacing: 0,
      strokeWidth: 0, ...style,
    },
  },
});

const svg = (
  id: string, name: string, content: string, vbW: number, vbH: number, x: number, y: number, width: number, height: number,
  tint: string | undefined, extra: LayerExtra = {},
): GraphicLayer => ({
  id, name, kind: "svg", visible: extra.visible ?? true, x, y, width, height, rotation: extra.rotation ?? 0,
  opacity: extra.opacity ?? 1,
  ...(extra.pin ? { pin: extra.pin } : {}),
  ...(extra.motionIn ? { motionIn: extra.motionIn } : {}),
  ...(extra.motionOut ? { motionOut: extra.motionOut } : {}),
  svg: { svgContent: content, viewBoxWidth: vbW, viewBoxHeight: vbH, ...(tint ? { tintColor: tint } : {}) },
});

const pinFrame = (edge: GraphicAxisPin["edge"], offset: number): GraphicAxisPin => ({ edge, to: "frame", offset });
const pinTo = (to: string, edge: GraphicAxisPin["edge"], offset: number): GraphicAxisPin => ({ edge, to, offset });

const inM = (type: GraphicMotion["type"], delay: number, duration: number, distance?: number): GraphicMotion => ({
  type, delay, duration, ...(distance !== undefined ? { distance } : {}), easing: "easeOutCubic",
});
const outM = (type: GraphicMotion["type"], duration = 0.35, delay = 0, distance?: number): GraphicMotion => ({
  type, delay, duration, ...(distance !== undefined ? { distance } : {}), easing: "easeInCubic",
});

const param = (
  id: string, labelText: string, type: GraphicParameter["type"], defaultValue: GraphicParameter["defaultValue"],
  targets: GraphicParameter["targets"], group?: string, extra: Partial<GraphicParameter> = {},
): GraphicParameter => ({ id, label: labelText, type, defaultValue, targets, ...(group ? { group } : {}), ...extra });

const FONT_OPTIONS = ["Inter", "Poppins", "Montserrat", "Roboto", "Oswald", "Playfair Display", "Bebas Neue"];

const make = (
  id: string, name: string, category: GraphicTemplateCategory, description: string, tags: string[], duration: number,
  layers: GraphicLayer[], parameters: GraphicParameter[],
): GraphicTemplate => ({
  schemaVersion: GRAPHIC_TEMPLATE_SCHEMA_VERSION, id, name, category, description, tags, duration, layers, parameters,
});

const PILL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect x="0" y="0" width="400" height="100" rx="50" fill="#ffffff"/></svg>';
const OUTLINE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"><rect x="8" y="8" width="384" height="224" rx="22" fill="none" stroke="#ffffff" stroke-width="10"/></svg>';
const DOT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#ffffff"/></svg>';
const PLAY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M30 20 L82 50 L30 80 Z" fill="#ffffff"/></svg>';

// ---------------------------------------------------------------------------
// Lower thirds
// ---------------------------------------------------------------------------

const lowerThirdClassic = make(
  "builtin-lt-classic-bar", "Classic Bar", "lower-third",
  "Dark plate with an accent edge. Name slides in over a wipe, title follows.", ["lower third", "name", "news"], 5,
  [
    rect("plate", "Plate", 500, 880, 780, 130, "#0f172acc", {
      pin: { horizontal: pinFrame("start", 110), vertical: pinFrame("end", 110) },
      motionIn: inM("wipe-right", 0.05, 0.5), motionOut: outM("wipe-right", 0.4, 0.1),
    }),
    rect("accent", "Accent", 0, 0, 12, 130, "#f97316", {
      pin: { horizontal: pinTo("plate", "start", 0), vertical: pinTo("plate", "start", 0) },
      motionIn: inM("wipe-down", 0, 0.4), motionOut: outM("wipe-down", 0.3, 0.2),
    }),
    label("name", "Name", "ALEX MORGAN", 0, 0, 680, 56, { fontSize: 46, fontFamily: FONT, fontWeight: 800 }, {
      pin: { horizontal: pinTo("plate", "start", 44), vertical: pinTo("plate", "start", 14) },
      motionIn: inM("slide-right", 0.3, 0.45, 60), motionOut: outM("fade", 0.3),
    }),
    label("title", "Title", "Senior Correspondent", 0, 0, 680, 36, { fontSize: 28, fontWeight: 500, color: "#cbd5e1" }, {
      pin: { horizontal: pinTo("plate", "start", 44), vertical: pinTo("plate", "start", 78) },
      motionIn: inM("slide-right", 0.45, 0.45, 60), motionOut: outM("fade", 0.3),
    }),
  ],
  [
    param("name", "Name", "text", "ALEX MORGAN", [{ layerId: "name", property: "text" }], "Text"),
    param("title", "Title", "text", "Senior Correspondent", [{ layerId: "title", property: "text" }], "Text"),
    param("showTitle", "Show title line", "checkbox", true, [{ layerId: "title", property: "visible" }], "Text"),
    param("font", "Font", "font", FONT, [{ layerId: "name", property: "fontFamily" }, { layerId: "title", property: "fontFamily" }], "Text", { options: FONT_OPTIONS }),
    param("nameSize", "Name size", "slider", 46, [{ layerId: "name", property: "fontSize" }], "Text", { min: 24, max: 80, step: 1 }),
    param("accent", "Accent color", "color", "#f97316", [{ layerId: "accent", property: "fill" }], "Style"),
    param("plate", "Plate color", "color", "#0f172acc", [{ layerId: "plate", property: "fill" }], "Style"),
    param("nameColor", "Name color", "color", "#ffffff", [{ layerId: "name", property: "textColor" }], "Style"),
  ],
);

const lowerThirdMinimal = make(
  "builtin-lt-minimal-line", "Minimal Line", "lower-third",
  "Clean vertical rule with two lines of type. Understated and works on any footage.", ["lower third", "minimal", "documentary"], 5,
  [
    rect("rule", "Rule", 0, 0, 6, 112, "#ffffff", {
      pin: { horizontal: pinFrame("start", 120), vertical: pinFrame("end", 130) },
      motionIn: inM("wipe-down", 0, 0.45), motionOut: outM("wipe-down", 0.35, 0.1),
    }),
    label("name", "Name", "Jordan Ellis", 0, 0, 760, 62, { fontSize: 54, fontWeight: 700, shadowColor: "#00000099", shadowBlur: 12, shadowOffsetX: 0, shadowOffsetY: 2 }, {
      pin: { horizontal: pinTo("rule", "start", 28), vertical: pinTo("rule", "start", -2) },
      motionIn: inM("slide-up", 0.2, 0.45, 40), motionOut: outM("fade", 0.3),
    }),
    label("role", "Role", "Documentary Director", 0, 0, 760, 40, { fontSize: 30, fontWeight: 400, color: "#e2e8f0", shadowColor: "#00000099", shadowBlur: 10, shadowOffsetX: 0, shadowOffsetY: 2 }, {
      pin: { horizontal: pinTo("rule", "start", 28), vertical: pinTo("rule", "start", 68) },
      motionIn: inM("slide-up", 0.35, 0.45, 40), motionOut: outM("fade", 0.3),
    }),
  ],
  [
    param("name", "Name", "text", "Jordan Ellis", [{ layerId: "name", property: "text" }], "Text"),
    param("role", "Role", "text", "Documentary Director", [{ layerId: "role", property: "text" }], "Text"),
    param("showRule", "Show rule", "checkbox", true, [{ layerId: "rule", property: "visible" }], "Style"),
    param("ruleColor", "Rule color", "color", "#ffffff", [{ layerId: "rule", property: "fill" }], "Style"),
    param("textColor", "Name color", "color", "#ffffff", [{ layerId: "name", property: "textColor" }], "Style"),
  ],
);

const lowerThirdModern = make(
  "builtin-lt-modern-box", "Modern Box", "lower-third",
  "Solid light box with a colour tab and an optional LIVE tag above it.", ["lower third", "modern", "social"], 5,
  [
    rect("box", "Box", 0, 0, 720, 120, "#ffffff", {
      pin: { horizontal: pinFrame("start", 110), vertical: pinFrame("end", 120) },
      motionIn: inM("wipe-right", 0, 0.5), motionOut: outM("wipe-right", 0.4, 0.1),
    }),
    rect("tab", "Colour tab", 0, 0, 24, 120, "#2563eb", {
      pin: { horizontal: pinTo("box", "start", 0), vertical: pinTo("box", "start", 0) },
      motionIn: inM("wipe-down", 0.2, 0.35), motionOut: outM("wipe-down", 0.3),
    }),
    rect("tagBg", "Tag", 0, 0, 120, 38, "#ef4444", {
      pin: { horizontal: pinTo("box", "start", 0), vertical: pinTo("box", "start", -38) },
      motionIn: inM("slide-up", 0.35, 0.35, 30), motionOut: outM("fade", 0.25),
    }),
    label("tagText", "Tag text", "LIVE", 0, 0, 120, 38, { fontSize: 22, fontWeight: 800, textAlign: "center", letterSpacing: 2 }, {
      pin: { horizontal: pinTo("box", "start", 0), vertical: pinTo("box", "start", -38) },
      motionIn: inM("slide-up", 0.35, 0.35, 30), motionOut: outM("fade", 0.25),
    }),
    label("name", "Name", "Sam Rivera", 0, 0, 620, 54, { fontSize: 44, fontWeight: 800, color: "#0f172a" }, {
      pin: { horizontal: pinTo("box", "start", 52), vertical: pinTo("box", "start", 12) },
      motionIn: inM("slide-right", 0.35, 0.4, 50), motionOut: outM("fade", 0.25),
    }),
    label("tagline", "Tagline", "Host, Morning Show", 0, 0, 620, 34, { fontSize: 26, fontWeight: 500, color: "#475569" }, {
      pin: { horizontal: pinTo("box", "start", 52), vertical: pinTo("box", "start", 72) },
      motionIn: inM("slide-right", 0.5, 0.4, 50), motionOut: outM("fade", 0.25),
    }),
  ],
  [
    param("name", "Name", "text", "Sam Rivera", [{ layerId: "name", property: "text" }], "Text"),
    param("tagline", "Tagline", "text", "Host, Morning Show", [{ layerId: "tagline", property: "text" }], "Text"),
    param("showTag", "Show LIVE tag", "checkbox", true, [{ layerId: "tagBg", property: "visible" }, { layerId: "tagText", property: "visible" }], "Tag"),
    param("tagText", "Tag text", "text", "LIVE", [{ layerId: "tagText", property: "text" }], "Tag"),
    param("tagColor", "Tag color", "color", "#ef4444", [{ layerId: "tagBg", property: "fill" }], "Tag"),
    param("tabColor", "Accent color", "color", "#2563eb", [{ layerId: "tab", property: "fill" }], "Style"),
    param("boxColor", "Box color", "color", "#ffffff", [{ layerId: "box", property: "fill" }], "Style"),
  ],
);

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

const titleHero = make(
  "builtin-title-hero", "Hero Title", "title",
  "Large centred title with a subtitle and a drawing underline.", ["title", "opener", "centered"], 6,
  [
    label("title", "Title", "THE LONG ROAD HOME", 960, 500, 1500, 140, { fontSize: 124, fontWeight: 800, textAlign: "center", letterSpacing: 4, shadowColor: "#000000aa", shadowBlur: 24, shadowOffsetX: 0, shadowOffsetY: 6 }, {
      motionIn: inM("scale", 0, 0.8), motionOut: outM("fade", 0.5),
    }),
    rect("line", "Underline", 960, 590, 560, 6, "#facc15", {
      motionIn: inM("wipe-right", 0.5, 0.6), motionOut: outM("wipe-right", 0.4),
    }),
    label("subtitle", "Subtitle", "A film by Casey Nguyen", 960, 655, 1200, 56, { fontSize: 40, fontWeight: 400, textAlign: "center", color: "#e5e7eb", letterSpacing: 2, shadowColor: "#000000aa", shadowBlur: 16, shadowOffsetX: 0, shadowOffsetY: 3 }, {
      motionIn: inM("slide-up", 0.8, 0.5, 30), motionOut: outM("fade", 0.4),
    }),
  ],
  [
    param("title", "Title", "text", "THE LONG ROAD HOME", [{ layerId: "title", property: "text" }], "Text"),
    param("subtitle", "Subtitle", "text", "A film by Casey Nguyen", [{ layerId: "subtitle", property: "text" }], "Text"),
    param("showSubtitle", "Show subtitle", "checkbox", true, [{ layerId: "subtitle", property: "visible" }], "Text"),
    param("titleSize", "Title size", "slider", 124, [{ layerId: "title", property: "fontSize" }], "Text", { min: 40, max: 220, step: 1 }),
    param("font", "Font", "font", FONT, [{ layerId: "title", property: "fontFamily" }, { layerId: "subtitle", property: "fontFamily" }], "Text", { options: FONT_OPTIONS }),
    param("lineColor", "Underline color", "color", "#facc15", [{ layerId: "line", property: "fill" }], "Style"),
    param("titleColor", "Title color", "color", "#ffffff", [{ layerId: "title", property: "textColor" }], "Style"),
    param("position", "Title position", "position", { x: 960, y: 500 }, [{ layerId: "title", property: "position" }], "Layout"),
  ],
);

const titleBlock = make(
  "builtin-title-bold-block", "Bold Block", "title",
  "Full-width colour band that pops in behind a heavy headline.", ["title", "bold", "band"], 5,
  [
    rect("band", "Band", 960, 540, 1920, 260, "#dc2626", {
      pin: { horizontal: pinFrame("start", 0) },
      motionIn: inM("wipe-up", 0, 0.5), motionOut: outM("wipe-up", 0.4, 0.1),
    }),
    label("headline", "Headline", "BREAKING STORY", 960, 540, 1500, 130, { fontSize: 112, fontWeight: 900, textAlign: "center", letterSpacing: 6 }, {
      motionIn: inM("scale", 0.3, 0.5), motionOut: outM("fade", 0.3),
    }),
  ],
  [
    param("headline", "Headline", "text", "BREAKING STORY", [{ layerId: "headline", property: "text" }], "Text"),
    param("size", "Headline size", "slider", 112, [{ layerId: "headline", property: "fontSize" }], "Text", { min: 40, max: 200, step: 1 }),
    param("bandColor", "Band color", "color", "#dc2626", [{ layerId: "band", property: "fill" }], "Style"),
    param("bandHeight", "Band height", "slider", 260, [{ layerId: "band", property: "height" }], "Style", { min: 120, max: 600, step: 2 }),
    param("headlineColor", "Headline color", "color", "#ffffff", [{ layerId: "headline", property: "textColor" }], "Style"),
  ],
);

const titleCinematic = make(
  "builtin-title-cinematic", "Cinematic Rules", "title",
  "Widely spaced title between two thin rules, fading in slowly.", ["title", "cinematic", "trailer"], 6,
  [
    rect("top", "Top rule", 960, 470, 700, 3, "#e2e8f0", { motionIn: inM("wipe-right", 0, 0.8), motionOut: outM("wipe-right", 0.5) }),
    label("title", "Title", "NORTHBOUND", 960, 540, 1500, 110, { fontSize: 96, fontWeight: 300, textAlign: "center", letterSpacing: 24 }, {
      motionIn: inM("fade", 0.3, 1.0), motionOut: outM("fade", 0.6),
    }),
    rect("bottom", "Bottom rule", 960, 610, 700, 3, "#e2e8f0", { motionIn: inM("wipe-left", 0, 0.8), motionOut: outM("wipe-left", 0.5) }),
    label("tagline", "Tagline", "COMING THIS SUMMER", 960, 665, 1200, 40, { fontSize: 28, fontWeight: 400, textAlign: "center", letterSpacing: 10, color: "#94a3b8" }, {
      motionIn: inM("fade", 0.9, 0.8), motionOut: outM("fade", 0.4),
    }),
  ],
  [
    param("title", "Title", "text", "NORTHBOUND", [{ layerId: "title", property: "text" }], "Text"),
    param("tagline", "Tagline", "text", "COMING THIS SUMMER", [{ layerId: "tagline", property: "text" }], "Text"),
    param("showTagline", "Show tagline", "checkbox", true, [{ layerId: "tagline", property: "visible" }], "Text"),
    param("ruleColor", "Rule color", "color", "#e2e8f0", [{ layerId: "top", property: "fill" }, { layerId: "bottom", property: "fill" }], "Style"),
    param("ruleWidth", "Rule width", "slider", 700, [{ layerId: "top", property: "width" }, { layerId: "bottom", property: "width" }], "Style", { min: 200, max: 1600, step: 10 }),
  ],
);

// ---------------------------------------------------------------------------
// Callouts
// ---------------------------------------------------------------------------

const calloutInfo = make(
  "builtin-callout-info", "Info Callout", "callout",
  "A pulsing marker, a connector line and a label card to point at something on screen.", ["callout", "annotation", "label"], 5,
  [
    rect("line", "Connector", 1050, 470, 4, 190, "#ffffff", {
      motionIn: inM("wipe-down", 0.25, 0.4), motionOut: outM("wipe-down", 0.3),
    }),
    rect("marker", "Marker", 1050, 560, 32, 32, "#22d3ee", {
      motionIn: inM("scale", 0, 0.35), motionOut: outM("scale", 0.25),
    }, "circle"),
    rect("card", "Card", 1280, 380, 480, 150, "#0b1220e6", {
      motionIn: inM("wipe-right", 0.5, 0.4), motionOut: outM("wipe-right", 0.3),
    }),
    label("heading", "Heading", "Fun fact", 1280, 340, 420, 44, { fontSize: 36, fontWeight: 800, color: "#22d3ee" }, {
      motionIn: inM("fade", 0.8, 0.3), motionOut: outM("fade", 0.25),
    }),
    label("body", "Body", "This spot was surveyed in 1894.", 1280, 400, 420, 70, { fontSize: 30, fontWeight: 500, color: "#f1f5f9" }, {
      motionIn: inM("fade", 0.9, 0.3), motionOut: outM("fade", 0.25),
    }),
  ],
  [
    param("heading", "Heading", "text", "Fun fact", [{ layerId: "heading", property: "text" }], "Text"),
    param("body", "Body", "text", "This spot was surveyed in 1894.", [{ layerId: "body", property: "text" }], "Text"),
    param("markerPos", "Marker position", "position", { x: 1050, y: 560 }, [{ layerId: "marker", property: "position" }], "Layout"),
    param("accent", "Accent color", "color", "#22d3ee", [{ layerId: "marker", property: "fill" }, { layerId: "heading", property: "textColor" }], "Style"),
    param("cardColor", "Card color", "color", "#0b1220e6", [{ layerId: "card", property: "fill" }], "Style"),
    param("showConnector", "Show connector", "checkbox", true, [{ layerId: "line", property: "visible" }], "Layout"),
  ],
);

const calloutHighlight = make(
  "builtin-callout-highlight", "Highlight Box", "callout",
  "A rounded outline to frame a region plus a small label tab.", ["callout", "highlight", "outline"], 4,
  [
    svg("outline", "Outline", OUTLINE, 400, 240, 960, 520, 620, 372, "#facc15", {
      motionIn: inM("scale", 0, 0.45), motionOut: outM("fade", 0.3),
    }),
    rect("tab", "Label tab", 740, 318, 220, 52, "#facc15", {
      motionIn: inM("slide-down", 0.35, 0.35, 24), motionOut: outM("fade", 0.25),
    }),
    label("tabText", "Label", "LOOK HERE", 740, 318, 220, 52, { fontSize: 28, fontWeight: 800, textAlign: "center", color: "#111827", letterSpacing: 2 }, {
      motionIn: inM("slide-down", 0.35, 0.35, 24), motionOut: outM("fade", 0.25),
    }),
  ],
  [
    param("label", "Label", "text", "LOOK HERE", [{ layerId: "tabText", property: "text" }], "Text"),
    param("color", "Highlight color", "color", "#facc15", [{ layerId: "outline", property: "tint" }, { layerId: "tab", property: "fill" }], "Style"),
    param("boxWidth", "Box width", "slider", 620, [{ layerId: "outline", property: "width" }], "Layout", { min: 120, max: 1700, step: 5 }),
    param("boxHeight", "Box height", "slider", 372, [{ layerId: "outline", property: "height" }], "Layout", { min: 80, max: 1000, step: 5 }),
    param("boxPos", "Box position", "position", { x: 960, y: 520 }, [{ layerId: "outline", property: "position" }], "Layout"),
    param("showLabel", "Show label tab", "checkbox", true, [{ layerId: "tab", property: "visible" }, { layerId: "tabText", property: "visible" }], "Layout"),
  ],
);

const socialBug = make(
  "builtin-callout-social-bug", "Social Handle", "callout",
  "Pill in the corner with a handle. Pinned to the frame, so it stays put in any aspect ratio.", ["social", "handle", "bug", "corner"], 6,
  [
    svg("pill", "Pill", PILL, 400, 100, 0, 0, 400, 78, "#111827e6", {
      pin: { horizontal: pinFrame("end", 70), vertical: pinFrame("end", 70) },
      motionIn: inM("slide-left", 0, 0.5, 90), motionOut: outM("slide-left", 0.4, 0, 90),
    }),
    svg("dot", "Dot", DOT, 100, 100, 0, 0, 22, 22, "#ef4444", {
      pin: { horizontal: pinTo("pill", "start", 28), vertical: pinTo("pill", "center", 0) },
      motionIn: inM("scale", 0.3, 0.3), motionOut: outM("fade", 0.2),
    }),
    label("handle", "Handle", "@openreel", 0, 0, 300, 44, { fontSize: 34, fontWeight: 700 }, {
      pin: { horizontal: pinTo("pill", "start", 70), vertical: pinTo("pill", "center", 0) },
      motionIn: inM("fade", 0.3, 0.4), motionOut: outM("fade", 0.2),
    }),
  ],
  [
    param("handle", "Handle", "text", "@openreel", [{ layerId: "handle", property: "text" }], "Text"),
    param("pillColor", "Pill color", "color", "#111827e6", [{ layerId: "pill", property: "tint" }], "Style"),
    param("dotColor", "Dot color", "color", "#ef4444", [{ layerId: "dot", property: "tint" }], "Style"),
    param("showDot", "Show dot", "checkbox", true, [{ layerId: "dot", property: "visible" }], "Style"),
  ],
);

// ---------------------------------------------------------------------------
// End cards
// ---------------------------------------------------------------------------

const endSubscribe = make(
  "builtin-end-subscribe", "Subscribe End Card", "end-card",
  "Dimmed backdrop, a heading, two video slots and a subscribe button.", ["end card", "youtube", "subscribe"], 12,
  [
    rect("dim", "Backdrop", 960, 540, 1920, 1080, "#020617", { opacity: 0.72, motionIn: inM("fade", 0, 0.6), motionOut: outM("fade", 0.5) }),
    rect("slotA", "Video slot A", 560, 560, 640, 360, "#1e293b", { motionIn: inM("slide-up", 0.4, 0.5, 60), motionOut: outM("fade", 0.3) }),
    rect("slotB", "Video slot B", 1360, 560, 640, 360, "#1e293b", { motionIn: inM("slide-up", 0.55, 0.5, 60), motionOut: outM("fade", 0.3) }),
    rect("button", "Button", 960, 900, 420, 96, "#dc2626", { motionIn: inM("scale", 0.9, 0.45), motionOut: outM("fade", 0.3) }),
    svg("play", "Play icon", PLAY, 100, 100, 790, 900, 56, 56, "#ffffff", { motionIn: inM("scale", 1.0, 0.35), motionOut: outM("fade", 0.3) }),
    label("heading", "Heading", "Thanks for watching", 960, 230, 1500, 120, { fontSize: 96, fontWeight: 800, textAlign: "center" }, {
      motionIn: inM("slide-down", 0.2, 0.55, 50), motionOut: outM("fade", 0.4),
    }),
    label("slotALabel", "Slot A label", "Watch next", 560, 560, 600, 50, { fontSize: 36, fontWeight: 600, textAlign: "center", color: "#94a3b8" }, {
      motionIn: inM("fade", 0.8, 0.4), motionOut: outM("fade", 0.3),
    }),
    label("slotBLabel", "Slot B label", "Most popular", 1360, 560, 600, 50, { fontSize: 36, fontWeight: 600, textAlign: "center", color: "#94a3b8" }, {
      motionIn: inM("fade", 0.9, 0.4), motionOut: outM("fade", 0.3),
    }),
    label("buttonText", "Button text", "SUBSCRIBE", 990, 900, 300, 56, { fontSize: 44, fontWeight: 800, textAlign: "center", letterSpacing: 3 }, {
      motionIn: inM("fade", 1.0, 0.35), motionOut: outM("fade", 0.3),
    }),
  ],
  [
    param("heading", "Heading", "text", "Thanks for watching", [{ layerId: "heading", property: "text" }], "Text"),
    param("slotALabel", "Slot A label", "text", "Watch next", [{ layerId: "slotALabel", property: "text" }], "Text"),
    param("slotBLabel", "Slot B label", "text", "Most popular", [{ layerId: "slotBLabel", property: "text" }], "Text"),
    param("buttonText", "Button text", "text", "SUBSCRIBE", [{ layerId: "buttonText", property: "text" }], "Text"),
    param("showButton", "Show subscribe button", "checkbox", true, [
      { layerId: "button", property: "visible" }, { layerId: "play", property: "visible" }, { layerId: "buttonText", property: "visible" },
    ], "Layout"),
    param("buttonColor", "Button color", "color", "#dc2626", [{ layerId: "button", property: "fill" }], "Style"),
    param("slotColor", "Slot color", "color", "#1e293b", [{ layerId: "slotA", property: "fill" }, { layerId: "slotB", property: "fill" }], "Style"),
    param("dim", "Backdrop dim", "slider", 0.72, [{ layerId: "dim", property: "opacity" }], "Style", { min: 0, max: 1, step: 0.01 }),
  ],
);

const endCredits = make(
  "builtin-end-thanks", "Thank You Card", "end-card",
  "Centred thank-you with a divider and two lines for socials or a website.", ["end card", "outro", "credits", "thanks"], 8,
  [
    rect("dim", "Backdrop", 960, 540, 1920, 1080, "#0b1020", { opacity: 0.8, motionIn: inM("fade", 0, 0.7), motionOut: outM("fade", 0.6) }),
    label("heading", "Heading", "Thank you", 960, 430, 1400, 150, { fontSize: 140, fontWeight: 800, textAlign: "center" }, {
      motionIn: inM("scale", 0.3, 0.7), motionOut: outM("fade", 0.5),
    }),
    rect("divider", "Divider", 960, 545, 360, 5, "#38bdf8", { motionIn: inM("wipe-right", 0.8, 0.6), motionOut: outM("wipe-right", 0.4) }),
    label("line1", "Line 1", "Follow us @openreel", 960, 630, 1400, 60, { fontSize: 46, fontWeight: 500, textAlign: "center", color: "#e2e8f0" }, {
      motionIn: inM("slide-up", 1.1, 0.5, 30), motionOut: outM("fade", 0.4),
    }),
    label("line2", "Line 2", "openreel.video", 960, 705, 1400, 56, { fontSize: 40, fontWeight: 400, textAlign: "center", color: "#94a3b8", letterSpacing: 2 }, {
      motionIn: inM("slide-up", 1.25, 0.5, 30), motionOut: outM("fade", 0.4),
    }),
  ],
  [
    param("heading", "Heading", "text", "Thank you", [{ layerId: "heading", property: "text" }], "Text"),
    param("line1", "Line 1", "text", "Follow us @openreel", [{ layerId: "line1", property: "text" }], "Text"),
    param("line2", "Line 2", "text", "openreel.video", [{ layerId: "line2", property: "text" }], "Text"),
    param("showLine2", "Show line 2", "checkbox", true, [{ layerId: "line2", property: "visible" }], "Text"),
    param("accent", "Divider color", "color", "#38bdf8", [{ layerId: "divider", property: "fill" }], "Style"),
    param("dim", "Backdrop dim", "slider", 0.8, [{ layerId: "dim", property: "opacity" }], "Style", { min: 0, max: 1, step: 0.01 }),
  ],
);

export const BUILT_IN_GRAPHIC_TEMPLATES: readonly GraphicTemplate[] = [
  lowerThirdClassic,
  lowerThirdMinimal,
  lowerThirdModern,
  titleHero,
  titleBlock,
  titleCinematic,
  calloutInfo,
  calloutHighlight,
  socialBug,
  endSubscribe,
  endCredits,
];

export function getBuiltInGraphicTemplates(): readonly GraphicTemplate[] {
  return BUILT_IN_GRAPHIC_TEMPLATES;
}

export function getBuiltInGraphicTemplate(id: string): GraphicTemplate | undefined {
  return BUILT_IN_GRAPHIC_TEMPLATES.find((template) => template.id === id);
}

export const GRAPHIC_TEMPLATE_CATEGORIES: ReadonlyArray<{ readonly id: GraphicTemplateCategory; readonly name: string }> = [
  { id: "lower-third", name: "Lower thirds" },
  { id: "title", name: "Titles" },
  { id: "callout", name: "Callouts" },
  { id: "end-card", name: "End cards" },
  { id: "custom", name: "My templates" },
];
