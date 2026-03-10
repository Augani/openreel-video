/**
 * Centralized API endpoint configuration.
 *
 * All external service URLs should be defined here so they can be
 * swapped for different environments or self-hosted instances.
 */

const isDev = import.meta.env.DEV;

/** OpenReel cloud services */
export const OPENREEL_CLOUD_URL = isDev
  ? "http://localhost:8787"
  : "https://openreel-cloud.niiyeboah1996.workers.dev";

/** OpenReel transcription / TTS service */
export const OPENREEL_TTS_URL = "https://transcribe.openreel.video";

/** Third-party API base URLs */
export const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
export const OPENAI_API_URL = "https://api.openai.com/v1";
export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1";
