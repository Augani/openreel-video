import { registerBurnInTests } from "./burn-in-lib";

// Runs under the gpu project. The fallback-nowebgpu / fallback-software projects run the same flow from
// fallback-burn-in.spec.ts (they only match fallback-*.spec.ts).
registerBurnInTests();
