import { registerOpticalFlowTests } from "./optical-flow-lib";

// Without WebGPU the CPU reference renders every interpolated frame, in the preview and in the export.
registerOpticalFlowTests(true);
