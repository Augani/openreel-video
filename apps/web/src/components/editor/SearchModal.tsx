import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
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
} from "lucide-react";
import { Dialog, DialogContent, Input } from "@openreel/ui";
import { useUIStore } from "../../stores/ui-store";

interface SearchItem {
  id: string;
  nameKey: string;
  categoryKey: string;
  keywords: string[];
  icon: React.FC<{ size?: number; className?: string }>;
  descriptionKey: string;
  sectionId: string;
  clipTypes: Array<"video" | "audio" | "text" | "shape" | "image">;
}

const SEARCHABLE_EFFECTS: SearchItem[] = [
  {
    id: "transform",
    nameKey: "searchEffects.transform",
    categoryKey: "searchEffects.categoryPositionSize",
    keywords: ["position", "scale", "rotate", "move", "resize", "transform"],
    icon: Move,
    descriptionKey: "searchEffects.transformDesc",
    sectionId: "transform",
    clipTypes: ["video", "image", "text", "shape"],
  },
  {
    id: "crop",
    nameKey: "searchEffects.crop",
    categoryKey: "searchEffects.categoryPositionSize",
    keywords: ["crop", "cut", "trim", "frame", "aspect"],
    icon: Focus,
    descriptionKey: "searchEffects.cropDesc",
    sectionId: "crop",
    clipTypes: ["video", "image"],
  },
  {
    id: "speed",
    nameKey: "searchEffects.speedControl",
    categoryKey: "searchEffects.categoryTime",
    keywords: ["speed", "slow", "fast", "time", "duration", "playback"],
    icon: Clock,
    descriptionKey: "searchEffects.speedControlDesc",
    sectionId: "speed",
    clipTypes: ["video", "audio"],
  },
  {
    id: "video-effects",
    nameKey: "searchEffects.videoEffects",
    categoryKey: "searchEffects.categoryVideo",
    keywords: ["brightness", "contrast", "saturation", "blur", "sharpen", "vignette", "effects"],
    icon: Sliders,
    descriptionKey: "searchEffects.videoEffectsDesc",
    sectionId: "video-effects",
    clipTypes: ["video", "image"],
  },
  {
    id: "color-grading",
    nameKey: "searchEffects.colorGrading",
    categoryKey: "searchEffects.categoryVideo",
    keywords: ["color", "grade", "wheels", "curves", "lut", "hsl", "exposure", "temperature"],
    icon: Palette,
    descriptionKey: "searchEffects.colorGradingDesc",
    sectionId: "color-grading",
    clipTypes: ["video", "image"],
  },
  {
    id: "green-screen",
    nameKey: "searchEffects.greenScreen",
    categoryKey: "searchEffects.categoryVideo",
    keywords: ["green", "screen", "chroma", "key", "background", "remove"],
    icon: Eye,
    descriptionKey: "searchEffects.greenScreenDesc",
    sectionId: "green-screen",
    clipTypes: ["video", "image"],
  },
  {
    id: "background-removal",
    nameKey: "searchEffects.backgroundRemoval",
    categoryKey: "searchEffects.categoryVideo",
    keywords: ["background", "remove", "ai", "mask", "cutout", "person"],
    icon: Wand2,
    descriptionKey: "searchEffects.backgroundRemovalDesc",
    sectionId: "background-removal",
    clipTypes: ["video", "image"],
  },
  {
    id: "masking",
    nameKey: "searchEffects.masking",
    categoryKey: "searchEffects.categoryVideo",
    keywords: ["mask", "shape", "feather", "reveal", "hide", "vignette"],
    icon: Layers,
    descriptionKey: "searchEffects.maskingDesc",
    sectionId: "masking",
    clipTypes: ["video", "image"],
  },
  {
    id: "motion-tracking",
    nameKey: "searchEffects.motionTracking",
    categoryKey: "searchEffects.categoryVideo",
    keywords: ["motion", "track", "follow", "pin", "stabilize"],
    icon: Move,
    descriptionKey: "searchEffects.motionTrackingDesc",
    sectionId: "motion-tracking",
    clipTypes: ["video"],
  },
  {
    id: "pip",
    nameKey: "searchEffects.pip",
    categoryKey: "searchEffects.categoryVideo",
    keywords: ["pip", "picture", "overlay", "corner", "position"],
    icon: Square,
    descriptionKey: "searchEffects.pipDesc",
    sectionId: "pip",
    clipTypes: ["video", "image"],
  },
  {
    id: "blending",
    nameKey: "searchEffects.blending",
    categoryKey: "searchEffects.categoryVideo",
    keywords: ["blend", "mode", "multiply", "screen", "overlay", "opacity"],
    icon: Layers,
    descriptionKey: "searchEffects.blendingDesc",
    sectionId: "blending",
    clipTypes: ["video", "image"],
  },
  {
    id: "transform-3d",
    nameKey: "searchEffects.transform3d",
    categoryKey: "searchEffects.categoryVideo",
    keywords: ["3d", "perspective", "rotate", "flip", "tilt"],
    icon: Move,
    descriptionKey: "searchEffects.transform3dDesc",
    sectionId: "transform-3d",
    clipTypes: ["video", "image"],
  },
  {
    id: "keyframes",
    nameKey: "searchEffects.keyframes",
    categoryKey: "searchEffects.categoryAnimation",
    keywords: ["keyframe", "animate", "animation", "ease", "interpolate"],
    icon: Zap,
    descriptionKey: "searchEffects.keyframesDesc",
    sectionId: "keyframes",
    clipTypes: ["video", "image", "text", "shape"],
  },
  {
    id: "transitions",
    nameKey: "searchEffects.transitions",
    categoryKey: "searchEffects.categoryAnimation",
    keywords: ["transition", "fade", "dissolve", "wipe", "slide"],
    icon: Zap,
    descriptionKey: "searchEffects.transitionsDesc",
    sectionId: "transitions",
    clipTypes: ["video", "image"],
  },
  {
    id: "motion-presets",
    nameKey: "searchEffects.motionPresets",
    categoryKey: "searchEffects.categoryAnimation",
    keywords: ["motion", "preset", "zoom", "pan", "shake", "bounce"],
    icon: Zap,
    descriptionKey: "searchEffects.motionPresetsDesc",
    sectionId: "motion-presets",
    clipTypes: ["video", "image"],
  },
  {
    id: "audio-effects",
    nameKey: "searchEffects.audioEffects",
    categoryKey: "searchEffects.categoryAudio",
    keywords: ["audio", "eq", "equalizer", "compressor", "reverb", "delay", "sound"],
    icon: Music2,
    descriptionKey: "searchEffects.audioEffectsDesc",
    sectionId: "audio-effects",
    clipTypes: ["audio", "video"],
  },
  {
    id: "audio-ducking",
    nameKey: "searchEffects.audioDucking",
    categoryKey: "searchEffects.categoryAudio",
    keywords: ["duck", "ducking", "voice", "music", "fade", "auto"],
    icon: Music2,
    descriptionKey: "searchEffects.audioDuckingDesc",
    sectionId: "audio-ducking",
    clipTypes: ["audio", "video"],
  },
  {
    id: "text-properties",
    nameKey: "searchEffects.textProperties",
    categoryKey: "searchEffects.categoryText",
    keywords: ["text", "font", "size", "color", "style", "typography"],
    icon: Type,
    descriptionKey: "searchEffects.textPropertiesDesc",
    sectionId: "text-properties",
    clipTypes: ["text"],
  },
  {
    id: "text-animation",
    nameKey: "searchEffects.textAnimation",
    categoryKey: "searchEffects.categoryText",
    keywords: ["text", "animate", "typewriter", "fade", "slide", "bounce"],
    icon: Type,
    descriptionKey: "searchEffects.textAnimationDesc",
    sectionId: "text-animation",
    clipTypes: ["text"],
  },
  {
    id: "shape-properties",
    nameKey: "searchEffects.shapeProperties",
    categoryKey: "searchEffects.categoryShapes",
    keywords: ["shape", "fill", "stroke", "corner", "radius", "shadow"],
    icon: Square,
    descriptionKey: "searchEffects.shapePropertiesDesc",
    sectionId: "shape-properties",
    clipTypes: ["shape"],
  },
];

const CATEGORIES = [
  { id: "all", nameKey: "searchEffects.categoryAll" },
  { id: "video", nameKey: "searchEffects.categoryVideo", icon: Video },
  { id: "audio", nameKey: "searchEffects.categoryAudio", icon: Music2 },
  { id: "text", nameKey: "searchEffects.categoryText", icon: Type },
  { id: "animation", nameKey: "searchEffects.categoryAnimation", icon: Zap },
];

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { selectedItems, setPanelVisible } = useUIStore();

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
    return "video";
  }, [selectedItems]);

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
        e.categoryKey.toLowerCase().includes(selectedCategory.toLowerCase()),
      );
    }

    if (query.trim()) {
      const searchTerms = query.toLowerCase().split(" ");
      effects = effects.filter((e) => {
        const searchText = [
          t(e.nameKey),
          t(e.descriptionKey),
          ...e.keywords,
          t(e.categoryKey),
        ]
          .join(" ")
          .toLowerCase();
        return searchTerms.every((term) => searchText.includes(term));
      });
    }

    return effects;
  }, [query, selectedCategory, selectedClipType, t]);

  const handleSelect = useCallback(
    (effect: SearchItem) => {
      setPanelVisible("inspector", true);

      setTimeout(() => {
        const sectionElement = document.querySelector(
          `[data-section-id="${effect.sectionId}"]`,
        );
        if (sectionElement) {
          sectionElement.scrollIntoView({ behavior: "smooth", block: "start" });

          const button = sectionElement.querySelector("button");
          if (button) {
            button.click();
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0 top-[15vh] translate-y-0 bg-background-secondary border-border rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={18} className="text-text-muted" />
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              selectedClipType
                ? `Search effects for ${selectedClipType} clip...`
                : t("editor.searchModal.placeholder")
            }
            className="flex-1 bg-transparent border-0 text-text-primary focus-visible:ring-0"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-1 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-background-tertiary border border-border">
            <span className="text-[10px] text-text-muted">ESC</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background-tertiary/50">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                selectedCategory === cat.id
                  ? "bg-primary text-white"
                  : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
              }`}
            >
              {t(cat.nameKey)}
            </button>
          ))}
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {filteredEffects.length === 0 ? (
            <div className="py-12 text-center">
              <Search
                size={32}
                className="mx-auto mb-3 text-text-muted opacity-50"
              />
              <p className="text-sm text-text-muted">{t("editor.searchModal.noEffects")}</p>
              <p className="text-xs text-text-muted mt-1">
                {t("editor.searchModal.tryDifferent")}
              </p>
            </div>
          ) : (
            <div className="py-2">
              {filteredEffects.map((effect, index) => {
                const Icon = effect.icon;
                return (
                  <button
                    key={effect.id}
                    onClick={() => handleSelect(effect)}
                    className={`w-full flex items-center gap-4 px-4 py-3 text-left transition-all ${
                      index === selectedIndex
                        ? "bg-primary/10 border-l-2 border-primary"
                        : "hover:bg-background-tertiary border-l-2 border-transparent"
                    }`}
                  >
                    <div
                      className={`p-2 rounded-lg ${
                        index === selectedIndex
                          ? "bg-primary text-white"
                          : "bg-background-tertiary text-text-secondary"
                      }`}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-medium ${
                            index === selectedIndex
                              ? "text-primary"
                              : "text-text-primary"
                          }`}
                        >
                          {t(effect.nameKey)}
                        </span>
                        <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-background-tertiary">
                          {t(effect.categoryKey)}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted mt-0.5 truncate">
                        {t(effect.descriptionKey)}
                      </p>
                    </div>
                    <div className="text-[10px] text-text-muted">
                      ↵ {t("editor.searchModal.select").replace("Select", "to select")}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border bg-background-tertiary/50 flex items-center justify-between">
          <div className="text-[10px] text-text-muted">
            {t("editor.searchModal.available", { count: filteredEffects.length })}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-text-muted">
            <span>↑↓ {t("editor.searchModal.navigate")}</span>
            <span>↵ {t("editor.searchModal.select")}</span>
            <span>ESC {t("editor.searchModal.close")}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SearchModal;
