import { registerVrVideoTests } from "./vr-video-lib";

// Runs under the gpu project. The fallback-nowebgpu / fallback-software projects run the same flow from fallback-vr-video.spec.ts.
registerVrVideoTests();
