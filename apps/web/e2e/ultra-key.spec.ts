import { registerUltraKeyTests } from "./ultra-key-lib";

// Runs under the gpu project. The fallback-nowebgpu / fallback-software projects run the same flow from fallback-ultra-key.spec.ts.
registerUltraKeyTests();
