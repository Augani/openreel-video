import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Search, X, Video, Music2, Type, Palette, Wand2, Layers, Zap, Square, Move, Focus, Clock, Eye, Sliders } from "@/icons/lucide-compat";
import { Button, Card, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose, ToggleGroup, ToggleGroupItem, ScrollArea, cn } from "@openreel/ui";
import { useUIStore } from "../../stores/ui-store";
import { useProjectStore } from "../../stores/project-store";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";
import type { InspectorClipType } from "./inspector/clip-tabs.config";

interface SearchItem {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  icon: React.ElementType;
  description: string;
  sectionId: string;
  clipTypes: readonly InspectorClipType[];
}
const VISUAL_CLIP_TYPES = ["video", "image", "text", "shape", "svg", "sticker"] as const;

const SEARCHABLE_EFFECTS: SearchItem[] = [
  {
    id: "transform",
    name: "Transform",
    category: "Position & Size",
    keywords: ["position", "scale", "rotate", "move", "resize", "transform"],
    icon: Move,
    description: "Position, scale, and rotate the clip",
    sectionId: "transform",
    clipTypes: VISUAL_CLIP_TYPES,
  },
  {
    id: "crop",
    name: "Crop",
    category: "Position & Size",
    keywords: ["crop", "cut", "trim", "frame", "aspect"],
    icon: Focus,
    description: "Crop and frame the clip",
    sectionId: "crop",
    clipTypes: ["video", "image"],
  },
  {
    id: "speed",
    name: "Speed Control",
    category: "Time",
    keywords: ["speed", "slow", "fast", "time", "duration", "playback"],
    icon: Clock,
    description: "Control playback speed and time remapping",
    sectionId: "speed",
    clipTypes: ["video", "image", "audio"],
  },
  {
    id: "video-effects",
    name: "Visual Effects",
    category: "Video",
    keywords: [
      "brightness",
      "contrast",
      "saturation",
      "blur",
      "sharpen",
      "vignette",
      "effects",
    ],
    icon: Sliders,
    description: "Color, blur, creative, shader, and stylize effects",
    sectionId: "video-effects",
    clipTypes: VISUAL_CLIP_TYPES,
  },
  {
    id: "color-grading",
    name: "Color Grading",
    category: "Video",
    keywords: [
      "color",
      "grade",
      "wheels",
      "curves",
      "lut",
      "hsl",
      "exposure",
      "temperature",
    ],
    icon: Palette,
    description: "Color wheels, curves, LUTs, and HSL adjustments",
    sectionId: "color-grading",
    clipTypes: ["video", "image"],
  },
  {
    id: "green-screen",
    name: "Green Screen",
    category: "Video",
    keywords: ["green", "screen", "chroma", "key", "background", "remove"],
    icon: Eye,
    description: "Chroma key for green/blue screen removal",
    sectionId: "green-screen",
    clipTypes: ["video", "image"],
  },
  {
    id: "background-removal",
    name: "Background Removal",
    category: "Video",
    keywords: ["background", "remove", "ai", "mask", "cutout", "person"],
    icon: Wand2,
    description: "AI-powered background removal",
    sectionId: "background-removal",
    clipTypes: ["video"],
  },
  {
    id: "particle-effects",
    name: "Particle Effects",
    category: "Video",
    keywords: ["particle", "confetti", "dust", "sparkle", "explosion", "snow", "fire"],
    icon: Wand2,
    description: "Add and customize particle presets",
    sectionId: "particle-effects",
    clipTypes: VISUAL_CLIP_TYPES,
  },
  {
    id: "masking",
    name: "Masking",
    category: "Video",
    keywords: ["mask", "shape", "feather", "reveal", "hide", "vignette"],
    icon: Layers,
    description: "Shape masks to reveal or hide areas",
    sectionId: "masking",
    clipTypes: ["video", "image"],
  },
  {
    id: "motion-tracking",
    name: "Motion Tracking",
    category: "Video",
    keywords: ["motion", "track", "follow", "pin", "stabilize"],
    icon: Move,
    description: "Track motion and attach elements",
    sectionId: "motion-tracking",
    clipTypes: ["video"],
  },
  {
    id: "pip",
    name: "Picture-in-Picture",
    category: "Video",
    keywords: ["pip", "picture", "overlay", "corner", "position"],
    icon: Square,
    description: "Position clips as picture-in-picture overlays",
    sectionId: "pip",
    clipTypes: ["video", "image"],
  },
  {
    id: "blending",
    name: "Blend Mode",
    category: "Video",
    keywords: ["blend", "mode", "multiply", "screen", "overlay", "opacity"],
    icon: Layers,
    description: "Blend modes and opacity controls",
    sectionId: "blending",
    clipTypes: VISUAL_CLIP_TYPES,
  },
  {
    id: "transform-3d",
    name: "3D Transform",
    category: "Video",
    keywords: ["3d", "perspective", "rotate", "flip", "tilt"],
    icon: Move,
    description: "3D rotation and perspective effects",
    sectionId: "transform-3d",
    clipTypes: VISUAL_CLIP_TYPES,
  },
  {
    id: "keyframes",
    name: "Keyframes",
    category: "Animation",
    keywords: ["keyframe", "animate", "animation", "ease", "interpolate"],
    icon: Zap,
    description: "Animate properties over time",
    sectionId: "keyframes",
    clipTypes: VISUAL_CLIP_TYPES,
  },
  {
    id: "transitions",
    name: "Transitions",
    category: "Animation",
    keywords: ["transition", "fade", "dissolve", "wipe", "slide"],
    icon: Zap,
    description: "Clip-to-clip transitions",
    sectionId: "transitions",
    clipTypes: VISUAL_CLIP_TYPES,
  },
  {
    id: "motion-presets",
    name: "Motion Presets",
    category: "Animation",
    keywords: ["motion", "preset", "zoom", "pan", "shake", "bounce"],
    icon: Zap,
    description: "Pre-built motion animations",
    sectionId: "motion-presets",
    clipTypes: ["video", "image", "shape", "svg", "sticker"],
  },
  {
    id: "audio-effects",
    name: "Audio Effects",
    category: "Audio",
    keywords: [
      "audio",
      "eq",
      "equalizer",
      "compressor",
      "reverb",
      "delay",
      "sound",
    ],
    icon: Music2,
    description: "EQ, compressor, reverb, and more",
    sectionId: "audio-effects",
    clipTypes: ["audio", "video"],
  },
  {
    id: "audio-ducking",
    name: "Audio Ducking",
    category: "Audio",
    keywords: ["duck", "ducking", "voice", "music", "fade", "auto"],
    icon: Music2,
    description: "Auto-duck music under voice",
    sectionId: "audio-ducking",
    clipTypes: ["audio", "video"],
  },
  {
    id: "text-properties",
    name: "Text Properties",
    category: "Text",
    keywords: ["text", "font", "size", "color", "style", "typography"],
    icon: Type,
    description: "Font, size, color, and text styling",
    sectionId: "text-properties",
    clipTypes: ["text"],
  },
  {
    id: "text-material",
    name: "Text Materials & Shaders",
    category: "Text",
    keywords: ["text", "material", "shader", "paper", "glsl", "gradient", "dissolve"],
    icon: Wand2,
    description: "Browse live shader and Paper material previews for text",
    sectionId: "text-materials",
    clipTypes: ["text"],
  },
  {
    id: "text-animation",
    name: "Text Animation",
    category: "Text",
    keywords: ["text", "animate", "typewriter", "fade", "slide", "bounce"],
    icon: Type,
    description: "Animate text with presets",
    sectionId: "text-animation",
    clipTypes: ["text"],
  },
  {
    id: "shape-properties",
    name: "Shape Properties",
    category: "Shapes",
    keywords: ["shape", "fill", "stroke", "corner", "radius", "shadow"],
    icon: Square,
    description: "Shape fill, stroke, and effects",
    sectionId: "shape-properties",
    clipTypes: ["shape"],
  },
  {
    id: "shape-shader-fill",
    name: "Shape Shader Fill",
    category: "Shapes",
    keywords: ["shape", "fill", "shader", "paper", "material", "gradient"],
    icon: Wand2,
    description: "Apply a live shader material to the selected shape",
    sectionId: "shape-properties",
    clipTypes: ["shape"],
  },
  { id: "svg-properties", name: "SVG Properties", category: "Shapes", keywords: ["svg", "vector", "tint", "color", "entry", "exit"], icon: Square,
    description: "SVG tint and independent entry/exit animations", sectionId: "svg-properties", clipTypes: ["svg"] },
  { id: "motion-path", name: "Motion Path", category: "Animation", keywords: ["path", "curve", "bezier", "move", "motion"], icon: Move,
    description: "Move visual clips along an editable path", sectionId: "motion-path", clipTypes: VISUAL_CLIP_TYPES },
  { id: "emphasis-animation", name: "Emphasis Animation", category: "Animation", keywords: ["emphasis", "pulse", "shake", "bounce", "loop"], icon: Zap,
    description: "Loop an emphasis animation on the selected clip", sectionId: "emphasis-animation", clipTypes: VISUAL_CLIP_TYPES },

];

const CATEGORIES = [
  { id: "all", name: "All" },
  { id: "video", name: "Video", icon: Video },
  { id: "audio", name: "Audio", icon: Music2 },
  { id: "text", name: "Text", icon: Type },
  { id: "animation", name: "Animation", icon: Zap },
];

interface SearchModalProps { isOpen: boolean; onClose: () => void }

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigated = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent hideCloseButton className="flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[672px] min-w-0 flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[672px]"
      onOpenAutoFocus={event => {
        event.preventDefault();
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        navigated.current = false;
        inputRef.current?.focus();
      }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (!navigated.current && returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
      }}>
      <SearchEffectsContent query={query} setQuery={setQuery} category={category} setCategory={setCategory}
        inputRef={inputRef} onClose={onClose} onNavigate={() => { navigated.current = true; }} />
    </DialogContent>
  </Dialog>;
};

function SearchEffectsContent({ query, setQuery, category, setCategory, inputRef, onClose, onNavigate }: {
  query: string; setQuery: (value: string) => void; category: string; setCategory: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>; onClose: () => void; onNavigate: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { selectedItems, setPanelVisible } = useUIStore(useShallow(state => ({ selectedItems: state.selectedItems, setPanelVisible: state.setPanelVisible })));
  const project = useProjectStore(state => state.project);
  const owner = useRef(project.id);
  const selected = selectedItems.find(item => item.type === "clip" || item.type === "text-clip" || item.type === "shape-clip");
  const selectedClipType = useMemo<InspectorClipType | null>(() => {
    if (!selected) return null;
    const state = useProjectStore.getState();
    if (project.textClips?.some(clip => clip.id === selected.id) || state.getTextClip(selected.id)) return "text";
    if (project.svgClips?.some(clip => clip.id === selected.id) || state.getSVGClip(selected.id)) return "svg";
    if (project.stickerClips?.some(clip => clip.id === selected.id) || state.getStickerClip(selected.id)) return "sticker";
    if (project.shapeClips?.some(clip => clip.id === selected.id) || state.getShapeClip(selected.id)) return "shape";
    if (selected.type === "text-clip") return "text";
    if (selected.type === "shape-clip") return "shape";
    const track = project.timeline.tracks.find(track => track.clips.some(clip => clip.id === selected.id));
    const clip = track?.clips.find(clip => clip.id === selected.id);
    const media = project.mediaLibrary.items.find(item => item.id === clip?.mediaId);
    if (track?.type === "audio" || media?.type === "audio") return "audio";
    if (track?.type === "image" || media?.type === "image") return "image";
    return "video";
  }, [project, selected]);
  const filteredEffects = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return SEARCHABLE_EFFECTS.filter(effect => (!selectedClipType || effect.clipTypes.includes(selectedClipType))
      && (category === "all" || effect.category.toLowerCase().includes(category))
      && terms.every(term => [effect.name, effect.description, ...effect.keywords, effect.category].join(" ").toLowerCase().includes(term)));
  }, [query, category, selectedClipType]);
  const activeIndex = Math.min(selectedIndex, Math.max(0, filteredEffects.length - 1));
  useEffect(() => setSelectedIndex(0), [query, category, selected?.id, selectedClipType]);
  useEffect(() => {
    if (project.id !== owner.current) onClose();
  }, [project.id, onClose]);
  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-search-result="${activeIndex}"]`);
    element?.scrollIntoView?.({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" });
  }, [activeIndex, filteredEffects]);
  const handleSelect = useCallback((effect: SearchItem) => {
    if (useProjectStore.getState().project.id !== owner.current) return;
    setPanelVisible("inspector", true);
    const current = useUIStore.getState().selectedItems.find(item => item.type === "clip" || item.type === "text-clip" || item.type === "shape-clip");
    if (current?.id !== selected?.id) return;
    onNavigate();
    if (current) useInspectorNavigationStore.getState().requestSection(effect.sectionId, current.id);
    onClose();
  }, [onClose, onNavigate, selected?.id, setPanelVisible]);

  return <>
    <DialogHeader className="relative shrink-0 border-b border-border p-4 pr-14 text-left">
      <DialogTitle className="flex items-center gap-2 text-base"><Search size={18} className="text-primary" aria-hidden />Search Effects</DialogTitle>
      <DialogDescription>{selectedClipType ? `Find tools for the selected ${selectedClipType} clip.` : "Find effects and tools across the inspector."}</DialogDescription>
      <DialogClose asChild><Button variant="ghost" size="icon-sm" aria-label="Close dialog" className="absolute right-3 top-3"><X size={16} aria-hidden /></Button></DialogClose>
    </DialogHeader>
    <div className="min-w-0 shrink-0 space-y-3 p-4 pb-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input ref={inputRef} aria-label="Search effects" aria-controls={listId} type="text" value={query}
            onChange={event => setQuery(event.target.value)} placeholder={selectedClipType ? `Search effects for ${selectedClipType} clip...` : "Search all effects and tools..."}
            className="min-w-0 pl-9" onKeyDown={event => {
              if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex(Math.max(0, Math.min(filteredEffects.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
              } else if (event.key === "Enter" && filteredEffects[activeIndex]) {
                event.preventDefault(); handleSelect(filteredEffects[activeIndex]);
              }
            }} />
        </div>
        {query && <Button variant="ghost" size="icon-sm" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} aria-hidden /></Button>}
        <kbd className="rounded border border-border bg-bg-2 px-1.5 font-mono text-[10px] text-fg-2">Esc</kbd>
      </div>
      <div className="min-w-0 overflow-x-auto pb-1">
        <ToggleGroup type="single" value={category} aria-label="Effect category" className="min-w-max justify-start gap-1" onValueChange={value => { if (value) setCategory(value); }}>
          {CATEGORIES.map(cat => { const Icon = cat.icon; return <ToggleGroupItem key={cat.id} value={cat.id} className="h-8 gap-1.5 px-2 text-xs">{Icon && <Icon size={14} aria-hidden />}{cat.name}</ToggleGroupItem>; })}
        </ToggleGroup>
      </div>
    </div>
    <ScrollArea className="min-h-0 flex-1 px-4" style={{ height: "min(380px, 50dvh)" }}>
      <div ref={listRef} id={listId} role="list" aria-label="Search results" className="space-y-2 pb-3">
        {filteredEffects.length === 0 ? <div role="status" className="space-y-2 py-10 text-center"><Search size={32} className="mx-auto text-fg-muted opacity-50" aria-hidden /><p className="text-sm font-semibold">No effects found</p><p className="text-xs text-fg-2">Try a different search term or category.</p></div>
          : filteredEffects.map((effect, index) => { const Icon = effect.icon; const highlighted = activeIndex === index; return <div key={effect.id} role="listitem">
            <Button variant="ghost" onClick={() => handleSelect(effect)} onFocus={() => setSelectedIndex(index)} type="button" data-search-result={index}
              aria-label={`Open ${effect.name}`} aria-current={highlighted ? "true" : undefined}
              className={cn("h-auto w-full min-w-0 justify-start whitespace-normal rounded-[7px] border p-3 text-left", highlighted ? "border-primary bg-bg-2" : "border-border bg-bg-1 hover:bg-bg-2")}>
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", highlighted ? "bg-primary text-primary-foreground" : "bg-bg-2 text-fg-2")}><Icon size={16} aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className={cn("truncate text-xs font-bold", highlighted ? "text-accent" : "text-fg")}>{effect.name}</span>
                <Card className="shrink-0 rounded border-0 bg-bg-2 px-1 py-0 text-[10px] font-normal text-fg-2 shadow-none">{effect.category}</Card></span>
                <span className="mt-0.5 block truncate text-xs font-normal text-fg-2">{effect.description}</span></span>
              <kbd className="shrink-0 rounded border border-border bg-bg-2 px-1 font-mono text-[10px] text-fg-2">Enter</kbd>
            </Button>
          </div>; })}
      </div>
    </ScrollArea>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-[10px] text-fg-2">
      <span>{filteredEffects.length} effect{filteredEffects.length !== 1 ? "s" : ""} available</span>
      <span><kbd>↑</kbd> <kbd>↓</kbd> Navigate · <kbd>Enter</kbd> Select</span>
    </div>
  </>;
}
