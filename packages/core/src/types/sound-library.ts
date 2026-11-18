export type SoundCategory = "music" | "sfx" | "ambient" | "vocals" | "foley";

export type MusicGenre =
  | "afrobeats"
  | "afro-house"
  | "afro-pop"
  | "percussion"
  | "electronic"
  | "cinematic"
  | "pop"
  | "rock"
  | "hip-hop"
  | "jazz"
  | "classical"
  | "ambient"
  | "lofi"
  | "corporate"
  | "upbeat"
  | "dramatic";

export type SFXCategory =
  | "transitions"
  | "whoosh"
  | "impacts"
  | "ui"
  | "nature"
  | "human"
  | "mechanical"
  | "musical"
  | "cartoon"
  | "horror"
  | "sci-fi";

export type MoodTag =
  | "happy"
  | "sad"
  | "energetic"
  | "calm"
  | "tense"
  | "romantic"
  | "inspiring"
  | "mysterious"
  | "playful"
  | "dark"
  | "bright"
  | "nostalgic";

export interface SoundItem {
  readonly id: string;
  readonly name: string;
  readonly category: SoundCategory;
  readonly subcategory: MusicGenre | SFXCategory;
  readonly duration: number;
  readonly bpm?: number;
  readonly key?: string;
  readonly tags: string[];
  readonly mood?: MoodTag[];
  readonly previewUrl: string;
  readonly downloadUrl: string;
  readonly waveformData?: number[];
  readonly isBuiltin: boolean;
  readonly license: "royalty-free" | "creative-commons" | "custom";
  readonly attribution?: string;
}

export interface SoundLibraryFilter {
  category?: SoundCategory;
  subcategory?: MusicGenre | SFXCategory;
  mood?: MoodTag[];
  minDuration?: number;
  maxDuration?: number;
  minBpm?: number;
  maxBpm?: number;
  searchQuery?: string;
}

export interface BeatMarker {
  readonly time: number;
  readonly strength: number;
  readonly type: "downbeat" | "beat" | "offbeat";
}

export interface SoundAnalysis {
  readonly bpm: number;
  readonly key: string;
  readonly beats: BeatMarker[];
  readonly waveform: number[];
}

export const MUSIC_GENRES: { id: MusicGenre; name: string }[] = [
  { id: "afrobeats", name: "Afrobeats" },
  { id: "afro-house", name: "Afro-house" },
  { id: "afro-pop", name: "Afro-pop" },
  { id: "percussion", name: "Percussion" },
  { id: "electronic", name: "Electronic" },
  { id: "cinematic", name: "Cinematic" },
  { id: "pop", name: "Pop" },
  { id: "rock", name: "Rock" },
  { id: "hip-hop", name: "Hip-Hop" },
  { id: "jazz", name: "Jazz" },
  { id: "classical", name: "Classical" },
  { id: "ambient", name: "Ambient" },
  { id: "lofi", name: "Lo-Fi" },
  { id: "corporate", name: "Corporate" },
  { id: "upbeat", name: "Upbeat" },
  { id: "dramatic", name: "Dramatic" },
];

export const SFX_CATEGORIES: { id: SFXCategory; name: string }[] = [
  { id: "transitions", name: "Transitions" },
  { id: "whoosh", name: "Whoosh" },
  { id: "impacts", name: "Impacts" },
  { id: "ui", name: "UI Sounds" },
  { id: "nature", name: "Nature" },
  { id: "human", name: "Human" },
  { id: "mechanical", name: "Mechanical" },
  { id: "musical", name: "Musical" },
  { id: "cartoon", name: "Cartoon" },
  { id: "horror", name: "Horror" },
  { id: "sci-fi", name: "Sci-Fi" },
];

export const MOOD_TAGS: { id: MoodTag; name: string; color: string }[] = [
  { id: "happy", name: "Happy", color: "#FFD700" },
  { id: "sad", name: "Sad", color: "#6B8E9F" },
  { id: "energetic", name: "Energetic", color: "#FF4500" },
  { id: "calm", name: "Calm", color: "#87CEEB" },
  { id: "tense", name: "Tense", color: "#8B0000" },
  { id: "romantic", name: "Romantic", color: "#FF69B4" },
  { id: "inspiring", name: "Inspiring", color: "#FFD700" },
  { id: "mysterious", name: "Mysterious", color: "#4B0082" },
  { id: "playful", name: "Playful", color: "#FFA500" },
  { id: "dark", name: "Dark", color: "#1A1A2E" },
  { id: "bright", name: "Bright", color: "#FFFF00" },
  { id: "nostalgic", name: "Nostalgic", color: "#D4A574" },
];
