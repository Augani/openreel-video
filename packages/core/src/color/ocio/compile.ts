import type { OcioConfig, OcioDisplayDef, OcioLookDef, OcioSpaceDef, OcioViewDef, OcioViewTransformDef, TransformNode } from "./config";
import { builtinOps } from "./builtins";
import { LutParseError, parseLutFile, type LutFile } from "./luts";
import { registerFixedFunctions } from "./fixed";
import { fixedStyleOf, hasFixed, invertOps, OcioUnsupportedError, type NegStyle, type Op, type V3 } from "./ops";

registerFixedFunctions();
import type { YamlValue } from "./yaml";

/**
 * Turns config transforms into op lists and resolves colour spaces, roles, displays / views and looks into
 * "source space -> destination" op chains (OCIO's ColorSpaceTransform, LookTransform and DisplayViewTransform).
 * Everything the runtime cannot evaluate raises `OcioUnsupportedError` with the reason; nothing is skipped.
 */

export type OcioFiles = Readonly<Record<string, string>>;

export const USE_DISPLAY_NAME = "<USE_DISPLAY_NAME>";

type Obj = { readonly [key: string]: YamlValue };

function obj(n: TransformNode): Obj {
  return n as unknown as Obj;
}

function num(v: YamlValue | undefined, fallback: number, what: string): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || Number.isNaN(v)) throw new OcioUnsupportedError(`${what} must be a number.`);
  return v;
}

function rgb(v: YamlValue | undefined, fallback: number, what: string): V3 {
  if (v === undefined || v === null) return [fallback, fallback, fallback];
  if (typeof v === "number") return [v, v, v];
  if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === "number")) return [v[0] as number, v[1] as number, v[2] as number];
  throw new OcioUnsupportedError(`${what} must be a number or a list of three numbers.`);
}

function optNum(v: YamlValue | undefined): number | null {
  return typeof v === "number" ? v : null;
}

function normPath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function lookNames(spec: string): { name: string; inverse: boolean }[] {
  return spec
    .split(/[,:]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("-") ? { name: s.slice(1).trim(), inverse: true } : { name: s.replace(/^\+/, "").trim(), inverse: false }));
}

export class OcioContext {
  private readonly spaceIndex = new Map<string, OcioSpaceDef>();
  private readonly lutCache = new Map<string, LutFile>();
  private readonly spaceStack: string[] = [];
  private readonly filesNormalised = new Map<string, string>();

  constructor(
    readonly config: OcioConfig,
    private readonly files: OcioFiles,
  ) {
    for (const space of config.spaces) {
      this.spaceIndex.set(space.name.toLowerCase(), space);
    }
    for (const space of config.spaces) for (const alias of space.aliases) if (!this.spaceIndex.has(alias.toLowerCase())) this.spaceIndex.set(alias.toLowerCase(), space);
    for (const [path] of Object.entries(files)) this.filesNormalised.set(normPath(path).toLowerCase(), path);
  }

  /** A colour space by name, alias or role (case-insensitive, as OCIO does). */
  space(name: string): OcioSpaceDef {
    const direct = this.spaceIndex.get(name.trim().toLowerCase());
    if (direct) return direct;
    const roleTarget = this.config.roles[name.trim()];
    if (roleTarget) {
      const viaRole = this.spaceIndex.get(roleTarget.toLowerCase());
      if (viaRole) return viaRole;
    }
    throw new OcioUnsupportedError(`The config has no colour space (or role) named "${name}".`);
  }

  // -- files ---------------------------------------------------------------------------------------------------------------

  private expand(text: string): string {
    return text.replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a?: string, b?: string) => this.config.environment[(a ?? b) as string] ?? m);
  }

  /** Finds the LUT file a FileTransform names among the files the user provided. */
  lutFile(src: string): { path: string; text: string } {
    const wanted = normPath(this.expand(src));
    const candidates: string[] = [];
    for (const sp of [...this.config.searchPath.map((p) => this.expand(p)), ""]) candidates.push(normPath(`${sp}/${wanted}`), wanted);
    for (const c of candidates) {
      const hit = this.filesNormalised.get(c.toLowerCase());
      if (hit !== undefined) return { path: hit, text: this.files[hit] };
    }
    // A folder picked one level up or down: fall back to the file name when it is unambiguous.
    const base = wanted.split("/").pop()!.toLowerCase();
    const matches = [...this.filesNormalised.entries()].filter(([k]) => k === base || k.endsWith(`/${base}`));
    if (matches.length === 1) return { path: matches[0][1], text: this.files[matches[0][1]] };
    if (matches.length > 1) throw new OcioUnsupportedError(`The LUT file "${src}" matches ${matches.length} provided files; add the folder structure the config's search_path expects.`);
    throw new OcioUnsupportedError(`The LUT file "${src}" was not provided with the config.`);
  }

  private lutParsed(src: string): LutFile {
    const { path, text } = this.lutFile(src);
    let cached = this.lutCache.get(path);
    if (!cached) {
      try {
        cached = parseLutFile(path, text);
      } catch (error) {
        if (error instanceof LutParseError) throw new OcioUnsupportedError(`${src}: ${error.message}`);
        throw error;
      }
      this.lutCache.set(path, cached);
    }
    return cached;
  }

  // -- transforms ------------------------------------------------------------------------------------------------------------

  private depth = 0;

  /** Ops of a transform node, direction applied. */
  transformOps(node: TransformNode): Op[] {
    // A look or colour space that (indirectly) contains itself would otherwise recurse until the stack runs out.
    if (this.depth > 48) throw new OcioUnsupportedError("The config nests transforms too deeply (a look or colour space may refer to itself).");
    this.depth++;
    try {
      return this.transformOpsAt(node);
    } finally {
      this.depth--;
    }
  }

  private transformOpsAt(node: TransformNode): Op[] {
    const o = obj(node);
    const direction = o.direction === undefined || o.direction === null ? "forward" : String(o.direction).toLowerCase();
    if (direction !== "forward" && direction !== "inverse") throw new OcioUnsupportedError(`Unknown transform direction "${String(o.direction)}".`);
    const forward = this.forwardOps(node);
    return direction === "inverse" ? invertOps(forward) : forward;
  }

  private forwardOps(node: TransformNode): Op[] {
    const o = obj(node);
    switch (node.$tag) {
      case "GroupTransform": {
        const children = Array.isArray(o.children) ? o.children : [];
        const out: Op[] = [];
        for (const child of children) {
          if (child && typeof child === "object" && !Array.isArray(child) && typeof (child as Obj).$tag === "string") out.push(...this.transformOps(child as unknown as TransformNode));
          else throw new OcioUnsupportedError("A GroupTransform child is not a transform.");
        }
        return out;
      }
      case "MatrixTransform": {
        const m = Array.isArray(o.matrix) ? o.matrix : null;
        const off = Array.isArray(o.offset) ? o.offset : null;
        if (m && (m.length !== 16 || !m.every((x) => typeof x === "number"))) throw new OcioUnsupportedError("A MatrixTransform matrix needs 16 numbers.");
        if (off && (off.length !== 4 || !off.every((x) => typeof x === "number"))) throw new OcioUnsupportedError("A MatrixTransform offset needs 4 numbers.");
        const mm = (m as number[] | null) ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        if (mm[3] !== 0 || mm[7] !== 0 || mm[11] !== 0 || mm[12] !== 0 || mm[13] !== 0 || mm[14] !== 0) {
          throw new OcioUnsupportedError("A MatrixTransform mixes the alpha channel into colour, which is not evaluated.");
        }
        const oo = (off as number[] | null) ?? [0, 0, 0, 0];
        return [{ k: "mat", m: [mm[0], mm[1], mm[2], mm[4], mm[5], mm[6], mm[8], mm[9], mm[10]], o: [oo[0], oo[1], oo[2]] }];
      }
      case "ExponentTransform": {
        const style = String(o.style ?? "clamp").toLowerCase();
        const mapped: Record<string, NegStyle> = { clamp: "clamp", mirror: "mirror", pass_thru: "pass", passthru: "pass" };
        if (!mapped[style]) throw new OcioUnsupportedError(`ExponentTransform style "${style}" is not supported.`);
        const g = rgb(o.value, 1, "ExponentTransform value");
        return [{ k: "exp", g, style: mapped[style], inv: false }];
      }
      case "ExponentWithLinearTransform": {
        const style = String(o.style ?? "linear").toLowerCase();
        if (style !== "linear" && style !== "mirror") throw new OcioUnsupportedError(`ExponentWithLinearTransform style "${style}" is not supported.`);
        const g = rgb(o.gamma, 1, "ExponentWithLinearTransform gamma");
        const off = rgb(o.offset, 0, "ExponentWithLinearTransform offset");
        return [{ k: "explin", g, off, style, inv: false }];
      }
      case "LogTransform":
        return [{ k: "log", base: num(o.base, 2, "LogTransform base"), ls: [1, 1, 1], lo: [0, 0, 0], ns: [1, 1, 1], no: [0, 0, 0], brk: null, lslope: null, inv: false }];
      case "LogAffineTransform":
      case "LogCameraTransform": {
        const camera = node.$tag === "LogCameraTransform";
        const base = num(o.base, 2, "Log base");
        if (!(base > 0) || base === 1) throw new OcioUnsupportedError("A log transform needs a positive base other than 1.");
        const brk = camera && o.lin_side_break !== undefined && o.lin_side_break !== null ? rgb(o.lin_side_break, 0, "lin_side_break") : null;
        const lslope = camera && brk && o.linear_slope !== undefined && o.linear_slope !== null ? rgb(o.linear_slope, 1, "linear_slope") : null;
        return [
          {
            k: "log",
            base,
            ls: rgb(o.log_side_slope, 1, "log_side_slope"),
            lo: rgb(o.log_side_offset, 0, "log_side_offset"),
            ns: rgb(o.lin_side_slope, 1, "lin_side_slope"),
            no: rgb(o.lin_side_offset, 0, "lin_side_offset"),
            brk,
            lslope,
            inv: false,
          },
        ];
      }
      case "CDLTransform": {
        if (typeof o.src === "string") throw new OcioUnsupportedError(`CDLTransform from the file "${o.src}" (.cc / .ccc) is not supported; write the values into the config.`);
        const style = String(o.style ?? "noclamp").toLowerCase();
        if (style !== "asc" && style !== "noclamp") throw new OcioUnsupportedError(`CDLTransform style "${style}" is not supported.`);
        return [
          {
            k: "cdl",
            slope: rgb(o.slope, 1, "CDL slope"),
            offset: rgb(o.offset, 0, "CDL offset"),
            power: rgb(o.power, 1, "CDL power"),
            sat: num(o.sat, 1, "CDL sat"),
            noclamp: style === "noclamp",
            inv: false,
          },
        ];
      }
      case "RangeTransform": {
        const style = String(o.style ?? "clamp").toLowerCase();
        const op: Op = {
          k: "range",
          minIn: optNum(o.min_in_value),
          maxIn: optNum(o.max_in_value),
          minOut: optNum(o.min_out_value),
          maxOut: optNum(o.max_out_value),
          noclamp: style === "noclamp",
          inv: false,
        };
        if ((op.minIn === null) !== (op.minOut === null) || (op.maxIn === null) !== (op.maxOut === null)) {
          throw new OcioUnsupportedError("A RangeTransform needs matching min_in / min_out and max_in / max_out values.");
        }
        return [op];
      }
      case "FixedFunctionTransform": {
        const style = fixedStyleOf(String(o.style ?? ""));
        if (!style) throw new OcioUnsupportedError(`FixedFunctionTransform style "${String(o.style)}" is not supported.`);
        if (!hasFixed(style)) throw new OcioUnsupportedError(`The fixed function ${style} is not implemented.`);
        const params = Array.isArray(o.params) ? o.params.filter((x): x is number => typeof x === "number") : [];
        return [{ k: "fixed", style, params, inv: false }];
      }
      case "BuiltinTransform":
        return builtinOps(String(o.style ?? ""));
      case "FileTransform":
        return this.fileOps(o);
      case "ColorSpaceTransform":
        return this.colorSpaceOps(String(o.src ?? ""), String(o.dst ?? ""));
      case "LookTransform":
        return this.lookOps(String(o.src ?? ""), String(o.dst ?? ""), String(o.looks ?? ""));
      case "DisplayViewTransform":
        return this.displayViewOps(String(o.src ?? ""), String(o.display ?? ""), String(o.view ?? ""));
      default:
        throw new OcioUnsupportedError(`${node.$tag} is not supported.`);
    }
  }

  private fileOps(o: Obj): Op[] {
    const src = String(o.src ?? "");
    if (!src) throw new OcioUnsupportedError("A FileTransform has no src.");
    if (typeof o.cccid === "string" && o.cccid) throw new OcioUnsupportedError(`FileTransform "${src}" selects a CDL by cccid, which is not supported.`);
    const interp = String(o.interpolation ?? "default").toLowerCase();
    if (!["default", "linear", "nearest", "tetrahedral", "best", "cubic"].includes(interp)) throw new OcioUnsupportedError(`FileTransform interpolation "${interp}" is not supported.`);
    if (interp === "nearest" || interp === "cubic") throw new OcioUnsupportedError(`FileTransform interpolation "${interp}" is not evaluated (linear and tetrahedral are).`);
    const file = this.lutParsed(src);
    const ops: Op[] = [];
    for (const part of file.parts) {
      if (part.kind === "prelut") {
        // OpenColorIO resamples a curved pre-LUT into a 65536 entry table with its own interpolation, which is not
        // reproduced; a pre-LUT whose points lie on a straight line (the usual 0..1 range map) is a scale and offset.
        const scale: number[] = [];
        const offset: number[] = [];
        for (let ch = 0; ch < 3; ch++) {
          const xs = part.inputs[ch];
          const ys = part.outputs[ch];
          const n = xs.length;
          const a = (ys[n - 1] - ys[0]) / (xs[n - 1] - xs[0]);
          const b = ys[0] - a * xs[0];
          for (let i = 0; i < n; i++) {
            if (Math.abs(a * xs[i] + b - ys[i]) > 1e-6) throw new OcioUnsupportedError(`${src}: the .csp pre-LUT is a curve, which OpenColorIO resamples in a way this runtime does not reproduce; only straight (range) pre-LUTs are evaluated.`);
          }
          scale.push(a);
          offset.push(b);
        }
        if (scale.some((v) => v !== 1) || offset.some((v) => v !== 0)) ops.push({ k: "mat", m: [scale[0], 0, 0, 0, scale[1], 0, 0, 0, scale[2]], o: [offset[0], offset[1], offset[2]] });
        continue;
      }
      const span = [0, 1, 2].map((i) => part.domainMax[i] - part.domainMin[i]);
      if (span.some((s) => !(s > 0))) throw new OcioUnsupportedError(`${src}: the LUT's input domain is empty.`);
      const needsDomain = [0, 1, 2].some((i) => part.domainMin[i] !== 0 || part.domainMax[i] !== 1);
      if (needsDomain) ops.push({ k: "mat", m: [1 / span[0], 0, 0, 0, 1 / span[1], 0, 0, 0, 1 / span[2]], o: [-part.domainMin[0] / span[0], -part.domainMin[1] / span[1], -part.domainMin[2] / span[2]] });
      if (part.kind === "lut1d") ops.push({ k: "lut1d", lut: part, inv: false });
      else ops.push({ k: "lut3d", lut: part, tetra: interp === "tetrahedral" || interp === "best" });
    }
    return ops;
  }

  // -- colour spaces -----------------------------------------------------------------------------------------------------------

  private toRef(space: OcioSpaceDef): Op[] {
    const display = space.referenceSpaceType === "display";
    const to = display ? (space.toDisplay ?? space.toScene) : space.toScene;
    const from = display ? (space.fromDisplay ?? space.fromScene) : space.fromScene;
    if (to) return this.guard(space, () => this.transformOps(to));
    if (from) return this.guard(space, () => invertOps(this.transformOps(from)));
    return [];
  }

  private fromRef(space: OcioSpaceDef): Op[] {
    const display = space.referenceSpaceType === "display";
    const to = display ? (space.toDisplay ?? space.toScene) : space.toScene;
    const from = display ? (space.fromDisplay ?? space.fromScene) : space.fromScene;
    if (from) return this.guard(space, () => this.transformOps(from));
    if (to) return this.guard(space, () => invertOps(this.transformOps(to)));
    return [];
  }

  private guard(space: OcioSpaceDef, fn: () => Op[]): Op[] {
    if (this.spaceStack.includes(space.name)) throw new OcioUnsupportedError(`The colour space "${space.name}" refers to itself.`);
    this.spaceStack.push(space.name);
    try {
      return fn();
    } finally {
      this.spaceStack.pop();
    }
  }

  private defaultViewTransform(): OcioViewTransformDef {
    const name = this.config.defaultViewTransform;
    const vt = name ? this.config.viewTransforms.find((v) => v.name.toLowerCase() === name.toLowerCase()) : undefined;
    if (!vt) throw new OcioUnsupportedError("Converting between scene-referred and display-referred colour spaces needs a default_view_transform, which the config does not define.");
    return vt;
  }

  private viewTransformFromScene(vt: OcioViewTransformDef): Op[] {
    if (vt.referenceSpaceType !== "scene") throw new OcioUnsupportedError(`The display-referred view transform "${vt.name}" is not supported.`);
    if (vt.fromScene) return this.transformOps(vt.fromScene);
    if (vt.toScene) return invertOps(this.transformOps(vt.toScene));
    return [];
  }

  /** ColorSpaceTransform: source space to destination space. A data space on either side is a no-op, as in OCIO. */
  colorSpaceOps(srcName: string, dstName: string): Op[] {
    const src = this.space(srcName);
    const dst = this.space(dstName);
    if (src === dst) return [];
    if (src.isData || dst.isData) return [];
    const ops = [...this.toRef(src)];
    if (src.referenceSpaceType !== dst.referenceSpaceType) {
      const vt = this.defaultViewTransform();
      if (src.referenceSpaceType === "scene") ops.push(...this.viewTransformFromScene(vt));
      else ops.push(...invertOps(this.viewTransformFromScene(vt)));
    }
    ops.push(...this.fromRef(dst));
    return ops;
  }

  // -- looks ------------------------------------------------------------------------------------------------------------------

  look(name: string): OcioLookDef {
    const found = this.config.looks.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (!found) throw new OcioUnsupportedError(`The config has no look named "${name}".`);
    return found;
  }

  /** One look in its process space, between `from` and `to` (colour space names). */
  private applyLook(look: OcioLookDef, inverse: boolean, from: string, to: string): Op[] {
    if (!look.processSpace) throw new OcioUnsupportedError(`The look "${look.name}" has no process_space.`);
    let lookOps: Op[];
    if (!inverse) {
      if (look.transform) lookOps = this.transformOps(look.transform);
      else if (look.inverseTransform) lookOps = invertOps(this.transformOps(look.inverseTransform));
      else lookOps = [];
    } else if (look.inverseTransform) lookOps = this.transformOps(look.inverseTransform);
    else if (look.transform) lookOps = invertOps(this.transformOps(look.transform));
    else lookOps = [];
    return [...this.colorSpaceOps(from, look.processSpace), ...lookOps, ...this.colorSpaceOps(look.processSpace, to)];
  }

  /** LookTransform: `looks` is OCIO's list ("a, -b"), applied in order, each in its own process space. */
  lookOps(src: string, dst: string, looks: string): Op[] {
    const list = lookNames(looks);
    if (list.length === 0) return this.colorSpaceOps(src, dst);
    const out: Op[] = [];
    let current = src;
    list.forEach((entry, i) => {
      const look = this.look(entry.name);
      const target = i === list.length - 1 ? dst : look.processSpace;
      out.push(...this.applyLook(look, entry.inverse, current, target));
      current = target;
    });
    return out;
  }

  // -- displays and views --------------------------------------------------------------------------------------------------------

  display(name: string): OcioDisplayDef {
    const d = this.config.displays.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!d) throw new OcioUnsupportedError(`The config has no display named "${name}".`);
    return d;
  }

  view(display: OcioDisplayDef, name: string): OcioViewDef {
    const v = display.views.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!v) throw new OcioUnsupportedError(`The display "${display.name}" has no view named "${name}".`);
    return v;
  }

  /** DisplayViewTransform: a scene (or display) referred source to what the view shows on the display. */
  displayViewOps(srcName: string, displayName: string, viewName: string): Op[] {
    const display = this.display(displayName);
    const view = this.view(display, viewName);
    const src = this.space(srcName);
    const targetName = view.colorSpace === USE_DISPLAY_NAME || view.colorSpace === null ? display.name : view.colorSpace;
    const ops: Op[] = [];
    let currentName = src.name;
    if (view.looks) {
      // View looks run in their process spaces on the way to the reference, as OCIO builds them.
      const list = lookNames(view.looks);
      for (const entry of list) {
        const look = this.look(entry.name);
        ops.push(...this.applyLook(look, entry.inverse, currentName, look.processSpace));
        currentName = look.processSpace;
      }
    }
    if (view.viewTransform) {
      const vt = this.config.viewTransforms.find((v) => v.name.toLowerCase() === view.viewTransform!.toLowerCase());
      if (!vt) throw new OcioUnsupportedError(`The view "${view.name}" uses the view transform "${view.viewTransform}", which the config does not define.`);
      const cur = this.space(currentName);
      if (cur.referenceSpaceType === "scene") {
        ops.push(...this.toRef(cur), ...this.viewTransformFromScene(vt));
      } else ops.push(...this.toRef(cur));
      const dst = this.space(targetName);
      if (dst.referenceSpaceType !== "display") throw new OcioUnsupportedError(`The view "${view.name}" has a view transform but its colour space "${dst.name}" is not display-referred.`);
      ops.push(...this.fromRef(dst));
      return ops;
    }
    ops.push(...this.colorSpaceOps(currentName, targetName));
    return ops;
  }

  /** Why a colour space cannot be used as a source (colour values to the reference), or null when it can. */
  spaceProblem(space: OcioSpaceDef): string | null {
    try {
      this.toRef(space);
      return null;
    } catch (error) {
      if (error instanceof OcioUnsupportedError) return error.message;
      throw error;
    }
  }

  /** Why a colour space cannot be the working space (it is converted both to and from the reference), or null when it can. */
  workingProblem(space: OcioSpaceDef): string | null {
    try {
      this.toRef(space);
      this.fromRef(space);
      return null;
    } catch (error) {
      if (error instanceof OcioUnsupportedError) return error.message;
      throw error;
    }
  }

  viewProblem(display: OcioDisplayDef, view: OcioViewDef): string | null {
    try {
      const scene = this.config.roles.scene_linear ?? this.config.roles.reference ?? this.config.spaces[0].name;
      this.displayViewOps(scene, display.name, view.name);
      return null;
    } catch (error) {
      if (error instanceof OcioUnsupportedError) return error.message;
      throw error;
    }
  }
}
