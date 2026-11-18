/**
 * Starter prompts for the AI path and the chat panel's empty state.
 *
 * Every chip must be something the chat's tool catalog can really do (services/agent/editing-tools.ts):
 * clips (add, trim, split, move), text overlays, transitions, volume and fades, supplied subtitles.
 * NOT offered, because the chat catalog has no tool for them: captions from speech, silence removal,
 * scene detection, beat sync, reframing, "make a Short". `uses` names the tools each prompt relies
 * on, and a unit test checks they all exist, so the chips cannot drift away from the catalog.
 */
export interface StarterPrompt {
  readonly id: string;
  readonly text: string;
  /** Chat catalog tools this prompt depends on. */
  readonly uses: readonly string[];
}

export const ONBOARDING_STARTER_PROMPTS: readonly StarterPrompt[] = [
  {
    id: "highlight",
    text: "Cut these into a 30-second highlight with a title and smooth transitions",
    uses: ["list_media", "add_clip", "trim_clip", "create_text_clip", "add_transition"],
  },
  {
    id: "vertical-title",
    text: "Make a 9:16 version with a title card",
    uses: ["update_project_settings", "create_text_clip", "add_clip"],
  },
  {
    id: "audio-fades",
    text: "Even out the volume and add fade in and out",
    uses: ["set_clip_volume", "set_clip_fade"],
  },
];

/** Chips in the chat panel's empty state: the onboarding ones plus a read-only "what is here" prompt. */
export const CHAT_STARTER_PROMPTS: readonly StarterPrompt[] = [
  ...ONBOARDING_STARTER_PROMPTS,
  {
    id: "list-timeline",
    text: "List everything currently on my timeline",
    uses: ["list_tracks", "list_clips"],
  },
];

/** Words that promise something the chat catalog cannot do. Used by the unit test. */
export const UNSUPPORTED_PROMISES: readonly RegExp[] = [
  /\bcaption/i,
  /\bsilence/i,
  /\bscene/i,
  /\bbeat\b/i,
  /\breframe/i,
  /\bshort\b/i,
  /\btranscri/i,
  /\bauto[- ]?cut/i,
];
