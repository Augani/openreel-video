/**
 * Engines that no first-paint path touches: subtitles, speech-to-text, the template engine, the sound library and
 * multicam. They are created on demand (see engine-store's `getOrCreateEngine` getters) and live here, not in
 * `./engine-modules`, so that the chunks holding them (and the multicam analysis stack behind MultiCamEngine) stay out of
 * the cold-start path to editor-interactive. Load through `loadOptionalEngineModules` in `./lazy-engines`.
 */
export {
  SubtitleEngine,
  SpeechToTextEngine,
  TemplateEngine,
  SoundLibraryEngine,
  MultiCamEngine,
  multicamEngine,
} from "@openreel/core";
