import type { MobileEditorIconName } from "./MobileEditorIcon";

export type MobileToolId =
  | "edit" | "audio" | "text" | "captions" | "effects" | "find"
  | "split" | "trim" | "speed" | "volume" | "animate" | "crop" | "filters" | "replace" | "delete"
  | "reverse" | "freeze" | "duplicate" | "transitions" | "music" | "sfx" | "voiceover" | "noise"
  | "silence" | "cutout" | "vertical" | "enhance" | "media" | "graphics" | "generate" | "recipes" | "settings" | "inspector" | "timeline" | "chat" | "reset-transform";

export interface MobileTool {
  id: MobileToolId;
  label: string;
  icon: MobileEditorIconName;
  keywords?: string;
  ai?: boolean;
  danger?: boolean;
}

export const MOBILE_MAIN_TOOLS: readonly MobileTool[] = [
  { id: "edit", label: "Edit", icon: "edit" },
  { id: "audio", label: "Audio", icon: "audio" },
  { id: "text", label: "Text", icon: "text" },
  { id: "captions", label: "Captions", icon: "captions" },
  { id: "effects", label: "Effects", icon: "effects" },
  { id: "find", label: "Find tool", icon: "search" },
];

export const MOBILE_CLIP_TOOLS: readonly MobileTool[] = [
  { id: "split", label: "Split", icon: "split" },
  { id: "speed", label: "Speed", icon: "speed" },
  { id: "volume", label: "Volume", icon: "volume" },
  { id: "animate", label: "Animate", icon: "animate" },
  { id: "crop", label: "Crop", icon: "crop" },
  { id: "filters", label: "Filters", icon: "filters" },
  { id: "replace", label: "Replace", icon: "replace" },
  { id: "delete", label: "Delete", icon: "del", danger: true },
];

export const MOBILE_TOOL_GROUPS: readonly { title: string; items: readonly MobileTool[] }[] = [
  { title: "Edit", items: [
    MOBILE_CLIP_TOOLS[0], { id: "trim", label: "Trim", icon: "trim" }, MOBILE_CLIP_TOOLS[1], MOBILE_CLIP_TOOLS[4],
    { id: "reverse", label: "Reverse", icon: "reverse", keywords: "direction backwards" },
    { id: "freeze", label: "Freeze", icon: "freeze", keywords: "hold frame speed curves" },
    { id: "duplicate", label: "Duplicate", icon: "dup", keywords: "copy" },
    { id: "transitions", label: "Transitions", icon: "transition", keywords: "crossfade dissolve wipe" },
  ] },
  { title: "Audio", items: [
    { id: "music", label: "Music", icon: "audio", keywords: "library soundtrack" },
    { id: "sfx", label: "Sound FX", icon: "sfx", keywords: "sound effects library" },
    { id: "voiceover", label: "Voiceover", icon: "mic", keywords: "record microphone narration" },
    { id: "noise", label: "Fix noise", icon: "noise", keywords: "denoise reduce background audio" },
  ] },
  { title: "AI", items: [
    { id: "silence", label: "Remove pauses", icon: "sparkle", ai: true, keywords: "silence audio cut" },
    { id: "cutout", label: "Cut out person", icon: "person", ai: true, keywords: "remove background segmentation" },
    { id: "vertical", label: "Make vertical", icon: "vertical", ai: true, keywords: "reframe portrait resize" },
    { id: "enhance", label: "Enhance voice", icon: "mic", ai: true, keywords: "audio speech dialogue" },
  ] },
  { title: "More tools", items: [
    { id: "media", label: "Media", icon: "tmpl", keywords: "import video image photo stock record" },
    MOBILE_MAIN_TOOLS[2], MOBILE_MAIN_TOOLS[3], MOBILE_MAIN_TOOLS[4],
    { id: "graphics", label: "Graphics", icon: "sticker", keywords: "shape svg sticker background shader" },
    { id: "generate", label: "AI Generate", icon: "sparkle", ai: true, keywords: "image video speech text to speech" },
    { id: "recipes", label: "Recipes", icon: "tmpl", keywords: "presets save clip effects" },
    { id: "settings", label: "Project settings", icon: "adjust", keywords: "resolution frame rate preferences" },
    { id: "inspector", label: "Advanced controls", icon: "adjust", keywords: "transform keyframes masks text shades shaders materials color grading blending particles" },
    { id: "reset-transform", label: "Reset clip transform", icon: "adjust", keywords: "reset transform position scale rotation opacity default" },
    { id: "timeline", label: "Timeline", icon: "trim", keywords: "tracks markers snapping zoom range layers" },
    { id: "chat", label: "AI assist", icon: "sparkle", ai: true, keywords: "editor chat assistant" },
    MOBILE_CLIP_TOOLS[7],
  ] },
];

export const MOBILE_QUICK_TOOLS = [
  MOBILE_CLIP_TOOLS[0], MOBILE_MAIN_TOOLS[3], MOBILE_CLIP_TOOLS[1], MOBILE_TOOL_GROUPS[2].items[0],
] as const;
