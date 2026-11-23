import { getDefaultTransitionParams, getGLContextCounters } from "@openreel/core";
import { scaleBorderToFrame } from "@openreel/core/video/transition-defaults";
import type {
  ChromaKeyEngine,
  ColorGradingEngine,
  EchoCompositor,
  Effect,
  UltraKeyParams,
  Transition,
  TransitionEngine,
  TransitionType,
  VideoEffectsEngine,
  VideoEngine,
} from "@openreel/core";
import { loadEngineModules } from "../../../../services/lazy-engines";
import { createWarmLut } from "../../../../services/editor-effect-application";
import { onPreviewDeviceLoss } from "../../preview/device-loss";
import { isKindDef } from "./kind-defs";
import { LaneSet, MAX_PREVIEW_LANES, SharedResourcePool, type PoolResource, type PoolStats } from "./shared-gpu-pool";
import { refreshAllPreviewEngines, type EffectRenderer, type PreviewEffectDef, type RenderInput } from "./preview-engine";
import { lookEffectsFor, pickSampleKeyColor, previewParams } from "./preview-params";

/** Largest share of the footage a sampled (non-green) Ultra Key card may remove, so the subject stays visible. */
const SAMPLE_KEY_MAX_COVERAGE = 0.4;

function isPureGreenKey(key: { r: number; g: number; b: number }): boolean {
  return key.r === 0 && key.g === 1 && key.b === 0;
}

interface Lane {
  effects: VideoEffectsEngine;
  grading: ColorGradingEngine | null;
  chroma: ChromaKeyEngine | null;
  transitions: TransitionEngine | null;
  transitionSize: string;
  video: VideoEngine | null;
  /** Echo cards: the compositor of the engine's own echo routine. */
  echo: EchoCompositor | null;
}

/** Stabilization crops the frame edges to leave room to steady it: the card shows that crop. */
const STABILIZE_CROP = 1.08;

function drawScaled(frame: ImageBitmap, scale: number, mirror = false): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.translate(frame.width / 2, frame.height / 2);
  ctx.scale(mirror ? -scale : scale, scale);
  ctx.drawImage(frame, -frame.width / 2, -frame.height / 2);
  return createImageBitmap(canvas);
}

function checkerboard(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): void {
  const cell = Math.max(6, Math.round(width / 24));
  for (let y = 0; y * cell < height; y++) {
    for (let x = 0; x * cell < width; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#9a9a9e" : "#6c6c70";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
}

/**
 * Renders a card's effect with the engines the editor itself uses:
 *  - effects: VideoEffectsEngine.applyEffectsToCanvas, the exact routine behind the
 *    Canvas2D fallback renderer and the export (pro effect GLSL passes, CSS-filter
 *    batches, shader effects, plugin host), with the effect's default parameters
 *    resolved by the same withEffectDefaults the apply action uses;
 *  - LUT: ColorGradingEngine.applyLUT with the very table "apply" writes to the clip;
 *  - transitions: TransitionEngine.renderTransitionToCanvas, the engine the timeline renders cuts with,
 *    blending two moments of the same footage;
 *  - chroma key: ChromaKeyEngine on the footage with a sample key colour (the footage rarely has a green
 *    screen), over a transparency checkerboard; stabilize: the stabilization crop. Both carry a card badge.
 * One lane per concurrent render: each owns its engines, whose reusable canvases
 * must never be shared by two renders in flight.
 */
/** The shared set: lanes (engines) and the shader renderers of the kind cards, both bounded by MAX_PREVIEW_LANES. */
class PreviewGpuResources implements PoolResource {
  readonly lanes = new LaneSet<Lane>(
    async () => {
      const modules = await loadEngineModules();
      return {
        // preferWebGPU false: the effects engine is used for its canvas passes only, like the fallback renderer.
        effects: new modules.VideoEffectsEngine({ width: 384, height: 216, useGPU: true, preferWebGPU: false }),
        grading: null,
        chroma: null,
        transitions: null,
        transitionSize: "",
        video: null,
        echo: null,
      };
    },
    (lane) => {
      lane.effects.dispose();
      lane.grading?.dispose();
      lane.video?.dispose();
      lane.transitions?.dispose();
      lane.echo?.dispose();
    },
    MAX_PREVIEW_LANES,
    () => this.disposeKinds(),
  );
  kinds: Promise<typeof import("./kind-renderers")> | null = null;
  /** Owns the GPU shader renderers (one per lane); created with the lazy chunk, freed by dispose(). */
  readonly kindState: import("./kind-renderers").KindRenderState = { shaders: new Map(), disposed: false };

  private disposeKinds(): void {
    // Frees every GL program / texture of the shader renderers now, and makes a render still in flight refuse to build new ones.
    this.kindState.disposed = true;
    void this.kinds?.then((kinds) => kinds.disposeKindRenderers(this.kindState));
  }

  dispose(): void {
    this.lanes.dispose();
  }

  stats(): { lanes: number; shaderRenderers: number } {
    return { lanes: this.lanes.laneCount, shaderRenderers: this.kindState.shaders.size };
  }
}

/** Every preview engine (Effects, Transitions, Color, Motion ... panels) leases this one set. */
export const sharedPreviewGpu = new SharedResourcePool<PreviewGpuResources>(() => new PreviewGpuResources());

/** Live GPU usage of the preview pipeline: shared-set size, plus every engine-owned WebGL context the page holds. */
export function previewGpuStats(): PoolStats & { lanes: number; shaderRenderers: number; gl: { created: number; released: number; live: number } } {
  const peek = sharedPreviewGpu.peek()?.stats() ?? { lanes: 0, shaderRenderers: 0 };
  return { ...sharedPreviewGpu.stats(), ...peek, gl: getGLContextCounters() };
}

export class EngineEffectRenderer implements EffectRenderer {
  private readonly lease = sharedPreviewGpu.acquire();
  private disposed = false;
  private warned = new Set<string>();

  async render(slot: number, def: PreviewEffectDef, input: RenderInput): Promise<ImageBitmap> {
    if (this.disposed) throw new Error("renderer disposed");
    const resources = this.lease.resources;
    // The shared set serialises renders per lane, so two preview engines can never use one lane's canvases at once.
    return resources.lanes.run(slot, (lane, laneIndex) => this.renderOnLane(resources, lane, laneIndex, def, input));
  }

  private async renderOnLane(
    resources: PreviewGpuResources,
    lane: Lane,
    laneIndex: number,
    def: PreviewEffectDef,
    input: RenderInput,
  ): Promise<ImageBitmap> {
    if (isKindDef(def)) {
      // Motion / text / particle / shader cards: their engines load on demand (the effects and title engines only for the
      // cards that draw text) and a failure is an error, never a stand-in frame.
      resources.kinds ??= import("./kind-renderers");
      const kinds = await resources.kinds;
      if (this.disposed) throw new Error("renderer disposed");
      return kinds.renderKindCard(loadEngineModules, resources.kindState, laneIndex, def, input);
    }
    const modules = await loadEngineModules();
    if (this.disposed) throw new Error("renderer disposed");
    const { frame } = input;
    try {
      if (def.kind === "transition") return await this.renderTransition(lane, modules, def, input);
      if (def.kind === "look") return await this.renderLook(lane, modules, def, frame);

      // Lazy chunk: the overlay compositor is only fetched when an Overlays card first renders.
      if (def.kind === "overlay") return await (await import("./overlay-renderer")).renderOverlayCard(modules, lane.effects, def, input);

      if (def.type === "stabilize") return await drawScaled(frame, STABILIZE_CROP);

      if (def.type === "chromaKey") return await this.renderChromaKey(lane, modules, frame);

      if (def.type === "ultra-key") return await this.renderUltraKey(lane, modules, def, frame);

      if (def.type === "lut") {
        if (!lane.grading) {
          lane.grading = new modules.ColorGradingEngine(frame.width, frame.height);
          try {
            lane.grading.initialize();
          } catch {
            /* no WebGL2: applyLUT falls back to the identical CPU path */
          }
        }
        const lut = modules.lutFromJson(createWarmLut());
        const graded = await lane.grading.applyLUT(frame, lut);
        return graded.image;
      }

      // Echo: the card's current frame and the earlier window frames, combined by the engine's EchoCompositor.
      if (def.type === "echo" && input.temporal?.echo && input.trail && input.trail.length > 0) {
        lane.echo ??= new modules.EchoCompositor();
        return await lane.echo.compose(
          frame,
          input.trail.map((entry) => ({ image: entry.frame, weight: entry.weight })),
          input.temporal.echo,
        );
      }

      const params = previewParams(def, { ...(modules.withEffectDefaults(def.type, def.params) ?? {}) });
      // Time-driven shaders (scanlines, glitch, ...) animate off their own time uniform.
      if (def.type === "shader") params.time = input.sourceTime;
      const sampled: Effect = { id: "effect-preview", type: def.type, enabled: true, params };
      // Burn-in cards draw the effect's own text for a sample clip (the badge says so), moving with the hover loop.
      const [effect] = modules.withBurnInText([sampled], { id: "effect-preview", mediaId: "sample", startTime: input.sourceTime }, 0, modules.BURN_IN_SAMPLE_SOURCE) as Effect[];
      const canvas = await lane.effects.applyEffectsToCanvas(frame, [effect]);
      return await createImageBitmap(canvas ?? frame);
    } catch (error) {
      if (this.disposed) throw error;
      const label = def.id ?? def.type;
      if (!this.warned.has(label)) {
        this.warned.add(label);
        console.warn(`[effect-previews] ${label} could not be rendered, showing the source frame:`, error);
      }
      return createImageBitmap(frame);
    }
  }

  /**
   * Looks render the way a clip renders: its effect chain first (the preset's effects, or the clip's own effects under
   * a LUT / saved look) with the clip-effect engine, then its colour grade with VideoEngine's clip grading routine.
   * That is the order of VideoEngine.applyClipVideoProcessing, which the monitor and export run, so a card shows
   * what applying the look produces on top of whatever the clip already has.
   */
  private async renderLook(
    lane: Lane,
    modules: Awaited<ReturnType<typeof loadEngineModules>>,
    def: PreviewEffectDef,
    frame: ImageBitmap,
  ): Promise<ImageBitmap> {
    // Exactly the params apply writes: no card-scale grain boost (that exists for single-effect cards only).
    const effects = lookEffectsFor(def) as Effect[];
    let current = frame;
    let owned = false;
    if (effects.length > 0) {
      const canvas = await lane.effects.applyEffectsToCanvas(frame, effects);
      current = await createImageBitmap(canvas ?? frame);
      owned = true;
    }
    if (def.grading) {
      lane.video ??= new modules.VideoEngine();
      const graded = await lane.video.gradeBitmap(current, def.grading);
      if (graded !== current) {
        if (owned) current.close();
        return graded;
      }
    }
    return owned ? current : createImageBitmap(frame);
  }

  private async renderTransition(
    lane: Lane,
    modules: Awaited<ReturnType<typeof loadEngineModules>>,
    def: PreviewEffectDef,
    input: RenderInput,
  ): Promise<ImageBitmap> {
    const { frame } = input;
    const size = `${frame.width}x${frame.height}`;
    if (!lane.transitions || lane.transitionSize !== size) {
      lane.transitions = modules.createTransitionEngine(frame.width, frame.height);
      lane.transitionSize = size;
    }
    // A single still has no "next shot": blend towards its mirror image so the transition is visible.
    const incoming = input.partner && input.partner !== frame ? input.partner : await drawScaled(frame, 1, true);
    const transition: Transition = {
      id: "effect-preview",
      clipAId: "preview-a",
      clipBId: "preview-b",
      type: def.type as TransitionType,
      duration: 1,
      // A saved preset's border is in pixels of a 1920-wide frame; the thumbnail is much smaller.
      params: scaleBorderToFrame({ ...getDefaultTransitionParams(def.type as TransitionType), ...(def.params ?? {}) }, frame.width, 1920),
    };
    try {
      const canvas = await lane.transitions.renderTransitionToCanvas(
        frame,
        incoming,
        transition,
        input.progress,
      );
      return await createImageBitmap(canvas);
    } finally {
      if (incoming !== input.partner) incoming.close();
    }
  }

  private async renderChromaKey(
    lane: Lane,
    modules: Awaited<ReturnType<typeof loadEngineModules>>,
    frame: ImageBitmap,
  ): Promise<ImageBitmap> {
    lane.chroma ??= new modules.ChromaKeyEngine({ width: frame.width, height: frame.height });
    const probe = new OffscreenCanvas(48, 27);
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    if (!probeCtx) throw new Error("2D canvas unavailable");
    probeCtx.drawImage(frame, 0, 0, probe.width, probe.height);
    const keyColor = pickSampleKeyColor(probeCtx.getImageData(0, 0, probe.width, probe.height).data);
    const keyed = await lane.chroma.applyChromaKeyWithSettings(frame, {
      enabled: true,
      keyColor,
      tolerance: 0.3,
      edgeSoftness: 0.1,
      spillSuppression: 0.5,
    });
    try {
      const out = new OffscreenCanvas(frame.width, frame.height);
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("2D canvas unavailable");
      checkerboard(ctx, frame.width, frame.height);
      ctx.drawImage(keyed.image, 0, 0, frame.width, frame.height);
      return await createImageBitmap(out);
    } finally {
      keyed.image.close();
    }
  }

  /**
   * Ultra Key: the real effect (GLSL passes of the effects engine, the routine the Canvas2D fallback and export run) with its
   * default parameters on the footage, keyed on a sample colour because footage rarely has a green screen, over a transparency
   * checkerboard. The card carries the "Sample key" badge.
   */
  private async renderUltraKey(
    lane: Lane,
    modules: Awaited<ReturnType<typeof loadEngineModules>>,
    def: PreviewEffectDef,
    frame: ImageBitmap,
  ): Promise<ImageBitmap> {
    const probe = new OffscreenCanvas(48, 27);
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    if (!probeCtx) throw new Error("2D canvas unavailable");
    probeCtx.drawImage(frame, 0, 0, probe.width, probe.height);
    const probeData = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
    const key = pickSampleKeyColor(probeData);
    const params: Record<string, unknown> = {
      ...(modules.withEffectDefaults(def.type, def.params) ?? {}),
      keyR: Math.round(key.r * 255),
      keyG: Math.round(key.g * 255),
      keyB: Math.round(key.b * 255),
    };
    if (!isPureGreenKey(key)) {
      // A sampled (skin / dominant hue / grey) key is low in chroma, so the default tolerance would key out the whole
      // frame. Narrow the matte until the card still shows most of the footage, as an artist would by pulling Tolerance.
      const baseTolerance = Number(params.tolerance);
      const baseTransparency = Number(params.transparency);
      for (const tolerance of [baseTolerance, 40, 30, 22, 15, 10, 6, 3]) {
        if (tolerance > baseTolerance) continue;
        const transparency = Math.min(baseTransparency, tolerance * 0.9);
        const prep = modules.prepareUltraKey({ ...(params as unknown as UltraKeyParams), tolerance, transparency }, probe.height);
        let keyed = 0;
        for (let i = 0; i < probeData.length; i += 4) {
          if (modules.ultraKeyBaseMatte(probeData[i], probeData[i + 1], probeData[i + 2], prep) < 0.5) keyed++;
        }
        params.tolerance = tolerance;
        params.transparency = transparency;
        if (keyed / (probeData.length / 4) <= SAMPLE_KEY_MAX_COVERAGE) break;
      }
    }
    const effect: Effect = { id: "effect-preview", type: def.type, enabled: true, params };
    const keyed = await lane.effects.applyEffectsToCanvas(frame, [effect]);
    const out = new OffscreenCanvas(frame.width, frame.height);
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    checkerboard(ctx, frame.width, frame.height);
    ctx.drawImage(keyed ?? frame, 0, 0, frame.width, frame.height);
    return await createImageBitmap(out);
  }

  /** Gives the lease back; the shared GPU set is disposed once no preview engine holds it (after a short idle grace). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lease.release();
  }
}

/**
 * After a GPU device / context loss: drop the shared engines (their GL contexts may be dead; the next render builds
 * fresh ones) and make every mounted preview engine re-render its cards.
 */
export function recoverEffectPreviewsAfterDeviceLoss(): void {
  sharedPreviewGpu.reset();
  refreshAllPreviewEngines();
}

onPreviewDeviceLoss(recoverEffectPreviewsAfterDeviceLoss);
