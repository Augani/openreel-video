import { registerTimeEffectTests } from "./time-effects-lib";

// Runs under the gpu project. The fallback-nowebgpu / fallback-software projects run the same flows from
// fallback-time-effects.spec.ts (they only match fallback-*.spec.ts).
registerTimeEffectTests();
