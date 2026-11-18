import {
  createEffectFromPreset,
  defaultMotionShaderParams,
  drawParticleEffects,
  sampleParticleEffect,
  type ParticleEffect,
  type EmphasisAnimation,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TEXT_TRANSFORM,
  type TextAnimation,
  type TextClip,
  type TextStyle,
} from "@openreel/core";
import { MotionShaderRenderer } from "@openreel/core/motion/motion-shader-renderer";
import type { loadEngineModules } from "../../../../services/lazy-engines";
import { boundedMotionPresetDuration, createMotionPresetKeyframes } from "../../../../services/motion-preset-application";
import { useProjectStore } from "../../../../stores/project-store";
import {
  applyEmphasisAnimation,
  drawFrameWithTransform,
  getAnimatedTransform,
} from "../../preview/canvas-renderers";
import { DEFAULT_TRANSFORM } from "../../preview/types";
import {
  DEFAULT_TEXT_SHADER_PROGRESS,
  LOOP_HOLD_SECONDS,
  type EmphasisPreviewPayload,
  type MotionPreviewPayload,
  type ParticlePreviewPayload,
  type PreviewTextSource,
  type ShaderPreviewPayload,
  type TextPreviewPayload,
} from "./kind-defs";
import type { PreviewEffectDef, RenderInput } from "./preview-engine";

/**
 * The engines behind the inspector cards, loaded on demand (this module is a dynamic import of effect-renderer.ts,
 * so none of it is in the editor chunk). Every card is drawn by the code the program monitor and the export use:
 *  - motion presets: the preset's real keyframes (createMotionPresetKeyframes, the function "apply" uses),
 *    interpolated by the monitor's getAnimatedTransform and drawn by its drawFrameWithTransform;
 *  - text animation / emphasis on text: TitleEngine.renderText with the animation built by the text animation engine;
 *  - emphasis on footage: the monitor's applyEmphasisAnimation;
 *  - particles: sampleParticleEffect through drawParticleEffects, the routine behind drawProjectParticles;
 *  - shaders: MotionShaderRenderer in strict mode, so a GPU failure is an error, never a decorative stand-in.
 * Everything is drawn over the footage frame of the card (the poster frame of the shared window).
 */
type EngineModules = Awaited<ReturnType<typeof loadEngineModules>>;

type CanvasSource = ImageBitmap | OffscreenCanvas | HTMLCanvasElement;

const STAGE_COLOR = "#0d0f14";
const FALLBACK_PROJECT_SIZE = { width: 1920, height: 1080 };

/** What one EngineEffectRenderer owns: its GPU shader renderers (one per queue slot). Never shared between engines. */
export interface KindRenderState {
  readonly shaders: Map<number, MotionShaderRenderer>;
  disposed: boolean;
}

export const createKindRenderState = (): KindRenderState => ({ shaders: new Map(), disposed: false });

/** Frees the GL programs, textures and context listeners of every shader renderer, and refuses further work. */
export function disposeKindRenderers(state: KindRenderState): void {
  state.disposed = true;
  for (const renderer of state.shaders.values()) renderer.dispose();
  state.shaders.clear();
}

function newStage(width: number, height: number): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return { canvas, ctx };
}

/** The frame as the card background, optionally dimmed so overlays (text, particles) read on bright footage. */
function paintBackdrop(ctx: OffscreenCanvasRenderingContext2D, frame: ImageBitmap, dim: number): void {
  ctx.drawImage(frame, 0, 0, frame.width, frame.height);
  if (dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${dim})`;
    ctx.fillRect(0, 0, frame.width, frame.height);
  }
}

const projectSize = (): { width: number; height: number } => {
  const settings = useProjectStore.getState().project?.settings;
  return settings && settings.width > 0 && settings.height > 0
    ? { width: settings.width, height: settings.height }
    : FALLBACK_PROJECT_SIZE;
};

function renderMotion(payload: MotionPreviewPayload, input: RenderInput): Promise<ImageBitmap> {
  const { frame, progress } = input;
  const { preset, seconds, target } = payload;
  const { canvas, ctx } = newStage(frame.width, frame.height);
  ctx.fillStyle = STAGE_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // The selected clip, keyframed by the function "apply" uses, against the project canvas: the slide offsets are the
  // ones the clip will get. The result is then scaled from project pixels to the card.
  const keyframes = createMotionPresetKeyframes(
    preset,
    { id: "preview", trackId: "preview", duration: target.clipDuration, transform: target.transform, keyframes: [] },
    target.kind,
    seconds,
    target.canvas,
  );
  const length = boundedMotionPresetDuration(seconds, preset.duration, target.clipDuration);
  const offset =
    preset.category === "exit"
      ? target.clipDuration - length
      : preset.category === "emphasis"
        ? (target.clipDuration - length) / 2
        : 0;
  const localTime = offset + Math.min(progress * (seconds + LOOP_HOLD_SECONDS), seconds);
  const animated = getAnimatedTransform(target.transform, keyframes, localTime);
  // "regular" clips keep pixel positions in project space; text, shape, svg and sticker clips keep them as canvas fractions.
  const pixels = target.kind === "regular";
  const transform = {
    ...animated,
    position: {
      x: pixels ? (animated.position.x * canvas.width) / target.canvas.width : animated.position.x * canvas.width,
      y: pixels ? (animated.position.y * canvas.height) / target.canvas.height : animated.position.y * canvas.height,
    },
  };
  drawFrameWithTransform(ctx as unknown as CanvasRenderingContext2D, frame, transform, canvas.width, canvas.height);
  return createImageBitmap(canvas);
}

/** Style scaled from project pixels to the card, so the text keeps the size relationship it has in the frame. */
function scaledStyle(style: TextStyle, scale: number, width: number, text: string): TextStyle {
  const lines = text.split("\n");
  const longest = Math.max(1, ...lines.map((line) => line.length));
  // Keep the string readable and inside the card: a long title shrinks instead of running off.
  const fit = (width * 0.88) / (longest * 0.6);
  const fontSize = Math.max(6, Math.min(style.fontSize * scale, fit, width * 0.22));
  const ratio = fontSize / style.fontSize;
  return {
    ...style,
    fontSize,
    letterSpacing: style.letterSpacing * ratio,
    strokeWidth: style.strokeWidth === undefined ? undefined : style.strokeWidth * ratio,
    shadowBlur: style.shadowBlur === undefined ? undefined : style.shadowBlur * ratio,
    shadowOffsetX: style.shadowOffsetX === undefined ? undefined : style.shadowOffsetX * ratio,
    shadowOffsetY: style.shadowOffsetY === undefined ? undefined : style.shadowOffsetY * ratio,
  };
}

const cardText = (text: string): string => {
  const trimmed = text.trim() || "Your Title";
  const lines = trimmed.split("\n").slice(0, 2);
  return lines.map((line) => (line.length > 28 ? `${line.slice(0, 27)}…` : line)).join("\n");
};

function textClipFor(
  source: PreviewTextSource,
  width: number,
  duration: number,
  extras: Partial<TextClip>,
): TextClip {
  const text = cardText(source.text);
  const scale = width / projectSize().width;
  const base = source.style ?? DEFAULT_TEXT_STYLE;
  return {
    id: "preview",
    trackId: "preview",
    startTime: 0,
    duration,
    text,
    style: scaledStyle(base, scale, width, text),
    transform: { ...(source.transform ?? DEFAULT_TEXT_TRANSFORM) },
    keyframes: [],
    ...extras,
  };
}

function drawText(
  modules: EngineModules,
  frame: ImageBitmap,
  clip: TextClip,
  time: number,
): Promise<ImageBitmap> {
  const { canvas, ctx } = newStage(frame.width, frame.height);
  paintBackdrop(ctx, frame, 0.32);
  const rendered = modules.titleEngine.renderText(clip, frame.width, frame.height, time);
  ctx.drawImage(rendered.canvas as CanvasSource, 0, 0, frame.width, frame.height);
  return createImageBitmap(canvas);
}

function renderText(modules: EngineModules, payload: TextPreviewPayload, input: RenderInput): Promise<ImageBitmap> {
  const { frame, progress } = input;
  const { source, preset, side, inDuration, outDuration, params } = payload;
  const created: TextAnimation = modules.textAnimationEngine.createAnimationPreset(
    preset,
    inDuration,
    outDuration,
    params,
  );
  const hold = 0.5;
  if (side === "entry") {
    const duration = inDuration + hold;
    const animation: TextAnimation = { ...created, outDuration: 0 };
    return drawText(modules, frame, textClipFor(source, frame.width, duration, { animation }), progress * duration);
  }
  // Exit: the clip rests, then leaves through the exit phase, exactly the shape updateTextAnimationPhase stores.
  const duration = hold + outDuration;
  const animation: TextAnimation = {
    preset: "none",
    params: {},
    inDuration: 0,
    outDuration,
    out: { preset: created.preset, params: created.params, stagger: created.stagger, unit: created.unit },
  };
  return drawText(modules, frame, textClipFor(source, frame.width, duration, { animation }), progress * duration);
}

/** How far inside the cell the frame sits in an emphasis filmstrip, so scale-ups show as growth instead of being clipped. */
const FILMSTRIP_INSET = 0.78;
/** Cells of the at-rest emphasis poster (a 2 x 2 filmstrip of real engine frames). */
export const EMPHASIS_STRIP_CELLS = 4;
const EMPHASIS_SCAN_STEPS = 48;

type EmphasisState = ReturnType<typeof applyEmphasisAnimation>;

/** Seconds one cycle of the animation lasts (the clock `applyEmphasisAnimation` runs on). */
const emphasisCycleSeconds = (animation: EmphasisAnimation): number => 1 / Math.max(animation.speed, 0.05);

/** How different two emphasis states look, for choosing the frames of the filmstrip. */
function emphasisDistance(a: EmphasisState, b: EmphasisState): number {
  return (
    Math.abs(a.opacity - b.opacity) * 2 +
    Math.abs(a.scale * a.scaleX - b.scale * b.scaleX) * 3 +
    Math.abs(a.scale * a.scaleY - b.scale * b.scaleY) * 3 +
    (Math.abs(a.offsetX - b.offsetX) + Math.abs(a.offsetY - b.offsetY)) * 12 +
    Math.abs(a.rotation - b.rotation) / 20
  );
}

/**
 * The instants (seconds on the animation's clock) of the filmstrip: the first frame of the cycle, then the frames the
 * animation looks most unlike the ones already chosen (its extremes), in time order. A pulse reads as rest, bigger, smaller;
 * a flash as bright and dim; a heartbeat as its two beats. Pure: it samples the monitor's own `applyEmphasisAnimation`.
 */
export function pickEmphasisFilmstripTimes(animation: EmphasisAnimation, cells = EMPHASIS_STRIP_CELLS): number[] {
  const start = animation.startTime ?? 0;
  const cycle = emphasisCycleSeconds(animation);
  const candidates = Array.from({ length: EMPHASIS_SCAN_STEPS }, (_, i) => start + (i / EMPHASIS_SCAN_STEPS) * cycle);
  const states = candidates.map((time) => applyEmphasisAnimation(animation, time));
  const chosen = [0];
  while (chosen.length < Math.min(cells, candidates.length)) {
    let best = -1;
    let bestDistance = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (chosen.includes(i)) continue;
      const nearest = Math.min(...chosen.map((c) => emphasisDistance(states[i], states[c])));
      if (nearest > bestDistance + 1e-9) {
        bestDistance = nearest;
        best = i;
      }
    }
    chosen.push(best);
  }
  return chosen.sort((a, b) => a - b).map((i) => candidates[i]);
}

/** One emphasis frame on footage: the monitor's own transform maths, the frame drawn `inset` times its size. */
function renderEmphasisFootageFrame(
  animation: EmphasisAnimation,
  time: number,
  frame: ImageBitmap,
  inset: number,
): OffscreenCanvas {
  const { canvas, ctx } = newStage(frame.width, frame.height);
  ctx.fillStyle = STAGE_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const emphasis = applyEmphasisAnimation(animation, time);
  const base = DEFAULT_TRANSFORM;
  const transform = {
    ...base,
    opacity: base.opacity * emphasis.opacity,
    scale: {
      x: base.scale.x * inset * emphasis.scale * emphasis.scaleX,
      y: base.scale.y * inset * emphasis.scale * emphasis.scaleY,
    },
    position: {
      x: base.position.x + emphasis.offsetX * canvas.width,
      y: base.position.y + emphasis.offsetY * canvas.height,
    },
    rotation: base.rotation + emphasis.rotation,
  };
  drawFrameWithTransform(ctx as unknown as CanvasRenderingContext2D, frame, transform, canvas.width, canvas.height);
  return canvas;
}

/** The at-rest emphasis poster: a 2 x 2 filmstrip of real engine frames, so each animation reads as itself without hover. */
async function renderEmphasisFilmstrip(
  modules: EngineModules | null,
  payload: EmphasisPreviewPayload,
  frame: ImageBitmap,
): Promise<ImageBitmap> {
  const { animation, source } = payload;
  const { canvas, ctx } = newStage(frame.width, frame.height);
  ctx.fillStyle = STAGE_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const columns = 2;
  const cellW = canvas.width / columns;
  const cellH = canvas.height / columns;
  const gutter = Math.max(1, Math.round(canvas.width / 160));
  const times = pickEmphasisFilmstripTimes(animation);
  for (let i = 0; i < times.length; i++) {
    let cell: ImageBitmap | OffscreenCanvas;
    if (source && modules) {
      cell = await drawText(modules, frame, textClipFor(source, frame.width, 8, { emphasisAnimation: animation }), times[i]);
    } else {
      cell = renderEmphasisFootageFrame(animation, times[i], frame, FILMSTRIP_INSET);
    }
    const x = (i % columns) * cellW;
    const y = Math.floor(i / columns) * cellH;
    ctx.drawImage(cell as CanvasSource, x + gutter / 2, y + gutter / 2, cellW - gutter, cellH - gutter);
    if ("close" in cell) cell.close();
  }
  return createImageBitmap(canvas);
}

function renderEmphasis(
  modules: EngineModules | null,
  payload: EmphasisPreviewPayload,
  input: RenderInput,
): Promise<ImageBitmap> {
  const { frame, sourceTime } = input;
  const { animation, source } = payload;
  if (input.poster) return renderEmphasisFilmstrip(modules, payload, frame);
  if (source && modules) {
    const clip = textClipFor(source, frame.width, 8, { emphasisAnimation: animation });
    return drawText(modules, frame, clip, sourceTime);
  }
  return createImageBitmap(renderEmphasisFootageFrame(animation, sourceTime, frame, 1));
}

/**
 * Card-scale compensation (like grain's boost): the emitters simulate in the project's own space, exactly as "apply" runs
 * them, and the particle sizes are scaled up so that a 2-4 px dust mote is still a visible dot on a ~190 px card.
 * Positions, speeds, counts, emission shapes and lifetimes are the preset's own.
 */
const PARTICLE_MIN_DOT = 7;
const PARTICLE_MAX_BOOST = 16;
const PARTICLE_MIN_PEAK_OPACITY = 0.85;
const PARTICLE_MAX_OPACITY_BOOST = 2.5;
const PARTICLE_POSTER_STEP = 0.1;
/**
 * A sparse ambient preset (a few dozen motes over a full-HD frame) shrinks to a handful of specks on a ~200 px card. The card
 * emits it denser, by the factor that brings its steady-state particle count up to a readable number (never beyond
 * PARTICLE_MAX_DENSITY); where the particles are, how fast they move and how long they live stay the preset's.
 */
const PARTICLE_TARGET_LIVE = 240;
const PARTICLE_MAX_DENSITY = 5;
/** The most a preview effect is warmed up: ambient presets (dust, snow) live for seconds before they reach steady state. */
const PARTICLE_MAX_WARMUP = 8;

interface ParticleSpace {
  readonly width: number;
  readonly height: number;
}

/**
 * The preset's effect as the card simulates it, started early enough (one particle lifetime) that the loop begins in its steady
 * state, the state it is in for most of a clip, instead of on an empty frame.
 * `canvasWidth` is the card canvas: it sets how much the dots are enlarged.
 */
export function particleCardEffect(
  presetId: string,
  loopSeconds: number,
  space: ParticleSpace,
  canvasWidth: number,
): ParticleEffect {
  const base = createEffectFromPreset(presetId, "preview", "preview", 0, loopSeconds);
  if (!base) throw new Error(`Unknown particle preset ${presetId}`);
  // Every loop starts in steady state (particles already in flight): a hover loop that begins on an empty frame, or a burst that
  // grows from nothing, would flash empty on every restart. An ambient preset (particles outlive the loop) is also made denser.
  const warmup = Math.min(base.config.lifetime.max, PARTICLE_MAX_WARMUP);
  const ambient = base.config.lifetime.max > loopSeconds;
  const meanSize = Math.max((base.config.size.min + base.config.size.max) / 2, 0.1);
  const onCard = meanSize * (canvasWidth / space.width);
  const boost = Math.min(Math.max(PARTICLE_MIN_DOT / onCard, 1), PARTICLE_MAX_BOOST);
  // A faint preset (ambient dust is 40% opaque at birth) is lifted so its dots register on a card-sized frame.
  const peak = Math.max(base.config.opacity.start, base.config.opacity.end, 0.05);
  const opacityBoost = Math.min(Math.max(PARTICLE_MIN_PEAK_OPACITY / peak, 1), PARTICLE_MAX_OPACITY_BOOST);
  // Steady-state live particles of an ambient preset: emission rate x mean lifetime, capped by the preset's own count.
  const live = Math.min(base.config.particleCount, base.config.emissionRate * ((base.config.lifetime.min + base.config.lifetime.max) / 2));
  const density = ambient ? Math.min(Math.max(PARTICLE_TARGET_LIVE / Math.max(live, 1), 1), PARTICLE_MAX_DENSITY) : 1;
  return {
    ...base,
    startTime: 0 - warmup,
    duration: warmup + loopSeconds,
    config: {
      ...base.config,
      particleCount: Math.round(base.config.particleCount * density),
      emissionRate: base.config.emissionRate * density,
      size: { min: base.config.size.min * boost, max: base.config.size.max * boost },
      opacity: { start: Math.min(base.config.opacity.start * opacityBoost, 1), end: Math.min(base.config.opacity.end * opacityBoost, 1) },
    },
  };
}

/** How much of the card the particles at `time` cover: sum of opacity * area of the ones inside the frame. */
function particleCoverage(effect: ParticleEffect, time: number, space: ParticleSpace): number {
  let total = 0;
  for (const p of sampleParticleEffect(effect, time, space.width, space.height)) {
    const x = p.position.x;
    const y = space.height - p.position.y;
    if (x < 0 || y < 0 || x > space.width || y > space.height) continue;
    total += Math.max(p.opacity, 0) * p.size * p.size;
  }
  return total;
}

/** The instant of the loop where the effect is most visibly at work (the most particle coverage), so the poster shows it. */
export function particlePosterInstant(effect: ParticleEffect, loopSeconds: number, space: ParticleSpace): number {
  let best = 0;
  let bestCoverage = -1;
  for (let time = 0; time < loopSeconds - 0.001; time += PARTICLE_POSTER_STEP) {
    const coverage = particleCoverage(effect, time, space);
    if (coverage > bestCoverage + 1e-9) {
      bestCoverage = coverage;
      best = time;
    }
  }
  return best;
}

/** Mean relative luminance (0..1) of a preset's particle colours: dark dust needs an undimmed backdrop to read. */
function paletteLuminance(colors: readonly string[]): number {
  let total = 0;
  for (const color of colors) {
    const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
    if (!hex) {
      total += 0.5;
      continue;
    }
    const n = parseInt(hex, 16);
    total += (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  }
  return colors.length ? total / colors.length : 0.5;
}

const posterInstants = new Map<string, number>();

function renderParticles(payload: ParticlePreviewPayload, input: RenderInput, seconds: number): Promise<ImageBitmap> {
  const { frame, sourceTime } = input;
  const space = projectSize();
  const effect = particleCardEffect(payload.preset.id, seconds, space, frame.width);
  const { canvas, ctx } = newStage(frame.width, frame.height);
  // The footage is dimmed so the particles read on it: a little for bright palettes, more for grey / dark ones (dust, debris).
  paintBackdrop(ctx, frame, paletteLuminance(effect.config.colors) < 0.55 ? 0.55 : 0.3);
  // The poster is the loop's most telling instant; the last sampled instant of a hover loop is the end, where an effect has
  // already finished: stay just inside it.
  let time = Math.min(sourceTime, seconds - 0.001);
  if (input.poster) {
    const key = `${payload.preset.id}@${seconds}@${space.width}x${space.height}@${frame.width}`;
    let instant = posterInstants.get(key);
    if (instant === undefined) {
      instant = particlePosterInstant(effect, seconds, space);
      posterInstants.set(key, instant);
    }
    time = instant;
  }
  drawParticleEffects(ctx as unknown as CanvasRenderingContext2D, [effect], time, canvas.width, canvas.height, space.width, space.height);
  return createImageBitmap(canvas);
}

/** Effect shaders have no stored progress; text materials use the value selecting one stores. */
const SHADER_CARD_PROGRESS = DEFAULT_TEXT_SHADER_PROGRESS;

function shaderRendererFor(state: KindRenderState, slot: number): MotionShaderRenderer {
  // A render that was in flight when the engine was disposed must not re-create (and leak) a GPU renderer.
  if (state.disposed) throw new Error("renderer disposed");
  let renderer = state.shaders.get(slot);
  if (!renderer) {
    renderer = new MotionShaderRenderer();
    state.shaders.set(slot, renderer);
  }
  return renderer;
}

function renderShader(
  state: KindRenderState,
  slot: number,
  payload: ShaderPreviewPayload,
  input: RenderInput,
): Promise<ImageBitmap> {
  const { frame, sourceTime } = input;
  const { def } = payload;
  const width = frame.width;
  const height = frame.height;
  const renderer = shaderRendererFor(state, slot);
  const { canvas, ctx } = newStage(width, height);

  // The shader works on the footage frame. It uploads a canvas (an ImageBitmap would not follow the renderer's flip
  // convention and arrive upside down).
  const mask = newStage(width, height);
  mask.ctx.drawImage(frame, 0, 0, width, height);

  const result = renderer.render(def, {
    width,
    height,
    time: sourceTime,
    progress: SHADER_CARD_PROGRESS,
    params: defaultMotionShaderParams(def),
    inputCanvas: mask.canvas,
    strict: true,
  });
  if (!result) throw new Error(`Shader ${def.id} could not be rendered`);
  ctx.drawImage(result as CanvasSource, 0, 0, width, height);
  return createImageBitmap(canvas);
}

/**
 * Text materials: the selected clip's own string, style and transform go through TitleEngine.renderText with the shader
 * stored on style.shader, which is the path an applied (and exported) text material takes.
 */
function renderTextMaterial(
  modules: EngineModules,
  payload: ShaderPreviewPayload,
  input: RenderInput,
): Promise<ImageBitmap> {
  const { frame, sourceTime } = input;
  const { def, text, source } = payload;
  const base: PreviewTextSource = source ?? { text, style: DEFAULT_TEXT_STYLE };
  const shaded: PreviewTextSource = {
    ...base,
    style: {
      ...base.style,
      shader: { shaderId: def.id, params: defaultMotionShaderParams(def), progress: SHADER_CARD_PROGRESS },
    },
  };
  return drawText(modules, frame, textClipFor(shaded, frame.width, 4, {}), sourceTime);
}

/** Renders one inspector card (kind "motion" | "text" | "emphasis" | "particles" | "shader"). Throws when it cannot. */
export async function renderKindCard(
  loadModules: () => Promise<EngineModules>,
  state: KindRenderState,
  slot: number,
  def: PreviewEffectDef,
  input: RenderInput,
): Promise<ImageBitmap> {
  if (state.disposed) throw new Error("renderer disposed");
  switch (def.kind) {
    case "motion":
      return renderMotion(def.payload as MotionPreviewPayload, input);
    case "text":
      return renderText(await loadModules(), def.payload as TextPreviewPayload, input);
    case "emphasis": {
      const payload = def.payload as EmphasisPreviewPayload;
      // Only emphasis on a text clip needs the title engine; footage emphasis is the monitor's own transform maths.
      return renderEmphasis(payload.source ? await loadModules() : null, payload, input);
    }
    case "particles":
      return renderParticles(def.payload as ParticlePreviewPayload, input, def.loop?.seconds ?? 2);
    case "shader": {
      const payload = def.payload as ShaderPreviewPayload;
      if (payload.sample === "text") return renderTextMaterial(await loadModules(), payload, input);
      return renderShader(state, slot, payload, input);
    }
    default:
      throw new Error(`No renderer for preview kind ${String(def.kind)}`);
  }
}
