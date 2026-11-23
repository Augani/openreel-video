import { registerMorphCutTests } from "./morph-cut-lib";

// Without WebGPU the CPU reference analyses the cut and renders every frame of the span.
registerMorphCutTests(true);
