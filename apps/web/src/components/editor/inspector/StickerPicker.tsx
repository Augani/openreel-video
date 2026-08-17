import React, { useCallback, useState, useMemo } from "react";
import { Smile, Sticker, Search, Plus, X } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { getGraphicsBridge } from "../../../bridges";
import type { StickerItem, EmojiItem } from "@openreel/core";
import { useTranslation } from "react-i18next";

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
  <Button
    label={`${icon ? `${icon} ` : ""}${name}`}
    onClick={onClick}
    variant={isActive ? "primary" : "secondary"}
    size="sm"
    className="whitespace-nowrap text-[10px]"
  />
);

/**
 * Emoji Grid Item Component
 */
const EmojiGridItem: React.FC<{
  emoji: EmojiItem;
  onSelect: (emoji: EmojiItem) => void;
}> = ({ emoji, onSelect }) => {
  const { t } = useTranslation();
  return (
  <ClickableCard
    label={t(emoji.name)}
    onClick={() => onSelect(emoji)}
    width={40}
    height={40}
    padding={0}
    variant="transparent"
    className="flex items-center justify-center text-xl"
  >
    {emoji.emoji}
  </ClickableCard>
);
};

/**
 * Sticker Grid Item Component
 */
const StickerGridItem: React.FC<{
  sticker: StickerItem;
  onSelect: (sticker: StickerItem) => void;
}> = ({ sticker, onSelect }) => {
  const { t } = useTranslation();
  return (
  <ClickableCard
    label={t(sticker.name)}
    onClick={() => onSelect(sticker)}
    width={64}
    height={64}
    padding={1}
    variant="transparent"
    className="flex items-center justify-center overflow-hidden"
  >
    <img
      src={sticker.imageUrl}
      alt={t(sticker.name)}
      className="max-w-full max-h-full object-contain"
    />
  </ClickableCard>
);
};

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
  const { t } = useTranslation();
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
      <div className="flex gap-1 p-1 bg-bg-2 rounded-lg">
        <Button
          label={t("Emojis")}
          icon={<Smile size={14} aria-hidden />}
          variant={activeTab === "emojis" ? "primary" : "secondary"}
          size="sm"
          onClick={() => handleTabChange("emojis")}
          className="flex-1"
        />
        <Button
          label={t("Stickers")}
          icon={<Sticker size={14} aria-hidden />}
          variant={activeTab === "stickers" ? "primary" : "secondary"}
          size="sm"
          onClick={() => handleTabChange("stickers")}
          className="flex-1"
        />
      </div>

      {/* Search Input */}
      <div className="relative">
        <ToolcraftTextInputControl
          label={`Search ${activeTab}`}
          isLabelHidden
          size="sm"
          width="100%"
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={`Search ${activeTab}...`}
          startIcon={<Search size={14} aria-hidden />}
        />
        {searchQuery && (
          <IconButton
            label={t("Clear search")}
            icon={<X size={12} className="text-fg-3" aria-hidden />}
            variant="ghost"
            size="sm"
            onClick={clearSearch}
            className="absolute right-1 top-1/2 -translate-y-1/2 z-10"
          />
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
            <Card
              variant="muted"
              padding={0}
              width={48}
              height={48}
              className="mx-auto mb-2 flex items-center justify-center rounded-full"
            >
              {activeTab === "emojis" ? (
                <Smile size={24} className="text-fg-3" aria-hidden />
              ) : (
                <Sticker size={24} className="text-fg-3" aria-hidden />
              )}
            </Card>
            <Text type="supporting" color="secondary" className="text-[10px]">
              {searchQuery
                ? `No ${activeTab} found for "${searchQuery}"`
                : `No ${activeTab} in this category`}
            </Text>
          </div>
        )}
      </div>

      {/* Add Custom Sticker (for stickers tab only) */}
      {activeTab === "stickers" && (
        <div className="pt-2 border-t border-border">
          <Button
            label={t("Add Custom Sticker")}
            icon={<Plus size={14} aria-hidden />}
            variant="secondary"
            size="sm"
            onClick={() => {
              // This would open a file picker for custom stickers
              // For now, just show a placeholder
            }}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
};

export default StickerPicker;
