import React, { useState, useCallback, useMemo } from "react";
import { Smile, Sticker, Search, Plus } from "lucide-react";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import {
  stickerLibrary,
  EMOJI_CATEGORIES,
  type EmojiItem,
  type StickerItem,
} from "@openreel/core";

type TabType = "emojis" | "stickers";

interface EmojiButtonProps {
  emoji: EmojiItem;
  onAdd: () => void;
}

const EmojiButton: React.FC<EmojiButtonProps> = ({ emoji, onAdd }) => (
  <button
    onClick={onAdd}
    className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-background-tertiary rounded-lg transition-colors"
    title={emoji.name}
  >
    {emoji.emoji}
  </button>
);

interface StickerCardProps {
  sticker: StickerItem;
  onAdd: () => void;
}

const StickerCard: React.FC<StickerCardProps> = ({ sticker, onAdd }) => (
  <button
    onClick={onAdd}
    className="p-2 rounded-lg border border-border bg-background-tertiary hover:border-primary/50 transition-colors flex flex-col items-center gap-1"
    title={sticker.name}
  >
    {sticker.imageUrl ? (
      <img
        src={sticker.imageUrl}
        alt={sticker.name}
        className="w-8 h-8 object-contain"
      />
    ) : (
      <span className="text-2xl">{sticker.name.slice(0, 2)}</span>
    )}
    <span className="text-[8px] text-text-muted truncate max-w-full">
      {sticker.name}
    </span>
  </button>
);

export const StickerPickerPanel: React.FC = () => {
  const addTrack = useProjectStore((state) => state.addTrack);
  const project = useProjectStore((state) => state.project);
  const createStickerClip = useProjectStore((state) => state.createStickerClip);

  const [activeTab, setActiveTab] = useState<TabType>("emojis");
  const [selectedCategory, setSelectedCategory] = useState<string>("smileys");
  const [searchQuery, setSearchQuery] = useState("");

  const emojiCategories = useMemo(() => {
    return EMOJI_CATEGORIES;
  }, []);

  const currentEmojis = useMemo(() => {
    if (searchQuery) {
      return stickerLibrary.searchEmojis(searchQuery);
    }
    return stickerLibrary.getEmojisByCategory(selectedCategory);
  }, [selectedCategory, searchQuery]);

  const allStickers = useMemo(() => {
    if (searchQuery) {
      return stickerLibrary.searchStickers(searchQuery);
    }
    return stickerLibrary.getAllStickers();
  }, [searchQuery]);

  const stickerCategories = useMemo(() => {
    return stickerLibrary.getCategories();
  }, []);

  const handleAddEmoji = useCallback(
    (emoji: EmojiItem) => {
      if (!project) return;

      let graphicsTrack = project.timeline.tracks.find(
        (t) => t.type === "graphics",
      );
      if (!graphicsTrack) {
        addTrack("graphics");
        graphicsTrack = project.timeline.tracks.find(
          (t) => t.type === "graphics",
        );
      }

      if (graphicsTrack) {
        const clip = stickerLibrary.createEmojiClip(
          emoji,
          graphicsTrack.id,
          0,
          5,
        );
        createStickerClip(clip);
      }
    },
    [project, addTrack, createStickerClip],
  );

  const handleAddSticker = useCallback(
    (sticker: StickerItem) => {
      if (!project) return;

      let graphicsTrack = project.timeline.tracks.find(
        (t) => t.type === "graphics",
      );
      if (!graphicsTrack) {
        addTrack("graphics");
        graphicsTrack = project.timeline.tracks.find(
          (t) => t.type === "graphics",
        );
      }

      if (graphicsTrack) {
        const clip = stickerLibrary.createStickerClip(
          sticker,
          graphicsTrack.id,
          0,
          5,
        );
        createStickerClip(clip);
      }
    },
    [project, addTrack, createStickerClip],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-gradient-to-r from-pink-500/20 to-rose-500/20 rounded-lg border border-pink-500/30">
        <Smile size={16} className="text-primary" />
        <div>
          <span className="text-[11px] font-medium text-text-primary">
            Stickers & Emojis
          </span>
          <p className="text-[9px] text-text-muted">
            Add fun elements to your video
          </p>
        </div>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => setActiveTab("emojis")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] transition-colors ${
            activeTab === "emojis"
              ? "bg-primary text-white font-medium"
              : "bg-background-tertiary text-text-secondary hover:text-text-primary"
          }`}
        >
          <Smile size={12} />
          Emojis
        </button>
        <button
          onClick={() => setActiveTab("stickers")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] transition-colors ${
            activeTab === "stickers"
              ? "bg-primary text-white font-medium"
              : "bg-background-tertiary text-text-secondary hover:text-text-primary"
          }`}
        >
          <Sticker size={12} />
          Stickers
        </button>
      </div>

      <div className="relative">
        <Search
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted z-10"
        />
        <Input
          type="text"
          placeholder={
            activeTab === "emojis" ? "Search emojis..." : "Search stickers..."
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 text-[10px] bg-background-secondary border-border h-8"
        />
      </div>

      {activeTab === "emojis" && !searchQuery && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {emojiCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-2 py-1 rounded text-[9px] whitespace-nowrap transition-colors flex items-center gap-1 ${
                selectedCategory === cat.id
                  ? "bg-primary text-white"
                  : "bg-background-tertiary text-text-muted hover:text-text-primary"
              }`}
            >
              <span>{cat.emojis[0]?.emoji || "😀"}</span>
              <span>{cat.name}</span>
            </button>
          ))}
        </div>
      )}

      {activeTab === "stickers" &&
        !searchQuery &&
        stickerCategories.length > 0 && (
          <div className="flex gap-1 overflow-x-auto pb-1">
            {stickerCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2 py-1 rounded text-[9px] whitespace-nowrap transition-colors ${
                  selectedCategory === cat.id
                    ? "bg-primary text-white"
                    : "bg-background-tertiary text-text-muted hover:text-text-primary"
                }`}
              >
                {cat.icon && <span className="mr-1">{cat.icon}</span>}
                {cat.name}
              </button>
            ))}
          </div>
        )}

      {activeTab === "emojis" && (
        <div className="grid grid-cols-6 gap-1 max-h-48 overflow-y-auto">
          {currentEmojis.length === 0 ? (
            <div className="col-span-6 text-center py-4">
              <Smile
                size={24}
                className="mx-auto mb-2 text-text-muted opacity-50"
              />
              <p className="text-[10px] text-text-muted">No emojis found</p>
            </div>
          ) : (
            currentEmojis.map((emoji) => (
              <EmojiButton
                key={emoji.id}
                emoji={emoji}
                onAdd={() => handleAddEmoji(emoji)}
              />
            ))
          )}
        </div>
      )}

      {activeTab === "stickers" && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {allStickers.length === 0 ? (
            <div className="text-center py-4">
              <Sticker
                size={24}
                className="mx-auto mb-2 text-text-muted opacity-50"
              />
              <p className="text-[10px] text-text-muted">No stickers yet</p>
              <p className="text-[9px] text-text-muted mt-1">
                Import custom stickers below
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {allStickers.map((sticker) => (
                <StickerCard
                  key={sticker.id}
                  sticker={sticker}
                  onAdd={() => handleAddSticker(sticker)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <button
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.onchange = async (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                await stickerLibrary.importSticker(
                  file,
                  file.name.replace(/\.[^/.]+$/, ""),
                );
              }
            };
            input.click();
          }}
          className="w-full flex items-center justify-center gap-2 py-2 text-[10px] text-text-secondary hover:text-text-primary bg-background-tertiary rounded-lg transition-colors"
        >
          <Plus size={12} />
          <span>Import Custom Sticker</span>
        </button>
      </div>

      <p className="text-[9px] text-text-muted text-center">
        {activeTab === "emojis"
          ? `${stickerLibrary.getAllEmojis().length} emojis available`
          : `${allStickers.length} stickers available`}
      </p>
    </div>
  );
};

export default StickerPickerPanel;
