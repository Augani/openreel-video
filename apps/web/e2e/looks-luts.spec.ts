import { registerLooksLutsTests } from "./looks-luts-lib";

// Runs under the gpu project. The fallback-nowebgpu / fallback-software projects run the same flow from
// fallback-looks-luts.spec.ts (they only match fallback-*.spec.ts).
registerLooksLutsTests();
