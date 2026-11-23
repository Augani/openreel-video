import { parseOcioFull, OcioParseError, type OcioConfig, type OcioSpaceDef } from "./config";
import { OcioContext } from "./compile";
import { registerAcesOutputBuiltins } from "./builtins-aces";
import { registerFixedFunctions } from "./fixed";
import { generateOcioGlsl, type OcioGlsl } from "./glsl";
import { applyOps, OcioUnsupportedError, type Op } from "./ops";
import { ocioSettingsKey, type OcioProjectSettings } from "./settings";

/**
 * The OCIO runtime facade: inspects a config (what can and cannot be run, per colour space and view), and builds the
 * compiled transforms of a project's OCIO settings for the compositors. Lazy-loaded; the startup bundle never imports it.
 */

registerFixedFunctions();
registerAcesOutputBuiltins();

/** A compiled colour transform, shaped like what the compositors consume (`HdrCompiledTransform` of `color/hdr-working.ts`). */
export interface CompiledOcioTransform {
  readonly key: string;
  /** CPU reference: in-place on `out` (3 channels), colour values of the transform's input space. */
  apply(r: number, g: number, b: number, out: number[]): void;
  /** GLSL snippet (`vec3 ocioTransform(vec3)`) and its LUT texture, built on first use. */
  gpu(): OcioGlsl;
  readonly opCount: number;
}

// -- ops ------------------------------------------------------------------------------------------------------------------

/** Drops identity matrices and merges neighbouring ones. */
export function optimizeOps(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    const prev = out[out.length - 1];
    if (op.k === "mat" && prev && prev.k === "mat") {
      const a = prev.m;
      const b = op.m;
      const m = new Array<number>(9);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = b[r * 3] * a[c] + b[r * 3 + 1] * a[3 + c] + b[r * 3 + 2] * a[6 + c];
      const o: [number, number, number] = [
        b[0] * prev.o[0] + b[1] * prev.o[1] + b[2] * prev.o[2] + op.o[0],
        b[3] * prev.o[0] + b[4] * prev.o[1] + b[5] * prev.o[2] + op.o[1],
        b[6] * prev.o[0] + b[7] * prev.o[1] + b[8] * prev.o[2] + op.o[2],
      ];
      out[out.length - 1] = { k: "mat", m, o };
    } else out.push(op);
  }
  return out.filter((op) => !(op.k === "mat" && op.o.every((v) => v === 0) && op.m.every((v, i) => v === (i % 4 === 0 ? 1 : 0))));
}

export function compileOps(ops: readonly Op[], key: string): CompiledOcioTransform {
  const optimized = optimizeOps(ops);
  let glsl: OcioGlsl | null = null;
  return {
    key,
    opCount: optimized.length,
    apply(r, g, b, out) {
      out[0] = r;
      out[1] = g;
      out[2] = b;
      applyOps(optimized, out);
    },
    gpu() {
      glsl ??= generateOcioGlsl(optimized);
      return glsl;
    },
  };
}

// -- inspection -----------------------------------------------------------------------------------------------------------

export interface OcioSpaceInfo {
  readonly name: string;
  readonly family: string;
  readonly encoding: string;
  readonly isData: boolean;
  readonly referenceSpaceType: "scene" | "display";
  /** Null when the runtime can read pixels in this space (convert them to the reference); otherwise the reason it cannot. */
  readonly problem: string | null;
  /** Null when the space can also be the working space (converted to and from the reference); otherwise the reason. */
  readonly workingProblem: string | null;
}

export interface OcioViewInfo {
  readonly name: string;
  readonly problem: string | null;
}

export interface OcioDisplayInfo {
  readonly name: string;
  readonly views: readonly OcioViewInfo[];
}

export interface OcioLookInfo {
  readonly name: string;
  readonly processSpace: string;
  readonly problem: string | null;
}

export interface OcioInspection {
  readonly name: string;
  readonly version: string;
  readonly spaces: readonly OcioSpaceInfo[];
  readonly displays: readonly OcioDisplayInfo[];
  readonly looks: readonly OcioLookInfo[];
  readonly roles: Readonly<Record<string, string>>;
  /** LUT files the config names that were not provided (so their spaces are unsupported until they are). */
  readonly missingFiles: readonly string[];
  readonly defaults: OcioDefaults;
}

export interface OcioDefaults {
  readonly workingSpace: string;
  readonly defaultInputSpace: string;
  readonly display: string;
  readonly view: string;
}

/** The config's own choices where it has them: the scene_linear role, an sRGB texture space, the first active display and view. */
export function suggestDefaults(config: OcioConfig, ctx: OcioContext, problems?: ReadonlyMap<string, { input: string | null; working: string | null }>): OcioDefaults {
  const inputOk = (s: OcioSpaceDef): boolean => !s.isData && s.referenceSpaceType === "scene" && (problems ? !problems.get(s.name)?.input : ctx.spaceProblem(s) === null);
  const workingOk = (s: OcioSpaceDef): boolean => inputOk(s) && (problems ? !problems.get(s.name)?.working : ctx.workingProblem(s) === null);
  const byRole = (role: string, ok: (s: OcioSpaceDef) => boolean): string | null => {
    const target = config.roles[role];
    const found = target ? config.spaces.find((s) => s.name.toLowerCase() === target.toLowerCase() || s.aliases.some((a) => a.toLowerCase() === target.toLowerCase())) : undefined;
    return found && ok(found) ? found.name : null;
  };
  const scene = config.spaces.filter(inputOk);
  const working = byRole("scene_linear", workingOk) ?? config.spaces.find((s) => workingOk(s) && /scene-linear/i.test(s.encoding))?.name ?? config.spaces.find(workingOk)?.name ?? config.spaces[0].name;
  const input =
    byRole("color_picking", inputOk) ?? byRole("texture_paint", inputOk) ?? byRole("default", inputOk) ?? scene.find((s) => /srgb/i.test(s.name) && /texture|display|encoded/i.test(s.name))?.name ?? scene.find((s) => /srgb|rec\.?709/i.test(s.name))?.name ?? working;
  const displays = config.activeDisplays.length ? config.displays.filter((d) => config.activeDisplays.includes(d.name)) : config.displays;
  const display = (displays[0] ?? config.displays[0])?.name ?? "";
  const dDef = config.displays.find((d) => d.name === display);
  const view =
    dDef?.views.find((v) => v.viewTransform && !/un-tone/i.test(v.name))?.name ?? dDef?.views.find((v) => v.name.toLowerCase() !== "raw")?.name ?? dDef?.views[0]?.name ?? "";
  return { workingSpace: working, defaultInputSpace: input, display, view };
}

export function inspectOcioConfig(configText: string, files: Readonly<Record<string, string>>): OcioInspection {
  const config = parseOcioFull(configText);
  const ctx = new OcioContext(config, files);
  const problems = new Map<string, { input: string | null; working: string | null }>();
  const missing = new Set<string>();
  const spaces: OcioSpaceInfo[] = config.spaces.map((space) => {
    const problem = space.isData ? null : ctx.spaceProblem(space);
    const workingProblem = space.isData ? "data colour space" : ctx.workingProblem(space);
    problems.set(space.name, { input: problem, working: workingProblem });
    const m = problem ? /The LUT file "([^"]+)" was not provided/.exec(problem) : null;
    if (m) missing.add(m[1]);
    return { name: space.name, family: space.family, encoding: space.encoding, isData: space.isData, referenceSpaceType: space.referenceSpaceType, problem, workingProblem };
  });
  const displays: OcioDisplayInfo[] = config.displays.map((d) => ({ name: d.name, views: d.views.map((v) => ({ name: v.name, problem: ctx.viewProblem(d, v) })) }));
  const looks: OcioLookInfo[] = config.looks.map((l) => {
    let problem: string | null = null;
    try {
      ctx.lookOps(config.roles.scene_linear ?? l.processSpace, config.roles.scene_linear ?? l.processSpace, l.name);
    } catch (error) {
      if (!(error instanceof OcioUnsupportedError)) throw error;
      problem = error.message;
    }
    const m = problem ? /The LUT file "([^"]+)" was not provided/.exec(problem) : null;
    if (m) missing.add(m[1]);
    return { name: l.name, processSpace: l.processSpace, problem };
  });
  return {
    name: config.name,
    version: config.version.text,
    spaces,
    displays,
    looks,
    roles: config.roles,
    missingFiles: [...missing],
    defaults: suggestDefaults(config, ctx, problems),
  };
}

// -- building ------------------------------------------------------------------------------------------------------------

export interface OcioPipelineParts {
  readonly key: string;
  readonly settings: OcioProjectSettings;
  /** Colour values of `space` (a colour space of the config) to the working space. */
  input(space: string): CompiledOcioTransform;
  /** Working space to what the chosen looks and display / view show (display-encoded signal). */
  readonly output: CompiledOcioTransform;
  /** 8-bit graphics: the default input space to the working space. */
  readonly overlay: CompiledOcioTransform;
}

export type OcioBuildResult = { readonly ok: true; readonly parts: OcioPipelineParts } | { readonly ok: false; readonly error: string };

export function buildOcioPipeline(settings: OcioProjectSettings): OcioBuildResult {
  let config: OcioConfig;
  try {
    config = parseOcioFull(settings.configText);
  } catch (error) {
    return { ok: false, error: error instanceof OcioParseError ? error.message : "The OCIO config could not be read." };
  }
  const ctx = new OcioContext(config, settings.files);
  const key = ocioSettingsKey(settings);
  try {
    const working = ctx.space(settings.workingSpace);
    if (working.isData || working.referenceSpaceType !== "scene") throw new OcioUnsupportedError(`The working space "${working.name}" must be a scene-referred colour space.`);
    const cache = new Map<string, CompiledOcioTransform>();
    const input = (space: string): CompiledOcioTransform => {
      let hit = cache.get(space);
      if (!hit) {
        hit = compileOps(ctx.colorSpaceOps(space, working.name), `${key}:in:${space}`);
        cache.set(space, hit);
      }
      return hit;
    };
    const lookSpec = (settings.looks ?? []).join(", ");
    const outOps = [...ctx.lookOps(working.name, working.name, lookSpec), ...ctx.displayViewOps(working.name, settings.display, settings.view)];
    const output = compileOps(outOps, `${key}:out`);
    const overlay = input(settings.defaultInputSpace);
    return { ok: true, parts: { key, settings, input, output, overlay } };
  } catch (error) {
    // A malformed config must never throw out of a frame render: report it like any other unsupported input.
    return { ok: false, error: error instanceof OcioUnsupportedError ? error.message : "The OCIO config could not be compiled." };
  }
}

// -- sessions (tests, tools) ----------------------------------------------------------------------------------------------

export interface OcioSession {
  readonly config: OcioConfig;
  /** OCIO ColorSpaceTransform from `src` to `dst`. Throws `OcioUnsupportedError` when a part cannot be run. */
  colorSpace(src: string, dst: string): CompiledOcioTransform;
  /** OCIO LookTransform (`looks` as OCIO writes them: "a, -b"). */
  look(src: string, dst: string, looks: string): CompiledOcioTransform;
  /** OCIO DisplayViewTransform. */
  displayView(src: string, display: string, view: string): CompiledOcioTransform;
}

/** Compiles arbitrary conversions of a config, for the parity tests that hold the GPU shader to OpenColorIO. */
export function createOcioSession(configText: string, files: Readonly<Record<string, string>>): OcioSession {
  const config = parseOcioFull(configText);
  const ctx = new OcioContext(config, files);
  return {
    config,
    colorSpace: (src, dst) => compileOps(ctx.colorSpaceOps(src, dst), `cs:${src}>${dst}`),
    look: (src, dst, looks) => compileOps(ctx.lookOps(src, dst, looks), `look:${src}>${dst}:${looks}`),
    displayView: (src, display, view) => compileOps(ctx.displayViewOps(src, display, view), `dv:${src}>${display}/${view}`),
  };
}

export { OcioUnsupportedError } from "./ops";
