import type { ElevenLabsModel, Voice } from "./tts-types";

export const TTS_PROVIDERS = [
  { id: "piper" as const, label: "Piper (Free)", description: "Built-in open-source TTS" },
  { id: "elevenlabs" as const, label: "ElevenLabs", description: "Premium AI voices" },
];

export const FALLBACK_MODELS: ElevenLabsModel[] = [
  { model_id: "eleven_v3", name: "Eleven v3", description: "Latest ElevenLabs model", can_do_text_to_speech: true, languages: [] },
];

export const PIPER_VOICES: Voice[] = [
  { id: "amy", name: "Amy", gender: "female", language: "en-US" },
  { id: "ryan", name: "Ryan", gender: "male", language: "en-US" },
];

export const ENHANCE_SYSTEM_PROMPT = `You are a professional voice director transforming text into expressive, emotionally rich scripts for ElevenLabs v3 TTS. Your goal is to turn narration into performance.

Analyze the input for speaker intent, emotional arc, subtext, physical state, relationship dynamics, pacing needs, and environmental context.

Use the 4-Layer System: Delivery (HOW), Tone (emotional color), Texture (voice quality), Subtext (what's beneath). Layer 1-3 tags per emotional beat.

Available tags include: [authoritatively], [hesitantly], [breathlessly], [whispered], [softly], [sighs], [chuckles], [laughs], [sobs], [gasps], [pause:200ms], and many more.

Rules: Do not alter original text. Do not over-tag. Do not use conflicting tags. Output ONLY enhanced text with tags, no explanations.`;
