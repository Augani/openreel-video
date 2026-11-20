export * from "./types";
export * from "./clip-volume-automation";
export {
  GAIN_DB_MAX,
  GAIN_DB_MIN,
  MIN_POINT_GAP,
  dbToVolume,
  volumeToDb,
  normalizePoints as normalizeAutomationPoints,
  insertPoint as insertAutomationPoint,
  movePoint as moveAutomationPoint,
  deletePoint as deleteAutomationPoint,
  scaleRange as scaleAutomationRange,
  simplify as simplifyAutomation,
  type MovePointBounds,
} from "./automation-edit";
export * from "./clip-fade-envelope";
export * from "./transition-audio-fades";
export * from "./fft";
export * from "./audio-engine";
export * from "./audio-effects-engine";
export * from "./audio-effect-routing";
export * from "./clip-audio-resolution";
export * from "./live-ducking";
export * from "./stem-isolation";
export * from "./noise-reduction";
export * from "./volume-automation";
export * from "./realtime-audio-graph";
export * from "./sound-library-engine";
export * from "./sound-generator";
export * from "./beat-detection-engine";
export * from "./highlight-analyzer";
export * from "./track-audio-rack";
export * from "./loudness";
export * from "./mixdown-cache";
export * from "./track-audibility";
export * from "./audio-output-device";
export * from "./audio-routing";
export * from "./track-automation";
export * from "./scrub-grain";
export * from "./effect-latency";
export * from "./audio-routing-graph";
export * from "./repair";
export * from "./spectral";
export * from "./essential-sound";
export * from "./surround";
export * from "./channel-map";
export * from "./multichannel-fx";
