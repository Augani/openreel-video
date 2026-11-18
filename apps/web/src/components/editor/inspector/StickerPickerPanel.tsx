import React, { useState, useCallback, useMemo, useRef } from "react";
import { Check, Smile, Sticker, Search, Plus } from "@/icons/lucide-compat";
import { ArrowRight, BadgeCheck, Flag, Hand, ImageIcon, Layers, Leaf, Lightbulb, MessageSquare, Shapes, Upload } from "lucide-react";
import { registerBuiltInStickers } from "./builtin-stickers";
import { rasterizeTwemoji, twemojiUrl } from "./twemoji";
import { Button, cn, Input } from "@openreel/ui";





import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { insertTimelineOverlay } from "../../../stores/project/insert-timeline-overlay";
import {
  stickerLibrary,
  EMOJI_CATEGORIES,
  type EmojiItem,
  type StickerItem,
} from "@openreel/core";

registerBuiltInStickers();

type TabType = "emojis" | "stickers";

const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  all: Layers,
  smileys: Smile,
  gestures: Hand,
  objects: Lightbulb,
  symbols: Shapes,
  nature: Leaf,
  arrows: ArrowRight,
  badges: BadgeCheck,
  banners: Flag,
  callouts: MessageSquare,
  custom: Upload,
};

/** An icon-only category chip: the name is a tooltip and the accessible label, so nothing truncates in a narrow panel. */
const CategoryChip: React.FC<{ id: string; name: string; selected: boolean; onSelect: () => void }> = ({ id, name, selected, onSelect }) => {
  const Icon = CATEGORY_ICONS[id] ?? Sticker;
  return (
    <Button
      type="button"
      variant="ghost"
      title={name}
      aria-label={name}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "inline-flex h-7 w-8 shrink-0 items-center justify-center rounded-[7px] p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg",
      )}
    >
      <Icon size={14} aria-hidden />
    </Button>
  );
};

interface EmojiButtonProps {
  emoji: EmojiItem;
  onAdd: () => void;
}

const EmojiButton: React.FC<EmojiButtonProps> = ({ emoji, onAdd }) => (
  <Button variant="ghost" onClick={onAdd} type="button" aria-label={`Add ${emoji.name}`} style={{ width: "40px", height: "40px" }} className="group/card h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 border-transparent bg-transparent hover:bg-bg-2 p-0 flex items-center justify-center text-2xl">
    <img
      src={twemojiUrl(emoji.emoji)}
      alt=""
      aria-hidden
      draggable={false}
      loading="lazy"
      className="h-6 w-6"
      onError={(event) => {
        // Artwork missing: fall back to the system glyph rather than a broken image.
        const img = event.currentTarget;
        const glyph = document.createElement("span");
        glyph.textContent = emoji.emoji;
        img.replaceWith(glyph);
      }}
    />
  </Button>
);

interface StickerCardProps {
  sticker: StickerItem;
  onAdd: () => void;
}

const StickerCard: React.FC<StickerCardProps> = ({ sticker, onAdd }) => (
  <Button variant="ghost" onClick={onAdd} type="button" aria-label={`Add ${sticker.name}`} className="group/card h-auto min-w-0 whitespace-normal rounded-[7px] text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 bg-bg-2 hover:bg-bg-3 p-2 border border-border flex flex-col items-center gap-1">
    {sticker.imageUrl ? (
      <img
        src={sticker.imageUrl}
        alt={sticker.name}
        className="h-10 w-10 object-contain"
      />
    ) : (
      <ImageIcon size={24} className="text-fg-muted" aria-hidden />
    )}
    <span className="line-clamp-2 max-w-full text-center text-fg-2 font-normal text-[10px] leading-tight">
      {sticker.name}
    </span>
  </Button>
);

export const StickerPickerPanel: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const createStickerClip = useProjectStore((state) => state.createStickerClip);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const select = useUIStore((state) => state.select);

  const [activeTab, setActiveTab] = useState<TabType>("emojis");
  const [selectedCategory, setSelectedCategory] = useState<string>("smileys");
  const [stickerCategory, setStickerCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [, setLibraryVersion] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const emojiCategories = useMemo(() => {
    return EMOJI_CATEGORIES;
  }, []);

  const currentEmojis = useMemo(() => {
    if (searchQuery) {
      return stickerLibrary.searchEmojis(searchQuery);
    }
    return stickerLibrary.getEmojisByCategory(selectedCategory);
  }, [selectedCategory, searchQuery]);

  const libraryStickers = stickerLibrary.getAllStickers();
  const stickerCategories = stickerLibrary
    .getCategories()
    .filter((cat) => libraryStickers.some((sticker) => sticker.category === cat.id));
  const allStickers = searchQuery
    ? stickerLibrary.searchStickers(searchQuery)
    : stickerCategory === "all"
      ? libraryStickers
      : stickerLibrary.getStickersByCategory(stickerCategory);

  const handleAddEmoji = useCallback(
    async (emoji: EmojiItem) => {
      if (!project) return null;
      const artwork = await rasterizeTwemoji(emoji.emoji);
      const created = await insertTimelineOverlay(
        playheadPosition,
        5,
        (trackId) => {
          const clip = stickerLibrary.createEmojiClip(emoji, trackId, playheadPosition, 5);
          return createStickerClip(artwork ? { ...clip, imageUrl: artwork } : clip);
        },
      );
      if (created) {
        select(
          { type: "shape-clip", id: created.id, trackId: created.trackId },
          false,
        );
      }
      return created;
    },
    [createStickerClip, playheadPosition, project, select],
  );

  const handleAddSticker = useCallback(
    async (sticker: StickerItem) => {
      if (!project) return null;
      const created = await insertTimelineOverlay(
        playheadPosition,
        5,
        (trackId) =>
          createStickerClip(
            stickerLibrary.createStickerClip(
              sticker,
              trackId,
              playheadPosition,
              5,
            ),
          ),
      );
      if (created) {
        select(
          { type: "shape-clip", id: created.id, trackId: created.trackId },
          false,
        );
      }
      return created;
    },
    [createStickerClip, playheadPosition, project, select],
  );

  const handleImportSticker = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setImportMessage(null);
      setImportError(null);
      if (!file.type.startsWith("image/")) {
        setImportError("Choose a PNG, JPEG, WebP, GIF, or SVG image.");
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        setImportError("Sticker files must be smaller than 15 MB.");
        return;
      }

      setIsImporting(true);
      try {
        const sticker = await stickerLibrary.importSticker(
          file,
          file.name.replace(/\.[^/.]+$/, "") || "Custom sticker",
        );
        setLibraryVersion((version) => version + 1);
        setActiveTab("stickers");
        setSearchQuery("");
        const created = await handleAddSticker(sticker);
        if (!created) {
          setImportError("The sticker was imported but could not be added to the timeline.");
          return;
        }
        setImportMessage(
          `${sticker.name} added at ${formatStickerTime(playheadPosition)}`,
        );
      } catch (error) {
        console.error("Failed to import custom sticker", error);
        setImportError("Could not read this image. Try exporting it as PNG or WebP.");
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [handleAddSticker, playheadPosition],
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <Button onClick={() => setActiveTab("emojis")} type="button" aria-label="Emojis" className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (activeTab === "emojis" ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"), "flex-1")}>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Smile size={12} aria-hidden />}</span>
          <span className="truncate">{"Emojis"}</span>
        </Button>
        <Button onClick={() => setActiveTab("stickers")} type="button" aria-label="Stickers" className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (activeTab === "stickers" ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"), "flex-1")}>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Sticker size={12} aria-hidden />}</span>
          <span className="truncate">{"Stickers"}</span>
        </Button>
      </div>

      <div className="relative">
        <div className="relative min-w-0 flex-1"><span aria-hidden className="pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2 items-center text-fg-muted">{<Search size={14} aria-hidden />}</span><Input placeholder={
            activeTab === "emojis" ? "Search emojis..." : "Search stickers..."
          }
value={searchQuery}
aria-label={activeTab === "emojis" ? "Search emojis" : "Search stickers"}
onChange={(event) => setSearchQuery(event.currentTarget.value)}
style={{ width: "100%" }}
className={cn("flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50", "h-7 text-[12px]", "pl-8")} /></div>
      </div>

      {activeTab === "emojis" && !searchQuery && (
        <div className="flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Emoji categories">
          {emojiCategories.map((cat) => (
            <CategoryChip key={cat.id} id={cat.id} name={cat.name} selected={selectedCategory === cat.id} onSelect={() => setSelectedCategory(cat.id)} />
          ))}
        </div>
      )}

      {activeTab === "stickers" && !searchQuery && stickerCategories.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Sticker categories">
          <CategoryChip id="all" name="All stickers" selected={stickerCategory === "all"} onSelect={() => setStickerCategory("all")} />
          {stickerCategories.map((cat) => (
            <CategoryChip key={cat.id} id={cat.id} name={cat.name} selected={stickerCategory === cat.id} onSelect={() => setStickerCategory(cat.id)} />
          ))}
        </div>
      )}

      {activeTab === "emojis" && (
        <div className="grid grid-cols-6 gap-1">
          {currentEmojis.length === 0 ? (
            <div className="col-span-6 text-center py-4">
              <Smile
                size={24}
                className="mx-auto mb-2 text-fg-3 opacity-50"
                aria-hidden
              />
              <span className="text-fg-2 font-normal text-[10px]">
                No emojis found
              </span>
            </div>
          ) : (
            currentEmojis.map((emoji) => (
              <EmojiButton
                key={emoji.id}
                emoji={emoji}
                onAdd={() => void handleAddEmoji(emoji)}
              />
            ))
          )}
        </div>
      )}

      {activeTab === "stickers" && (
        <div className="space-y-2">
          {allStickers.length === 0 ? (
            <div className="text-center py-4">
              <Sticker
                size={24}
                className="mx-auto mb-2 text-fg-3 opacity-50"
                aria-hidden
              />
              <span className="text-fg-2 font-normal block text-[10px]">
                {searchQuery ? "No stickers found" : "No stickers yet"}
              </span>
              <span className="text-fg-2 font-normal block text-[9px] mt-1">
                {searchQuery ? "Try a different search." : "Import custom stickers below."}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {allStickers.map((sticker) => (
                <StickerCard
                  key={sticker.id}
                  sticker={sticker}
                  onAdd={() => void handleAddSticker(sticker)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <Input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          aria-label="Choose custom sticker image"
          className="sr-only h-px w-px p-0"
          onChange={(event) =>
            void handleImportSticker(event.currentTarget.files?.[0])
          }
        />
        <Button onClick={() => fileInputRef.current?.click()} type="button" aria-label={(isImporting ? "Importing sticker…" : "Import & Add Sticker").trim() || undefined} disabled={(isImporting)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Plus size={12} aria-hidden />}</span>
          <span className="truncate">{isImporting ? "Importing sticker…" : "Import & Add Sticker"}</span>
        </Button>
        {importMessage ? (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-accent/20 bg-accent-soft px-2 py-1.5 text-[9px] text-accent">
            <Check size={11} aria-hidden />
            <span>{importMessage}</span>
          </div>
        ) : null}
        {importError ? (
          <span role="alert" className="font-normal block mt-2 rounded-md border border-danger/20 bg-danger/10 px-2 py-1.5 text-[9px] text-danger"
          >
            {importError}
          </span>
        ) : null}
      </div>

      <span className="text-fg-2 font-normal block text-[9px] text-center">
        {activeTab === "emojis"
          ? `${stickerLibrary.getAllEmojis().length} emojis available`
          : `${allStickers.length} stickers available`}
      </span>
    </div>
  );
};

function formatStickerTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  const frames = Math.floor((safeSeconds % 1) * 30);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
