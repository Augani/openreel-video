import { registerEffectPreviewTests } from "./effect-previews-lib";

// Runs under the gpu project. The fallback-nowebgpu / fallback-software projects run the same flow from
// fallback-effect-previews.spec.ts (they only match fallback-*.spec.ts).
registerEffectPreviewTests();
