import { GraphicsEngine, TitleEngine } from "@openreel/core";
import type { Effect, Keyframe, ShapeClip, VideoEffectsEngine } from "@openreel/core";
import type { loadEngineModules } from "../../../../services/lazy-engines";
import type { PreviewEffectDef, RenderInput } from "./preview-engine";
import { overlayCardAspect } from "./overlay-card-geometry";

export { overlayCardAspect };

type EngineModules = Awaited<ReturnType<typeof loadEngineModules>>;

/** Length of the preview clip the overlay is resolved against: its own timeline, scrubbed by hover. */
export const OVERLAY_PREVIEW_SECONDS = 4;
/** Fraction of that timeline an overlay card holds at rest. */
export const OVERLAY_REST_PROGRESS = 0.6;
const DEFAULT_SEQUENCE = { width: 1920, height: 1080 };

let scratch: { graphics: GraphicsEngine; titles: TitleEngine } | null = null;

/**
 * Scratch engines for the cards: the very classes the project uses to create and render overlay clips, but
 * private instances, so a card never registers a clip in the project's engines.
 */
function scratchEngines(): { graphics: GraphicsEngine; titles: TitleEngine } {
  if (!scratch) {
    const titles = new TitleEngine();
    titles.initialize();
    scratch = { graphics: new GraphicsEngine(), titles };
  }
  return scratch;
}

let scratchLock: Promise<unknown> = Promise.resolve();

/**
 * Runs `job` with exclusive use of the scratch engines. The preview queue runs several tasks at once and a render
 * awaits mid-way, while clearing the engines disposes their shared shader renderer and clip maps; serialising the
 * section means two cards (or the poster lane and a hover) can never clear each other's overlays.
 */
export function withScratchEngines<T>(
  job: (engines: { graphics: GraphicsEngine; titles: TitleEngine }) => Promise<T>,
): Promise<T> {
  const run = scratchLock.then(async () => {
    const engines = scratchEngines();
    engines.graphics.clearCache();
    engines.titles.clear();
    try {
      return await job(engines);
    } finally {
      engines.graphics.clearCache();
      engines.titles.clear();
    }
  });
  scratchLock = run.catch(() => undefined);
  return run;
}

const toKeyframes = (
  prefix: string,
  keyframes: readonly { time: number; property: string; value: unknown; easing?: Keyframe["easing"] }[],
): Keyframe[] =>
  keyframes.map((keyframe, index) => ({
    id: `${prefix}-keyframe-${index + 1}`,
    time: keyframe.time,
    property: keyframe.property,
    value: keyframe.value,
    easing: keyframe.easing,
  })) as Keyframe[];

/** Sequence size the card lays the overlay out in: the project's, so a 12px bar is the bar the project gets. */
export function overlaySequenceSize(def: PreviewEffectDef): { width: number; height: number } {
  const width = Number(def.params?.sequenceWidth);
  const height = Number(def.params?.sequenceHeight);
  return width > 0 && height > 0 ? { width, height } : DEFAULT_SEQUENCE;
}

/**
 * The sequence frame fitted (contain) inside the card of `cardW` pixels wide. 16:9 and wider projects get the
 * 16:9 card; narrower ones a card of their own aspect (down to 5:8), so a vertical frame nearly fills its card.
 */
export function fitSequenceInCard(
  cardW: number,
  sequence: { width: number; height: number },
): { cardH: number; fitW: number; fitH: number } {
  const cardAspect = overlayCardAspect(sequence);
  const cardH = Math.max(1, Math.round(cardW / cardAspect));
  const aspect = sequence.width / sequence.height;
  if (aspect >= cardAspect) return { cardH, fitW: cardW, fitH: Math.max(1, Math.round(cardW / aspect)) };
  return { cardH, fitW: Math.max(1, Math.round(cardH * aspect)), fitH: cardH };
}

/** Cover-crops `frame` into a `width` x `height` canvas. */
function drawCover(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: ImageBitmap | OffscreenCanvas,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / frame.width, height / frame.height);
  const w = frame.width * scale;
  const h = frame.height * scale;
  ctx.drawImage(frame, (width - w) / 2, (height - h) / 2, w, h);
}

/**
 * Draws `frame` the way the Program monitor places a clip that does not match the sequence: contained (never
 * cropped) and centred on the black frame. A 16:9 clip in a 9:16 sequence is a letterboxed picture, so the overlay
 * the card shows sits on the picture that apply would put it on.
 */
export function drawContain(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: ImageBitmap | OffscreenCanvas,
  width: number,
  height: number,
): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / frame.width, height / frame.height);
  const w = frame.width * scale;
  const h = frame.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, (width - w) / 2, (height - h) / 2, w, h);
}

/**
 * One Overlays card: the footage frame with the built-in editing template applied the way "apply" applies it.
 * The template is resolved with the same resolver; its clip effects go through VideoEffectsEngine (the engine
 * that renders them on the clip); its text and shape overlays are created and rendered by the title and
 * graphics engines at the template time `input.progress` (0..1 of the preview clip), then composited over the
 * frame. The whole sequence frame is fitted inside the fixed 16:9 card (never cropped) and the overlays are laid
 * out at that size with the export compositor's own scaling, never at sequence resolution.
 */
export async function renderOverlayCard(
  modules: EngineModules,
  effects: VideoEffectsEngine,
  def: PreviewEffectDef,
  input: RenderInput,
): Promise<ImageBitmap> {
  const templateId = String(def.params?.templateId ?? def.id ?? "");
  const template = modules.getBuiltInEditingTemplate(templateId);
  if (!template) throw new Error(`Unknown overlay template ${templateId}`);
  const sequence = overlaySequenceSize(def);
  // Rest pose at the poster (past the intro, mid-animation); hover sweeps the overlay's timeline across the window.
  const time = (input.progress < 0 ? OVERLAY_REST_PROGRESS : input.progress) * OVERLAY_PREVIEW_SECONDS;

  const resolved = modules.resolveEditingTemplate(template, {
    clip: { id: "overlay-preview-clip", startTime: 0, duration: OVERLAY_PREVIEW_SECONDS, name: "Preview" },
    assetUrls: {},
  });

  const { frame } = input;
  const cardW = frame.width;
  const { cardH, fitW, fitH } = fitSequenceInCard(cardW, sequence);
  const comp = new OffscreenCanvas(fitW, fitH);
  const ctx = comp.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");

  // The clip's own effects (grain, vignette, grade...) first, as on the clip.
  let base: ImageBitmap | OffscreenCanvas = frame;
  const clipEffects: Effect[] = resolved.effects
    .filter((effect) => effect.enabled)
    .map((effect, index) => ({
      id: `overlay-preview-effect-${index}`,
      type: effect.type,
      enabled: true,
      params: { ...(modules.withEffectDefaults(effect.type as never, effect.params) ?? effect.params) },
    })) as Effect[];
  if (clipEffects.length > 0) {
    const graded = await effects.applyEffectsToCanvas(frame, clipEffects);
    if (graded) base = graded as unknown as ImageBitmap | OffscreenCanvas;
  }
  drawContain(ctx, base, fitW, fitH);

  // Overlays are laid out at the card's own size: shape extents scale with the canvas height and text with
  // contentScale, the scaling the export compositor applies, so a 4K project never allocates 4K canvases here.
  const contentScale = { x: fitW / sequence.width, y: fitH / sequence.height };
  await withScratchEngines(async ({ graphics, titles }) => {
    for (const [index, overlay] of resolved.overlays.entries()) {
      const id = `overlay-preview-${template.id}-${index}`;
      if (overlay.type === "text") {
        const clip = titles.createTextClip({
          id,
          trackId: "overlay-preview",
          startTime: 0,
          duration: OVERLAY_PREVIEW_SECONDS,
          text: overlay.content.text,
          style: overlay.content.style,
          transform: overlay.transform,
          animation: overlay.content.animation
            ? {
                preset: overlay.content.animation.preset,
                params: overlay.content.animation.params || {},
                inDuration: overlay.content.animation.inDuration,
                outDuration: overlay.content.animation.outDuration,
                stagger: overlay.content.animation.stagger,
                unit: overlay.content.animation.unit,
              }
            : undefined,
        });
        const updated =
          titles.updateTextClip(clip.id, {
            keyframes: toKeyframes(id, overlay.keyframes),
            blendMode: overlay.blendMode,
            blendOpacity: overlay.blendOpacity,
            emphasisAnimation: overlay.emphasisAnimation,
          }) ?? clip;
        const rendered = titles.renderText(updated, fitW, fitH, time, contentScale);
        ctx.drawImage(rendered.canvas, 0, 0);
      } else if (overlay.type === "shape") {
        graphics.createShape(
          {
            id,
            shapeType: overlay.content.shapeType,
            width: overlay.content.width,
            height: overlay.content.height,
            extent: { width: overlay.content.width, height: overlay.content.height },
            style: overlay.content.style,
            points: overlay.content.points as ShapeClip["points"],
            pathData: overlay.content.pathData,
            closed: overlay.content.closed,
          },
          "overlay-preview",
          0,
          OVERLAY_PREVIEW_SECONDS,
        );
        const clip = graphics.updateShapeClip(id, {
          transform: overlay.transform,
          keyframes: toKeyframes(id, overlay.keyframes),
          blendMode: overlay.blendMode,
          blendOpacity: overlay.blendOpacity,
          emphasisAnimation: overlay.emphasisAnimation,
        });
        if (!clip) continue;
        const rendered = await graphics.renderGraphic(clip, time, fitW, fitH);
        ctx.drawImage(rendered.canvas, 0, 0);
      }
    }
  });

  if (fitW === cardW && fitH === cardH) return createImageBitmap(comp);
  const out = new OffscreenCanvas(cardW, cardH);
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("2D canvas unavailable");
  // Pillar/letterbox the fitted frame on a dimmed, blurred copy of itself.
  outCtx.save();
  outCtx.filter = "blur(10px) brightness(0.55)";
  drawCover(outCtx, comp, cardW, cardH);
  outCtx.restore();
  outCtx.drawImage(comp, Math.round((cardW - fitW) / 2), Math.round((cardH - fitH) / 2));
  return createImageBitmap(out);
}
