import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import {
  Search,
  X,
  Video,
  Music2,
  Type,
  Palette,
  Wand2,
  Layers,
  Zap,
  Square,
  Move,
  Focus,
  Clock,
  Eye,
  Sliders,
} from "@/icons/lucide-compat";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftEmptyState as EmptyState } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftKbd as Kbd } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useUIStore } from "../../stores/ui-store";
import { useProjectStore } from "../../stores/project-store";

interface SearchItem {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  icon: React.ElementType;
  description: string;
  sectionId: string;
  clipTypes: Array<"video" | "audio" | "text" | "shape" | "image">;
}

const SEARCHABLE_EFFECTS: SearchItem[] = [
  {
    id: "transform",
    name: "Transform",
    category: "Position & Size",
    keywords: ["position", "scale", "rotate", "move", "resize", "transform"],
    icon: Move,
    description: "Position, scale, and rotate the clip",
    sectionId: "transform",
    clipTypes: ["video", "image", "text", "shape"],
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
    clipTypes: ["video", "audio"],
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
    clipTypes: ["video", "image", "text", "shape"],
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
    clipTypes: ["video", "image"],
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
    clipTypes: ["video", "image"],
  },
  {
    id: "transform-3d",
    name: "3D Transform",
    category: "Video",
    keywords: ["3d", "perspective", "rotate", "flip", "tilt"],
    icon: Move,
    description: "3D rotation and perspective effects",
    sectionId: "transform-3d",
    clipTypes: ["video", "image"],
  },
  {
    id: "keyframes",
    name: "Keyframes",
    category: "Animation",
    keywords: ["keyframe", "animate", "animation", "ease", "interpolate"],
    icon: Zap,
    description: "Animate properties over time",
    sectionId: "keyframes",
    clipTypes: ["video", "image", "text", "shape"],
  },
  {
    id: "transitions",
    name: "Transitions",
    category: "Animation",
    keywords: ["transition", "fade", "dissolve", "wipe", "slide"],
    icon: Zap,
    description: "Clip-to-clip transitions",
    sectionId: "transitions",
    clipTypes: ["video", "image"],
  },
  {
    id: "motion-presets",
    name: "Motion Presets",
    category: "Animation",
    keywords: ["motion", "preset", "zoom", "pan", "shake", "bounce"],
    icon: Zap,
    description: "Pre-built motion animations",
    sectionId: "motion-presets",
    clipTypes: ["video", "image"],
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
    sectionId: "text-properties",
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
];

const CATEGORIES = [
  { id: "all", name: "All" },
  { id: "video", name: "Video", icon: Video },
  { id: "audio", name: "Audio", icon: Music2 },
  { id: "text", name: "Text", icon: Type },
  { id: "animation", name: "Animation", icon: Zap },
];

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { selectedItems, setPanelVisible } = useUIStore();
  const project = useProjectStore((state) => state.project);

  const selectedClipType = useMemo(() => {
    const clipItem = selectedItems.find(
      (item) =>
        item.type === "clip" ||
        item.type === "text-clip" ||
        item.type === "shape-clip",
    );
    if (!clipItem) return null;
    if (clipItem.type === "text-clip") return "text";
    if (clipItem.type === "shape-clip") return "shape";
    const track = project.timeline.tracks.find((candidate) =>
      candidate.clips.some((clip) => clip.id === clipItem.id),
    );
    if (track?.type === "audio") return "audio";
    const clip = track?.clips.find((candidate) => candidate.id === clipItem.id);
    const media = clip
      ? project.mediaLibrary.items.find((item) => item.id === clip.mediaId)
      : undefined;
    if (track?.type === "image" || media?.type === "image") return "image";
    return "video";
  }, [project.mediaLibrary.items, project.timeline.tracks, selectedItems]);

  const filteredEffects = useMemo(() => {
    let effects = SEARCHABLE_EFFECTS;

    if (selectedClipType) {
      effects = effects.filter((e) =>
        e.clipTypes.includes(
          selectedClipType as "video" | "audio" | "text" | "shape" | "image",
        ),
      );
    }

    if (selectedCategory !== "all") {
      effects = effects.filter((e) =>
        e.category.toLowerCase().includes(selectedCategory.toLowerCase()),
      );
    }

    if (query.trim()) {
      const searchTerms = query.toLowerCase().split(" ");
      effects = effects.filter((e) => {
        const searchText = [e.name, e.description, ...e.keywords, e.category]
          .join(" ")
          .toLowerCase();
        return searchTerms.every((term) => searchText.includes(term));
      });
    }

    return effects;
  }, [query, selectedCategory, selectedClipType]);

  const handleSelect = useCallback(
    (effect: SearchItem) => {
      setPanelVisible("inspector", true);

      setTimeout(() => {
        const sectionElement = document.querySelector(
          `[data-section-id="${effect.sectionId}"]`,
        );
        if (sectionElement) {
          sectionElement.scrollIntoView({ behavior: "smooth", block: "start" });

          const header = sectionElement.querySelector<HTMLElement>(
            '[data-slot="toolcraft-panel-section-header"]',
          );
          if (header?.getAttribute("aria-expanded") === "false") {
            header.click();
          }

          sectionElement.classList.add(
            "ring-2",
            "ring-primary",
            "ring-offset-2",
          );
          setTimeout(() => {
            sectionElement.classList.remove(
              "ring-2",
              "ring-primary",
              "ring-offset-2",
            );
          }, 2000);
        }
      }, 100);

      onClose();
    },
    [onClose, setPanelVisible],
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, selectedCategory]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, filteredEffects.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && filteredEffects[selectedIndex]) {
        e.preventDefault();
        handleSelect(filteredEffects[selectedIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, filteredEffects, selectedIndex, handleSelect]);

  useEffect(() => {
    if (listRef.current && filteredEffects[selectedIndex]) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [selectedIndex, filteredEffects]);

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      width={672}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title="Search Effects"
            subtitle={
              selectedClipType
                ? `Find tools for the selected ${selectedClipType} clip.`
                : "Find effects and tools across the inspector."
            }
            onOpenChange={(open) => !open && onClose()}
            startContent={<Search size={18} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <ToolcraftTextInputControl
                    ref={inputRef}
                    label="Search effects"
                    isLabelHidden
                    type="text"
                    value={query}
                    onChange={setQuery}
                    placeholder={
                      selectedClipType
                        ? `Search effects for ${selectedClipType} clip...`
                        : "Search all effects and tools..."
                    }
                    startIcon={<Search size={16} aria-hidden />}
                    width="100%"
                    hasAutoFocus
                  />
                </div>
                {query && (
                  <IconButton
                    label="Clear search"
                    onClick={() => setQuery("")}
                    variant="ghost"
                    size="sm"
                    icon={<X size={14} aria-hidden />}
                  />
                )}
                <Kbd keys="escape" />
              </div>

              <ToolcraftSegmentedControl
                ariaLabel="Effect category"
                value={selectedCategory}
                onChange={setSelectedCategory}
                options={CATEGORIES.map((cat) => {
                  const CategoryIcon = cat.icon;
                  return {
                    value: cat.id,
                    label: cat.name,
                    icon: CategoryIcon ? (
                      <CategoryIcon size={14} aria-hidden />
                    ) : undefined,
                  };
                })}
              />

              <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
                {filteredEffects.length === 0 ? (
                  <EmptyState
                    title="No effects found"
                    description="Try a different search term or category."
                    icon={<Search size={32} className="text-text-muted opacity-50" aria-hidden />}
                    isCompact
                  />
                ) : (
                  <div className="space-y-2 py-1">
                    {filteredEffects.map((effect, index) => {
                      const Icon = effect.icon;
                      const selected = index === selectedIndex;
                      return (
                        <ClickableCard
                          key={effect.id}
                          label={`Open ${effect.name}`}
                          onClick={() => handleSelect(effect)}
                          padding={3}
                          variant={selected ? "green" : "default"}
                          className={`border ${
                            selected ? "border-primary" : "border-border"
                          }`}
                        >
                          <div className="flex items-center gap-4 text-left">
                            <div
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                selected
                                  ? "bg-primary text-white"
                                  : "bg-background-tertiary text-text-secondary"
                              }`}
                            >
                              <Icon size={16} aria-hidden />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Text
                                  type="label"
                                  weight="bold"
                                  color={selected ? "active" : "primary"}
                                  maxLines={1}
                                >
                                  {effect.name}
                                </Text>
                                <Card variant="muted" padding={1} className="shrink-0">
                                  <Text
                                    type="supporting"
                                    color="secondary"
                                    className="text-[10px]"
                                  >
                                    {effect.category}
                                  </Text>
                                </Card>
                              </div>
                              <Text
                                type="supporting"
                                color="secondary"
                                display="block"
                                maxLines={1}
                                className="mt-0.5"
                              >
                                {effect.description}
                              </Text>
                            </div>
                            <Kbd keys="enter" />
                          </div>
                        </ClickableCard>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex items-center justify-between gap-3">
              <Text type="supporting" color="secondary" className="text-[10px]">
                {filteredEffects.length} effect
                {filteredEffects.length !== 1 ? "s" : ""} available
              </Text>
              <div className="flex items-center gap-2">
                <Kbd keys="up" />
                <Kbd keys="down" />
                <Text type="supporting" color="secondary" className="text-[10px]">
                  Navigate
                </Text>
                <Kbd keys="enter" />
                <Text type="supporting" color="secondary" className="text-[10px]">
                  Select
                </Text>
              </div>
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};

export default SearchModal;
