/**
 * @openreel/fxpkg — the .fxpkg artifact contract, node library, graph validator,
 * filter/template compilers, and blueprint engine. The shared spine of the
 * studio → marketplace → editor → render-farm pipeline (STUDIO_PLAN Parts II–III).
 */
export * from "./types";
export * from "./abi";
export * from "./nodelib";
export * from "./validator";
export * from "./manifest";
export * from "./blueprints";
export * from "./sha256";
export * from "./package";
export * from "./domain";
export * from "./money";
export { compileFilter } from "./compiler/filter";
export type { FilterCompileResult, FilterPipeline, FilterShader } from "./compiler/filter";
export { compileTemplate, templateFxRefs } from "./compiler/template";
export type {
  Edl,
  TemplateSource,
  TemplateSlot,
  TemplateTrack,
  TemplateItem,
  TemplateFxRef,
  TemplateCompileResult,
  SlotKind,
} from "./compiler/template";
