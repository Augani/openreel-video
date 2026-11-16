import type { StickerItem, EmojiItem, StickerClip } from "./types";
import { DEFAULT_GRAPHIC_TRANSFORM } from "./types";

interface StickerCategory {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
}

interface EmojiCategory {
  readonly id: string;
  readonly name: string;
  readonly emojis: EmojiItem[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    name: "Smileys & Emotion",
    emojis: [
      {
        id: "grinning",
        emoji: "😀",
        name: "Grinning Face",
        category: "smileys",
      },
      {
        id: "joy",
        emoji: "😂",
        name: "Face with Tears of Joy",
        category: "smileys",
      },
      {
        id: "heart_eyes",
        emoji: "😍",
        name: "Smiling Face with Heart-Eyes",
        category: "smileys",
      },
      {
        id: "thinking",
        emoji: "🤔",
        name: "Thinking Face",
        category: "smileys",
      },
      {
        id: "sunglasses",
        emoji: "😎",
        name: "Smiling Face with Sunglasses",
        category: "smileys",
      },
      { id: "wink", emoji: "😉", name: "Winking Face", category: "smileys" },
      { id: "thumbsup", emoji: "👍", name: "Thumbs Up", category: "smileys" },
      { id: "clap", emoji: "👏", name: "Clapping Hands", category: "smileys" },
      { id: "fire", emoji: "🔥", name: "Fire", category: "smileys" },
      { id: "heart", emoji: "❤️", name: "Red Heart", category: "smileys" },
      { id: "star", emoji: "⭐", name: "Star", category: "smileys" },
      { id: "sparkles", emoji: "✨", name: "Sparkles", category: "smileys" },
    ],
  },
  {
    id: "gestures",
    name: "Gestures",
    emojis: [
      { id: "wave", emoji: "👋", name: "Waving Hand", category: "gestures" },
      { id: "ok_hand", emoji: "👌", name: "OK Hand", category: "gestures" },
      {
        id: "point_up",
        emoji: "☝️",
        name: "Index Pointing Up",
        category: "gestures",
      },
      {
        id: "point_right",
        emoji: "👉",
        name: "Backhand Index Pointing Right",
        category: "gestures",
      },
      {
        id: "raised_hands",
        emoji: "🙌",
        name: "Raising Hands",
        category: "gestures",
      },
      { id: "pray", emoji: "🙏", name: "Folded Hands", category: "gestures" },
      {
        id: "muscle",
        emoji: "💪",
        name: "Flexed Biceps",
        category: "gestures",
      },
      { id: "v", emoji: "✌️", name: "Victory Hand", category: "gestures" },
    ],
  },
  {
    id: "objects",
    name: "Objects",
    emojis: [
      { id: "camera", emoji: "📷", name: "Camera", category: "objects" },
      {
        id: "video_camera",
        emoji: "📹",
        name: "Video Camera",
        category: "objects",
      },
      {
        id: "microphone",
        emoji: "🎤",
        name: "Microphone",
        category: "objects",
      },
      {
        id: "headphones",
        emoji: "🎧",
        name: "Headphones",
        category: "objects",
      },
      {
        id: "movie_camera",
        emoji: "🎥",
        name: "Movie Camera",
        category: "objects",
      },
      {
        id: "clapper",
        emoji: "🎬",
        name: "Clapper Board",
        category: "objects",
      },
      { id: "trophy", emoji: "🏆", name: "Trophy", category: "objects" },
      { id: "medal", emoji: "🏅", name: "Sports Medal", category: "objects" },
      { id: "bell", emoji: "🔔", name: "Bell", category: "objects" },
      { id: "megaphone", emoji: "📣", name: "Megaphone", category: "objects" },
    ],
  },
  {
    id: "symbols",
    name: "Symbols",
    emojis: [
      { id: "check", emoji: "✅", name: "Check Mark", category: "symbols" },
      { id: "x", emoji: "❌", name: "Cross Mark", category: "symbols" },
      {
        id: "question",
        emoji: "❓",
        name: "Question Mark",
        category: "symbols",
      },
      {
        id: "exclamation",
        emoji: "❗",
        name: "Exclamation Mark",
        category: "symbols",
      },
      { id: "100", emoji: "💯", name: "Hundred Points", category: "symbols" },
      {
        id: "arrow_right",
        emoji: "➡️",
        name: "Right Arrow",
        category: "symbols",
      },
      {
        id: "arrow_left",
        emoji: "⬅️",
        name: "Left Arrow",
        category: "symbols",
      },
      { id: "arrow_up", emoji: "⬆️", name: "Up Arrow", category: "symbols" },
      {
        id: "arrow_down",
        emoji: "⬇️",
        name: "Down Arrow",
        category: "symbols",
      },
      { id: "new", emoji: "🆕", name: "New", category: "symbols" },
      { id: "free", emoji: "🆓", name: "Free", category: "symbols" },
    ],
  },
  {
    id: "nature",
    name: "Nature",
    emojis: [
      { id: "sun", emoji: "☀️", name: "Sun", category: "nature" },
      { id: "moon", emoji: "🌙", name: "Crescent Moon", category: "nature" },
      { id: "cloud", emoji: "☁️", name: "Cloud", category: "nature" },
      { id: "rainbow", emoji: "🌈", name: "Rainbow", category: "nature" },
      { id: "snowflake", emoji: "❄️", name: "Snowflake", category: "nature" },
      { id: "lightning", emoji: "⚡", name: "Lightning", category: "nature" },
      { id: "flower", emoji: "🌸", name: "Cherry Blossom", category: "nature" },
      { id: "tree", emoji: "🌳", name: "Deciduous Tree", category: "nature" },
    ],
  },
];

export class StickerLibrary {
  private stickers: Map<string, StickerItem> = new Map();
  private categories: Map<string, StickerCategory> = new Map();
  private emojiCategories: EmojiCategory[] = EMOJI_CATEGORIES;

  constructor() {
    this.initializeDefaultCategories();
  }

  private initializeDefaultCategories(): void {
    const defaultCategories: StickerCategory[] = [
      { id: "arrows", name: "Arrows", icon: "➡️" },
      { id: "badges", name: "Badges", icon: "🏷️" },
      { id: "banners", name: "Banners", icon: "🎗️" },
      { id: "callouts", name: "Callouts", icon: "💬" },
      { id: "social", name: "Social Media", icon: "📱" },
      { id: "custom", name: "Custom", icon: "✨" },
    ];

    for (const category of defaultCategories) {
      this.categories.set(category.id, category);
    }
  }

  addSticker(sticker: StickerItem): void {
    this.stickers.set(sticker.id, sticker);
  }

  removeSticker(stickerId: string): boolean {
    return this.stickers.delete(stickerId);
  }

  getSticker(stickerId: string): StickerItem | undefined {
    return this.stickers.get(stickerId);
  }

  getAllStickers(): StickerItem[] {
    return Array.from(this.stickers.values());
  }

  getStickersByCategory(categoryId: string): StickerItem[] {
    return Array.from(this.stickers.values()).filter(
      (s) => s.category === categoryId,
    );
  }

  searchStickers(query: string): StickerItem[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.stickers.values()).filter(
      (s) =>
        s.name.toLowerCase().includes(lowerQuery) ||
        s.tags?.some((t) => t.toLowerCase().includes(lowerQuery)),
    );
  }

  addCategory(category: StickerCategory): void {
    this.categories.set(category.id, category);
  }

  getCategories(): StickerCategory[] {
    return Array.from(this.categories.values());
  }

  getCategory(categoryId: string): StickerCategory | undefined {
    return this.categories.get(categoryId);
  }

  getEmojiCategories(): EmojiCategory[] {
    return this.emojiCategories;
  }

  getEmojisByCategory(categoryId: string): EmojiItem[] {
    const category = this.emojiCategories.find((c) => c.id === categoryId);
    return category?.emojis || [];
  }

  getAllEmojis(): EmojiItem[] {
    return this.emojiCategories.flatMap((c) => c.emojis);
  }

  searchEmojis(query: string): EmojiItem[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllEmojis().filter((e) =>
      e.name.toLowerCase().includes(lowerQuery),
    );
  }

  getEmoji(emojiId: string): EmojiItem | undefined {
    return this.getAllEmojis().find((e) => e.id === emojiId);
  }

  createStickerClip(
    sticker: StickerItem,
    trackId: string,
    startTime: number,
    duration: number,
  ): StickerClip {
    return {
      id: `sticker_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      trackId,
      startTime,
      duration,
      type: "sticker",
      imageUrl: sticker.imageUrl,
      category: sticker.category,
      name: sticker.name,
      transform: { ...DEFAULT_GRAPHIC_TRANSFORM },
      keyframes: [],
    };
  }

  createEmojiClip(
    emoji: EmojiItem,
    trackId: string,
    startTime: number,
    duration: number,
  ): StickerClip {
    const imageUrl = this.emojiToDataUrl(emoji.emoji);

    return {
      id: `emoji_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      trackId,
      startTime,
      duration,
      type: "emoji",
      imageUrl,
      category: emoji.category,
      name: emoji.name,
      transform: { ...DEFAULT_GRAPHIC_TRANSFORM },
      keyframes: [],
    };
  }

  emojiToDataUrl(emoji: string, size: number = 128): string {
    if (typeof document === "undefined") {
      return `data:text/plain;base64,${btoa(emoji)}`;
    }

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return `data:text/plain;base64,${btoa(emoji)}`;
    }

    ctx.font = `${
      size * 0.8
    }px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, size / 2, size / 2);

    return canvas.toDataURL("image/png");
  }

  async importSticker(
    file: File,
    name: string,
    category: string = "custom",
    tags?: string[],
  ): Promise<StickerItem> {
    const imageUrl = await this.fileToDataUrl(file);

    const sticker: StickerItem = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      name,
      category,
      imageUrl,
      tags,
    };

    this.addSticker(sticker);
    return sticker;
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  clearCustomStickers(): void {
    for (const [id, sticker] of this.stickers) {
      if (sticker.category === "custom") {
        this.stickers.delete(id);
      }
    }
  }
}

export const stickerLibrary = new StickerLibrary();
