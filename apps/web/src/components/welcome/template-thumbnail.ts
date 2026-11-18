import { GraphicsEngine, TemplateEngine, TitleEngine } from "@openreel/core";
import type { Project, ScriptableTemplate, Template } from "@openreel/core";
import type { TemplateThumbSource } from "./TemplateThumb";

/** Thumbnails are 16:9 everywhere (a vertical template is pillarboxed), so every grid keeps even rows. */
export const TEMPLATE_THUMB_WIDTH = 640;
export const TEMPLATE_THUMB_HEIGHT = 360;
const SCRIM = "rgba(8, 9, 11, 0.32)";

let scratch: { graphics: GraphicsEngine; titles: TitleEngine; templates: TemplateEngine } | null = null;

function engines() {
  if (!scratch) {
    const titles = new TitleEngine();
    titles.initialize();
    scratch = { graphics: new GraphicsEngine(), titles, templates: new TemplateEngine() };
  }
  return scratch;
}

type Source = ImageBitmap | OffscreenCanvas;

function drawCover(ctx: OffscreenCanvasRenderingContext2D, source: Source, x: number, y: number, w: number, h: number, focusX = 0.5): void {
  const scale = Math.max(w / source.width, h / source.height);
  const dw = source.width * scale;
  const dh = source.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(source, x + (w - dw) * focusX, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** Deterministic 0..1 horizontal pan of the backdrop for a template id. */
export function backdropFocus(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 1000) / 999;
}

/** The template's own frame inside the 16:9 thumbnail (the full thumbnail when the template is 16:9). */
export function templateFrameRect(
  settings: { width: number; height: number },
  outW = TEMPLATE_THUMB_WIDTH,
  outH = TEMPLATE_THUMB_HEIGHT,
): { x: number; y: number; width: number; height: number } {
  const aspect = settings.width > 0 && settings.height > 0 ? settings.width / settings.height : outW / outH;
  if (Math.abs(aspect - outW / outH) < 0.02) return { x: 0, y: 0, width: outW, height: outH };
  if (aspect < outW / outH) {
    const width = Math.round(outH * aspect);
    return { x: Math.round((outW - width) / 2), y: 0, width, height: outH };
  }
  const height = Math.round(outW / aspect);
  return { x: 0, y: Math.round((outH - height) / 2), width: outW, height };
}

/** Applies the template through the same engine "Use template" uses, with its default placeholder values. */
function applyDefaults(template: Template | ScriptableTemplate): Project | null {
  try {
    return engines().templates.applyTemplate(template as Template, {}).project;
  } catch (error) {
    console.warn("[template-thumbnail] template could not be applied for its thumbnail:", error);
    return null;
  }
}

/**
 * Renders one template to a 16:9 frame: the template is applied (default values, the real TemplateEngine), its
 * footage slots show `backdrop`, and its text / shape layers are drawn by the title and graphics engines at the
 * moment each layer is fully on screen, laid out at the template's own resolution. Vertical and square templates
 * keep their aspect, pillarboxed over a blurred copy of the footage.
 */
export async function renderTemplateThumbnail(
  template: Template | ScriptableTemplate,
  backdrop: Source,
  options: { progress?: number; project?: Project | null } = {},
): Promise<OffscreenCanvas> {
  const out = new OffscreenCanvas(TEMPLATE_THUMB_WIDTH, TEMPLATE_THUMB_HEIGHT);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const frame = templateFrameRect(template.settings);
  // The footage slot of every template is the same sample scene; each template looks at its own part of it, so the
  // cards of a grid are told apart by more than their (small) text.
  const focus = backdropFocus(template.id);

  if (frame.width !== out.width || frame.height !== out.height) {
    ctx.save();
    ctx.filter = "blur(18px)";
    drawCover(ctx, backdrop, -24, -24, out.width + 48, out.height + 48, focus);
    ctx.restore();
    ctx.fillStyle = "rgba(8, 9, 11, 0.55)";
    ctx.fillRect(0, 0, out.width, out.height);
  }
  drawCover(ctx, backdrop, frame.x, frame.y, frame.width, frame.height, focus);
  ctx.fillStyle = SCRIM;
  ctx.fillRect(frame.x, frame.y, frame.width, frame.height);

  const project = options.project === undefined ? applyDefaults(template) : options.project;
  if (!project) return out;
  // Each layer is drawn at the same fraction of its own span: the moment it is fully on screen by default, or the
  // moment `progress` (0..1) of the animation the hero plays on hover.
  const at = (duration: number) => duration * (options.progress ?? 0.5);

  const { width, height } = template.settings;
  // Layers are composed at the template's resolution, then scaled into the frame, as the export compositor does.
  const layer = new OffscreenCanvas(width, height);
  const layerCtx = layer.getContext("2d");
  if (!layerCtx) return out;
  const { graphics, titles } = engines();
  try {
    await document.fonts.load('600 48px "Inter"');
  } catch {
    /* the engine falls back to a system font */
  }
  for (const clip of [...(project.shapeClips ?? []), ...(project.svgClips ?? [])]) {
    const rendered = await graphics.renderGraphic(clip, at(clip.duration), width, height);
    layerCtx.drawImage(rendered.canvas, 0, 0);
  }
  for (const clip of project.textClips ?? []) {
    layerCtx.drawImage(titles.renderText(clip, width, height, at(clip.duration)).canvas, 0, 0);
  }
  ctx.drawImage(layer, frame.x, frame.y, frame.width, frame.height);
  return out;
}

/** Frames of the hover loop of a template hero. */
export const TEMPLATE_MOTION_FRAMES = 14;

/** Time-yield between frames so rendering the loop never holds the main thread for the whole sequence. */
const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The template's own animation: the same thumbnail render (real TemplateEngine defaults, real title / graphics
 * engines over the sample scene) at `TEMPLATE_MOTION_FRAMES` moments of its layers' spans, from the intro to the
 * outro. Frames arrive progressively through `onFrame`; `signal` stops the work. Each canvas belongs to the caller.
 */
export async function renderTemplateMotionFrames(
  template: Template | ScriptableTemplate,
  onFrame: (frame: OffscreenCanvas, index: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const backdrop = await loadSample();
  const project = applyDefaults(template);
  if (!project) return;
  for (let index = 0; index < TEMPLATE_MOTION_FRAMES; index++) {
    if (signal?.aborted) return;
    const progress = 0.04 + (index / (TEMPLATE_MOTION_FRAMES - 1)) * 0.92;
    onFrame(await renderTemplateThumbnail(template, backdrop, { progress, project }), index);
    await yieldToBrowser();
  }
}

/** The art for a template without a bundled thumbnail: the bundled sample scene with the template drawn over it. */
export async function renderTemplateThumbnailBlob(
  template: Template | ScriptableTemplate,
  backdrop: Source,
): Promise<Blob> {
  const canvas = await renderTemplateThumbnail(template, backdrop);
  return canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
}

/**
 * Build-time entry (scripts/render-template-thumbs.mjs drives it in Chrome): every built-in template rendered over
 * `backdrop`, as webp blobs keyed by template id. The output is committed under public/template-thumbs.
 */
export async function renderBuiltinThumbnailBlobs(backdrop: Source): Promise<Record<string, Blob>> {
  const { BUILTIN_TEMPLATES } = await import("@openreel/core");
  const result: Record<string, Blob> = {};
  for (const template of BUILTIN_TEMPLATES) {
    result[template.id] = await renderTemplateThumbnailBlob(template, backdrop);
  }
  return result;
}

/** Build-time entry: the digest of every built-in template definition (see template-digest.ts). */
export async function builtinTemplateDigests(): Promise<Record<string, string>> {
  const [{ BUILTIN_TEMPLATES }, { templateDigest }] = await Promise.all([
    import("@openreel/core"),
    import("./template-digest"),
  ]);
  return Object.fromEntries(BUILTIN_TEMPLATES.map((template) => [template.id, templateDigest(template)]));
}

const rendered = new Map<string, string>();
let lane: Promise<unknown> = Promise.resolve();
let sample: Promise<ImageBitmap> | null = null;

const loadSample = (): Promise<ImageBitmap> => {
  sample ??= fetch(`${import.meta.env?.BASE_URL ?? "/"}effect-previews/sample-scene.jpg`)
    .then((response) => {
      if (!response.ok) throw new Error(`sample scene ${response.status}`);
      return response.blob();
    })
    .then((blob) => createImageBitmap(blob));
  // A failed fetch must not disable runtime thumbnails for the whole session: forget it so the next card retries.
  sample.catch(() => {
    sample = null;
  });
  return sample;
};

/**
 * Lazy runtime thumbnail for templates that ship without one (saved and cloud templates): drawn once through the
 * real template engine and title / graphics engines, one at a time and when the browser is idle, then cached for
 * the session. The renderer is a separate chunk, fetched only when such a card scrolls into view.
 */
export function renderRuntimeThumbnail(source: TemplateThumbSource): Promise<string | null> {
  const key = `${source.id}@${source.template?.version ?? ""}`;
  const hit = rendered.get(key);
  if (hit) return Promise.resolve(hit);
  const task = lane.then(async () => {
    await new Promise<void>((resolve) =>
      typeof requestIdleCallback === "function" ? requestIdleCallback(() => resolve(), { timeout: 600 }) : setTimeout(resolve, 0),
    );
    const again = rendered.get(key);
    if (again) return again;
    const backdrop = await loadSample();
    let template = source.template;
    if (!template) {
      const saved = await engines().templates.loadTemplate(source.id);
      if (!saved) return null;
      template = saved as unknown as ScriptableTemplate;
    }
    const url = URL.createObjectURL(await renderTemplateThumbnailBlob(template, backdrop));
    rendered.set(key, url);
    return url;
  });
  lane = task.catch(() => undefined);
  return task.catch((error: unknown) => {
    console.warn("[template-thumb] could not render a thumbnail:", error);
    return null;
  });
}


/** Renders `source`'s thumbnail once `element` is near the viewport and hands the object URL to `apply`. */
export function renderWhenVisible(
  element: Element | null,
  source: TemplateThumbSource,
  apply: (url: string) => void,
): () => void {
  let cancelled = false;
  const run = () => {
    void renderRuntimeThumbnail(source).then((url) => {
      if (!cancelled && url) apply(url);
    });
  };
  if (!element || typeof IntersectionObserver === "undefined") {
    run();
    return () => {
      cancelled = true;
    };
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        run();
      }
    },
    { rootMargin: "120px" },
  );
  observer.observe(element);
  return () => {
    cancelled = true;
    observer.disconnect();
  };
}
