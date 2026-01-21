import React, { useCallback, useState, useMemo } from "react";
import { Smile, Sticker, Search, Plus, X } from "lucide-react";
import { Input } from "@openreel/ui";
import { getGraphicsBridge } from "../../../bridges";
import type { StickerItem, EmojiItem } from "@openreel/core";

type TabType = "stickers" | "emojis";

interface StickerPickerProps {
  trackId: string;
  startTime: number;
  duration?: number;
  onSelect?: (clipId: string) => void;
}

/**
 * Category Tab Component
 */
const CategoryTab: React.FC<{
  id: string;
  name: string;
  icon?: string;
  isActive: boolean;
  onClick: () => void;
}> = ({ name, icon, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`
 px-3 py-1.5 text-[10px] rounded-lg whitespace-nowrap transition-colors
 ${
   isActive
     ? "bg-primary text-white font-medium"
     : "bg-background-tertiary text-text-secondary hover:text-text-primary hover:bg-background-secondary"
 }
 `}
  >
    {icon && <span className="mr-1">{icon}</span>}
    {name}
  </button>
);

/**
 * Emoji Grid Item Component
 */
const EmojiGridItem: React.FC<{
  emoji: EmojiItem;
  onSelect: (emoji: EmojiItem) => void;
}> = ({ emoji, onSelect }) => (
  <button
    onClick={() => onSelect(emoji)}
    className="w-10 h-10 flex items-center justify-center text-xl rounded-lg hover:bg-background-tertiary transition-colors"
    title={emoji.name}
  >
    {emoji.emoji}
  </button>
);

/**
 * Sticker Grid Item Component
 */
const StickerGridItem: React.FC<{
  sticker: StickerItem;
  onSelect: (sticker: StickerItem) => void;
}> = ({ sticker, onSelect }) => (
  <button
    onClick={() => onSelect(sticker)}
    className="w-16 h-16 flex items-center justify-center rounded-lg hover:bg-background-tertiary transition-colors overflow-hidden"
    title={sticker.name}
  >
    <img
      src={sticker.imageUrl}
      alt={sticker.name}
      className="max-w-full max-h-full object-contain"
    />
  </button>
);

/**
 * StickerPicker Component
 *
 * - 17.4: Add stickers and emojis from library
 */
export const StickerPicker: React.FC<StickerPickerProps> = ({
  trackId,
  startTime,
  duration = 5,
  onSelect,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>("emojis");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("smileys");

  // Get graphics bridge
  const bridge = useMemo(() => {
    const b = getGraphicsBridge();
    if (!b.isInitialized()) {
      b.initialize();
    }
    return b;
  }, []);

  // Get categories
  const emojiCategories = useMemo(() => bridge.getEmojiCategories(), [bridge]);
  const stickerCategories = useMemo(
    () => bridge.getStickerCategories(),
    [bridge],
  );

  // Get items based on active tab and category
  const items = useMemo(() => {
    if (activeTab === "emojis") {
      if (searchQuery) {
        return bridge.searchEmojis(searchQuery);
      }
      return bridge.getEmojisByCategory(selectedCategory);
    } else {
      if (searchQuery) {
        return bridge.searchStickers(searchQuery);
      }
      return bridge.getStickersByCategory(selectedCategory);
    }
  }, [activeTab, selectedCategory, searchQuery, bridge]);

  // Handle emoji selection
  const handleEmojiSelect = useCallback(
    (emoji: EmojiItem) => {
      const clip = bridge.addEmoji({
        trackId,
        startTime,
        emoji: emoji.emoji,
        duration,
      });

      if (clip) {
        onSelect?.(clip.id);
      }
    },
    [bridge, trackId, startTime, duration, onSelect],
  );

  // Handle sticker selection
  const handleStickerSelect = useCallback(
    (sticker: StickerItem) => {
      const clip = bridge.addSticker({
        trackId,
        startTime,
        stickerId: sticker.id,
        duration,
      });

      if (clip) {
        onSelect?.(clip.id);
      }
    },
    [bridge, trackId, startTime, duration, onSelect],
  );

  // Handle tab change
  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
    setSearchQuery("");
    // Set default category for the tab
    if (tab === "emojis") {
      setSelectedCategory("smileys");
    } else {
      setSelectedCategory("arrows");
    }
  }, []);

  // Handle category change
  const handleCategoryChange = useCallback((categoryId: string) => {
    setSelectedCategory(categoryId);
    setSearchQuery("");
  }, []);

  // Clear search
  const clearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  return (
    <div className="space-y-3">
      {/* Tab Switcher */}
      <div className="flex gap-1 p-1 bg-background-tertiary rounded-lg">
        <button
          onClick={() => handleTabChange("emojis")}
          className={`
 flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] transition-colors
 ${
   activeTab === "emojis"
     ? "bg-background-secondary text-text-primary font-medium"
     : "text-text-secondary hover:text-text-primary"
 }
 `}
        >
          <Smile size={14} />
          Emojis
        </button>
        <button
          onClick={() => handleTabChange("stickers")}
          className={`
 flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] transition-colors
 ${
   activeTab === "stickers"
     ? "bg-background-secondary text-text-primary font-medium"
     : "text-text-secondary hover:text-text-primary"
 }
 `}
        >
          <Sticker size={14} />
          Stickers
        </button>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted z-10"
        />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`Search ${activeTab}...`}
          className="pl-8 pr-8 text-[10px] bg-background-tertiary border-border h-7 text-text-primary"
        />
        {searchQuery && (
          <button
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-background-secondary z-10"
          >
            <X size={12} className="text-text-muted" />
          </button>
        )}
      </div>

      {/* Category Tabs */}
      {!searchQuery && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
          {activeTab === "emojis"
            ? emojiCategories.map((category) => (
                <CategoryTab
                  key={category.id}
                  id={category.id}
                  name={category.name}
                  isActive={selectedCategory === category.id}
                  onClick={() => handleCategoryChange(category.id)}
                />
              ))
            : stickerCategories.map((category) => (
                <CategoryTab
                  key={category.id}
                  id={category.id}
                  name={category.name}
                  icon={category.icon}
                  isActive={selectedCategory === category.id}
                  onClick={() => handleCategoryChange(category.id)}
                />
              ))}
        </div>
      )}

      {/* Items Grid */}
      <div className="max-h-[200px] overflow-y-auto">
        {items.length > 0 ? (
          <div
            className={`grid gap-1 ${
              activeTab === "emojis" ? "grid-cols-6" : "grid-cols-4"
            }`}
          >
            {activeTab === "emojis"
              ? (items as EmojiItem[]).map((emoji) => (
                  <EmojiGridItem
                    key={emoji.id}
                    emoji={emoji}
                    onSelect={handleEmojiSelect}
                  />
                ))
              : (items as StickerItem[]).map((sticker) => (
                  <StickerGridItem
                    key={sticker.id}
                    sticker={sticker}
                    onSelect={handleStickerSelect}
                  />
                ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-background-tertiary flex items-center justify-center">
              {activeTab === "emojis" ? (
                <Smile size={24} className="text-text-muted" />
              ) : (
                <Sticker size={24} className="text-text-muted" />
              )}
            </div>
            <p className="text-[10px] text-text-muted">
              {searchQuery
                ? `No ${activeTab} found for "${searchQuery}"`
                : `No ${activeTab} in this category`}
            </p>
          </div>
        )}
      </div>

      {/* Add Custom Sticker (for stickers tab only) */}
      {activeTab === "stickers" && (
        <div className="pt-2 border-t border-border">
          <button
            onClick={() => {
              // This would open a file picker for custom stickers
              // For now, just show a placeholder
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] text-text-secondary hover:text-text-primary bg-background-tertiary hover:bg-background-secondary rounded-lg transition-colors"
          >
            <Plus size={14} />
            Add Custom Sticker
          </button>
        </div>
      )}
    </div>
  );
};

export default StickerPicker;
