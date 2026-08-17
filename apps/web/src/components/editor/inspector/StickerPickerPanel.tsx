import React, { useState, useCallback, useMemo, useRef } from "react";
import { Check, Smile, Sticker, Search, Plus } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import {
  stickerLibrary,
  EMOJI_CATEGORIES,
  type EmojiItem,
  type StickerItem,
} from "@openreel/core";
import { useTranslation } from "react-i18next";

type TabType = "emojis" | "stickers";

interface EmojiButtonProps {
  emoji: EmojiItem;
  onAdd: () => void;
}

const EmojiButton: React.FC<EmojiButtonProps> = ({ emoji, onAdd }) => (
  <ClickableCard
    label={`Add ${emoji.name}`}
    onClick={onAdd}
    width={40}
    height={40}
    padding={0}
    variant="transparent"
    className="flex items-center justify-center text-2xl"
  >
    {emoji.emoji}
  </ClickableCard>
);

interface StickerCardProps {
  sticker: StickerItem;
  onAdd: () => void;
}

const StickerCard: React.FC<StickerCardProps> = ({ sticker, onAdd }) => {
  const { t: tr } = useTranslation();
  return (
  <ClickableCard
    label={`Add ${sticker.name}`}
    onClick={onAdd}
    padding={2}
    variant="muted"
    className="border border-border flex flex-col items-center gap-1"
  >
    {sticker.imageUrl ? (
      <img
        src={sticker.imageUrl}
        alt={tr(sticker.name)}
        className="w-8 h-8 object-contain"
      />
    ) : (
      <Text type="body" color="primary" className="text-2xl">
        {sticker.name.slice(0, 2)}
      </Text>
    )}
    <Text type="supporting" color="secondary" className="text-[8px] truncate max-w-full">
      {sticker.name}
    </Text>
  </ClickableCard>
);
};

export const StickerPickerPanel: React.FC = () => {
  const { t: tr } = useTranslation();
  const addTrack = useProjectStore((state) => state.addTrack);
  const project = useProjectStore((state) => state.project);
  const createStickerClip = useProjectStore((state) => state.createStickerClip);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const select = useUIStore((state) => state.select);

  const [activeTab, setActiveTab] = useState<TabType>("emojis");
  const [selectedCategory, setSelectedCategory] = useState<string>("smileys");
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

  const allStickers = searchQuery
    ? stickerLibrary.searchStickers(searchQuery)
    : stickerLibrary.getAllStickers();
  const stickerCategories = stickerLibrary.getCategories();

  const ensureGraphicsTrack = useCallback(async () => {
    let graphicsTrack = useProjectStore
      .getState()
      .project.timeline.tracks.find(
        (t) => t.type === "graphics",
      );
    if (graphicsTrack) return graphicsTrack;
    const result = await addTrack("graphics");
    if (!result.success) return null;
    graphicsTrack = useProjectStore
      .getState()
      .project.timeline.tracks.find((track) => track.type === "graphics");
    return graphicsTrack ?? null;
  }, [addTrack]);

  const handleAddEmoji = useCallback(
    async (emoji: EmojiItem) => {
      if (!project) return null;
      const graphicsTrack = await ensureGraphicsTrack();

      if (graphicsTrack) {
        const clip = stickerLibrary.createEmojiClip(
          emoji,
          graphicsTrack.id,
          playheadPosition,
          5,
        );
        const created = createStickerClip(clip);
        if (created) {
          select(
            { type: "shape-clip", id: created.id, trackId: graphicsTrack.id },
            false,
          );
        }
        return created;
      }
      return null;
    },
    [createStickerClip, ensureGraphicsTrack, playheadPosition, project, select],
  );

  const handleAddSticker = useCallback(
    async (sticker: StickerItem) => {
      if (!project) return null;
      const graphicsTrack = await ensureGraphicsTrack();

      if (graphicsTrack) {
        const clip = stickerLibrary.createStickerClip(
          sticker,
          graphicsTrack.id,
          playheadPosition,
          5,
        );
        const created = createStickerClip(clip);
        if (created) {
          select(
            { type: "shape-clip", id: created.id, trackId: graphicsTrack.id },
            false,
          );
        }
        return created;
      }
      return null;
    },
    [createStickerClip, ensureGraphicsTrack, playheadPosition, project, select],
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
      <Card
        variant="green"
        padding={2}
        className="flex items-center gap-2 border border-primary/30"
      >
        <Smile size={16} className="text-primary" aria-hidden />
        <div className="flex flex-col gap-0.5 min-w-0">
          <Text type="body" color="primary" weight="bold" display="block" className="text-[11px]">
            {tr("Stickers & Emojis")}</Text>
          <Text type="supporting" color="secondary" display="block" className="text-[9px]">
            {tr("Add fun elements to your video")}</Text>
        </div>
      </Card>

      <div className="flex gap-1">
        <Button
          label={tr("Emojis")}
          icon={<Smile size={12} aria-hidden />}
          variant={activeTab === "emojis" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setActiveTab("emojis")}
          className="flex-1"
        />
        <Button
          label={tr("Stickers")}
          icon={<Sticker size={12} aria-hidden />}
          variant={activeTab === "stickers" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setActiveTab("stickers")}
          className="flex-1"
        />
      </div>

      <div className="relative">
        <ToolcraftTextInputControl
          label={activeTab === "emojis" ? tr("Search emojis") : tr("Search stickers")}
          isLabelHidden
          size="sm"
          width="100%"
          placeholder={
            activeTab === "emojis" ? tr("Search emojis...") : tr("Search stickers...")
          }
          value={searchQuery}
          onChange={setSearchQuery}
          startIcon={<Search size={14} aria-hidden />}
        />
      </div>

      {activeTab === "emojis" && !searchQuery && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {emojiCategories.map((cat) => (
            <Button
              key={cat.id}
              label={`${cat.emojis[0]?.emoji || "😀"} ${cat.name}`}
              onClick={() => setSelectedCategory(cat.id)}
              variant={selectedCategory === cat.id ? "primary" : "secondary"}
              size="sm"
              className="whitespace-nowrap text-[9px]"
            />
          ))}
        </div>
      )}

      {activeTab === "stickers" &&
        !searchQuery &&
        stickerCategories.length > 0 && (
          <div className="flex gap-1 overflow-x-auto pb-1">
            {stickerCategories.map((cat) => (
              <Button
                key={cat.id}
                label={`${cat.icon ? `${cat.icon} ` : ""}${cat.name}`}
                onClick={() => setSelectedCategory(cat.id)}
                variant={selectedCategory === cat.id ? "primary" : "secondary"}
                size="sm"
                className="whitespace-nowrap text-[9px]"
              />
            ))}
          </div>
        )}

      {activeTab === "emojis" && (
        <div className="grid grid-cols-6 gap-1 max-h-48 overflow-y-auto">
          {currentEmojis.length === 0 ? (
            <div className="col-span-6 text-center py-4">
              <Smile
                size={24}
                className="mx-auto mb-2 text-fg-3 opacity-50"
                aria-hidden
              />
              <Text type="supporting" color="secondary" className="text-[10px]">
                {tr("No emojis found")}</Text>
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
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {allStickers.length === 0 ? (
            <div className="text-center py-4">
              <Sticker
                size={24}
                className="mx-auto mb-2 text-fg-3 opacity-50"
                aria-hidden
              />
              <Text type="supporting" color="secondary" className="text-[10px]">
                {tr("No stickers yet")}</Text>
              <Text type="supporting" color="secondary" className="text-[9px] mt-1">
                {tr("Import custom stickers below")}</Text>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          aria-label={tr("Choose custom sticker image")}
          className="sr-only"
          onChange={(event) =>
            void handleImportSticker(event.currentTarget.files?.[0])
          }
        />
        <Button
          label={isImporting ? tr("Importing sticker…") : tr("Import & Add Sticker")}
          icon={<Plus size={12} aria-hidden />}
          variant="secondary"
          size="sm"
          isDisabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
          className="w-full"
        />
        {importMessage ? (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-accent/20 bg-accent-soft px-2 py-1.5 text-[9px] text-accent">
            <Check size={11} aria-hidden />
            <span>{importMessage}</span>
          </div>
        ) : null}
        {importError ? (
          <Text
            type="supporting"
            display="block"
            className="mt-2 rounded-md border border-danger/20 bg-danger/10 px-2 py-1.5 text-[9px] text-danger"
            role="alert"
          >
            {importError}
          </Text>
        ) : null}
      </div>

      <Text type="supporting" color="secondary" className="block text-[9px] text-center">
        {activeTab === "emojis"
          ? `${stickerLibrary.getAllEmojis().length} emojis available`
          : `${allStickers.length} stickers available`}
      </Text>
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

export default StickerPickerPanel;
