import * as THREE from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { FontLoader, type Font } from "three/examples/jsm/loaders/FontLoader.js";
import type { TextClip } from "../text/types";
import type { Transform } from "../types/timeline";
import type { ShapeClip, SVGClip, StickerClip } from "../graphics/types";
import type { BlendMode } from "./types";
import { drawShapePathCentered } from "../graphics/shape-path";

type OverlayCanvas = HTMLCanvasElement | OffscreenCanvas;
type OverlayContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createOverlayCanvas(width: number, height: number): OverlayCanvas {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  throw new Error("3D overlay rendering requires canvas support");
}

// ─── 3D text font cache ──────────────────────────────────────────
// FontLoader is async but the render pipeline is sync. We resolve the
// font once per URL, cache the result, and let callers fall back to
// the 2D canvas pipeline until the font becomes available.
const FONT_CACHE = new Map<string, Font>();
const FONT_LOADING = new Map<string, Promise<Font>>();
const FONT_READY_CALLBACKS = new Map<string, Set<() => void>>();

const DEFAULT_3D_FONT_URL = "/fonts/helvetiker_regular.typeface.json";
const DEFAULT_3D_BOLD_FONT_URL = "/fonts/helvetiker_bold.typeface.json";
const TEXT_GEOMETRY_CACHE_ENTRIES = 32;
const TEXT_GEOMETRY_CACHE_BYTES = 16 * 1024 * 1024;

interface CachedTextGeometry {
  lines: THREE.BufferGeometry[];
  bytes: number;
}

/** Darken a #rrggbb / #rgb color toward black by `amount` (0..1).
 *  Used as a sensible default for the extruded "side" face when the
 *  user hasn't picked an explicit side color. */
function darkenHex(hex: string, amount: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const factor = Math.max(0, 1 - amount);
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

function pick3DFontUrl(textClip: TextClip): string {
  const fw = textClip.style.fontWeight;
  const isBold = fw === "bold" || (typeof fw === "number" && fw >= 600);
  return isBold ? DEFAULT_3D_BOLD_FONT_URL : DEFAULT_3D_FONT_URL;
}

/**
 * Returns a parsed Font synchronously if it has already been loaded,
 * otherwise undefined. Triggers a background load on miss; the next
 * frame after it resolves will pick it up. The optional onReady
 * callback lets the caller request a re-render.
 */
export function get3DFont(
  url: string,
  onReady?: () => void,
): Font | undefined {
  const cached = FONT_CACHE.get(url);
  if (cached) return cached;
  if (onReady) {
    const callbacks = FONT_READY_CALLBACKS.get(url) ?? new Set<() => void>();
    callbacks.add(onReady);
    FONT_READY_CALLBACKS.set(url, callbacks);
  }
  if (!FONT_LOADING.has(url)) {
    const loader = new FontLoader();
    const promise = new Promise<Font>((resolve, reject) => {
      loader.load(
        url,
        (font) => {
          FONT_CACHE.set(url, font);
          FONT_LOADING.delete(url);
          resolve(font);
          const callbacks = FONT_READY_CALLBACKS.get(url);
          FONT_READY_CALLBACKS.delete(url);
          callbacks?.forEach((callback) => callback());
        },
        undefined,
        (err) => {
          FONT_LOADING.delete(url);
          FONT_READY_CALLBACKS.delete(url);
          reject(err);
        },
      );
    });
    FONT_LOADING.set(url, promise);
    promise.catch(() => {
      /* font load failure is non-fatal — we fall back to 2D */
    });
  }
  return undefined;
}

// Map CSS blend modes to THREE.js blending constants
// Note: THREE.js only supports a subset of blend modes, so some CSS modes are approximated
// with the closest THREE.js equivalent for visual similarity
const BLEND_MODE_MAP: Record<BlendMode, THREE.Blending> = {
  normal: THREE.NormalBlending,
  multiply: THREE.MultiplyBlending,
  screen: THREE.AdditiveBlending,
  overlay: THREE.NormalBlending, // Approximated as normal
  darken: THREE.NormalBlending, // Approximated as normal
  lighten: THREE.AdditiveBlending,
  "color-dodge": THREE.AdditiveBlending,
  "color-burn": THREE.MultiplyBlending,
  "hard-light": THREE.NormalBlending, // Approximated as normal
  "soft-light": THREE.NormalBlending, // Approximated as normal
  difference: THREE.SubtractiveBlending,
  exclusion: THREE.SubtractiveBlending,
  hue: THREE.NormalBlending, // Approximated as normal
  saturation: THREE.NormalBlending, // Approximated as normal
  color: THREE.NormalBlending, // Approximated as normal
  luminosity: THREE.NormalBlending, // Approximated as normal
  add: THREE.AdditiveBlending,
  "linear-dodge": THREE.AdditiveBlending,
};

export class ThreeJSLayerRenderer {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private _canvas: OverlayCanvas;
  private textMeasurementContext: OverlayContext2D | null = null;
  private textGeometryCache?: Map<string, CachedTextGeometry>;
  private cachedTextGeometries?: Set<THREE.BufferGeometry>;
  private textGeometryCacheBytes = 0;

  constructor(width: number, height: number) {
    this._canvas = createOverlayCanvas(width, height);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true, // Enables readPixels for canvas capture
    });
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x000000, 0); // Transparent background

    this.scene = new THREE.Scene();

    // Use orthographic camera for 2D-like rendering (no perspective distortion)
    // Camera frustum matches canvas dimensions for pixel-perfect rendering
    const aspect = width / height;
    const frustumSize = height;
    this.camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      2000,
    );
    this.camera.position.z = 1000;

    // Add ambient + directional lights so MeshPhysicalMaterial-based
    // 3D text gets sensible shading. These have no effect on the
    // BasicMaterial-backed 2D layers.
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(0.5, 1, 1).normalize().multiplyScalar(500);
    this.scene.add(directional);
  }

  /** Callback the host can register so we can request a re-render
   *  when a 3D font has finished loading. */
  private _onFontReady: (() => void) | null = null;
  private readonly handleFontReady = () => this._onFontReady?.();
  setFontReadyCallback(cb: (() => void) | null) {
    this._onFontReady = cb;
  }

  resize(width: number, height: number, sceneWidth = width, sceneHeight = height) {
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this.renderer.setSize(width, height, false);
    }
    // Keep authoring coordinates independent of the encoded pixel dimensions.
    if (this.camera.right !== sceneWidth / 2 || this.camera.top !== sceneHeight / 2) {
      this.camera.left = -sceneWidth / 2;
      this.camera.right = sceneWidth / 2;
      this.camera.top = sceneHeight / 2;
      this.camera.bottom = -sceneHeight / 2;
      this.camera.updateProjectionMatrix();
    }
  }

  async prepareTextClip(textClip: TextClip): Promise<void> {
    if (!textClip.text3d?.enabled) return;
    const url = pick3DFontUrl(textClip);
    if (get3DFont(url)) return;
    // Export must not encode a flat placeholder while its 3D font is loading.
    await FONT_LOADING.get(url);
  }

  createTextTexture(
    textClip: TextClip,
    _canvasWidth: number,
    _canvasHeight: number,
  ): THREE.CanvasTexture<OverlayCanvas> {
    const textCanvas = createOverlayCanvas(_canvasWidth, _canvasHeight);
    const ctx = textCanvas.getContext("2d") as OverlayContext2D;

    ctx.clearRect(0, 0, _canvasWidth, _canvasHeight);

    const style = textClip.style;
    const fontWeight =
      typeof style.fontWeight === "number"
        ? style.fontWeight
        : style.fontWeight === "bold"
          ? 700
          : 400;

    ctx.font = `${style.fontStyle} ${fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
    ctx.fillStyle = style.color;
    ctx.textAlign = style.textAlign as CanvasTextAlign;
    ctx.textBaseline = "middle";

    if (style.shadowColor && style.shadowBlur) {
      ctx.shadowColor = style.shadowColor;
      ctx.shadowBlur = style.shadowBlur;
      ctx.shadowOffsetX = style.shadowOffsetX || 0;
      ctx.shadowOffsetY = style.shadowOffsetY || 0;
    }

    if (style.strokeColor && style.strokeWidth) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth;
    }

    const lines = textClip.text.split("\n");
    const lineHeight = style.fontSize * style.lineHeight;

    lines.forEach((line, index) => {
      const y =
        _canvasHeight / 2 + (index - (lines.length - 1) / 2) * lineHeight;

      if (style.strokeColor && style.strokeWidth) {
        ctx.strokeText(line, _canvasWidth / 2, y);
      }
      ctx.fillText(line, _canvasWidth / 2, y);
    });

    const texture = new THREE.CanvasTexture(textCanvas);
    texture.needsUpdate = true;
    return texture;
  }

  applyTransform(
    mesh: THREE.Object3D,
    transform: Transform,
    _canvasWidth: number,
    _canvasHeight: number,
  ) {
    // Position: (0.5, 0.5) is center of canvas, adjust coordinate system and flip Y
    const posX = (transform.position.x - 0.5) * _canvasWidth;
    const posY = -(transform.position.y - 0.5) * _canvasHeight;

    mesh.position.set(posX, posY, 0);

    mesh.scale.set(transform.scale.x, transform.scale.y, 1);

    // Z-rotation is 2D rotation (happens in the plane)
    mesh.rotation.z = (transform.rotation * Math.PI) / 180;

    // 3D rotations: X and Y rotations add depth perspective
    if (transform.rotate3d) {
      mesh.rotation.x = (transform.rotate3d.x * Math.PI) / 180;
      mesh.rotation.y = (transform.rotate3d.y * Math.PI) / 180;
      mesh.rotation.z += (transform.rotate3d.z * Math.PI) / 180;
    }

    // Camera distance controls perspective intensity (lower Z = stronger perspective effect)
    if (transform.perspective) {
      this.camera.position.z = transform.perspective;
      this.camera.updateProjectionMatrix();
    }
  }

  applyBlendMode(
    material: THREE.MeshBasicMaterial,
    blendMode: BlendMode,
    blendOpacity: number,
  ) {
    // Map CSS blend modes to THREE.js blending and set opacity as separate property
    // blendOpacity is stored as 0-100, normalize to 0-1 range
    material.blending = BLEND_MODE_MAP[blendMode] || THREE.NormalBlending;
    material.opacity = (blendOpacity ?? 100) / 100;
    material.transparent = true;
  }

  renderTextClip(
    textClip: TextClip,
    _canvasWidth: number,
    _canvasHeight: number,
  ): THREE.Mesh | THREE.Group | null {
    // 3D extrusion path — only when explicitly enabled AND the font
    // for the clip's weight is already cached. Otherwise fall through
    // to the 2D canvas-textured plane so the user still sees
    // something while the font loads in the background.
    if (textClip.text3d?.enabled) {
      const fontUrl = pick3DFontUrl(textClip);
      const font = get3DFont(fontUrl, this.handleFontReady);
      if (font) {
        const mesh = this.buildText3DMesh(
          textClip,
          font,
          _canvasWidth,
          _canvasHeight,
        );
        if (mesh) return mesh;
      }
    }

    const texture = this.createTextTexture(
      textClip,
      _canvasWidth,
      _canvasHeight,
    );

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: textClip.transform.opacity,
      side: THREE.DoubleSide,
    });

    this.applyBlendMode(
      material,
      textClip.blendMode || "normal",
      textClip.blendOpacity ?? 100,
    );

    const geometry = new THREE.PlaneGeometry(_canvasWidth, _canvasHeight);
    const mesh = new THREE.Mesh(geometry, material);

    this.applyTransform(mesh, textClip.transform, _canvasWidth, _canvasHeight);

    return mesh;
  }

  /**
   * Build a 3D-extruded text Group sized to match the host canvas.
   * Returns null on geometry/font errors (caller falls back to 2D).
   */
  private buildText3DMesh(
    textClip: TextClip,
    font: Font,
    canvasWidth: number,
    canvasHeight: number,
  ): THREE.Group | null {
    try {
      const settings = textClip.text3d!;
      const fontSize = textClip.style.fontSize;
      const depth = Math.max(1, settings.depth);
      const bevelEnabled = settings.bevelThickness > 0 || settings.bevelSize > 0;

      const lines = textClip.text.split("\n");
      const lineHeight = fontSize * textClip.style.lineHeight;
      const group = new THREE.Group();
      const measurement = this.textMeasurementContext ??= createOverlayCanvas(1, 1)
        .getContext("2d") as OverlayContext2D;
      const style = textClip.style;
      measurement.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px "${style.fontFamily}"`;
      measurement.textAlign = style.textAlign as CanvasTextAlign;
      measurement.textBaseline = "middle";
      if ("letterSpacing" in measurement) measurement.letterSpacing = `${style.letterSpacing}px`;
      const firstBaseline = style.verticalAlign === "top" ? 0
        : style.verticalAlign === "bottom" ? -lines.length * lineHeight
          : -(lines.length - 1) * lineHeight / 2;

      // The bundled extrusion font has different advances and a baseline at
      // its bottom edge. Fit its ink to the selected 2D font's measured bounds,
      // retaining authoring alignment/tracking instead of jumping size/position
      // when 3D is enabled. Z depth and the clip transform stay independent.
      const layout = lines.map((line, index) => {
        const metrics = measurement.measureText(line);
        const fallbackLeft = style.textAlign === "center" ? -metrics.width / 2
          : style.textAlign === "right" ? -metrics.width : 0;
        return {
          line,
          baseline: firstBaseline + index * lineHeight,
          left: Number.isFinite(metrics.actualBoundingBoxLeft) ? -metrics.actualBoundingBoxLeft : fallbackLeft,
          right: Number.isFinite(metrics.actualBoundingBoxRight) ? metrics.actualBoundingBoxRight : fallbackLeft + metrics.width,
          ascent: Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : fontSize / 2,
          descent: Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : fontSize / 2,
        };
      }).filter(line => line.line.length > 0);
      // Measuring before lookup also invalidates a fallback font's layout when
      // the selected face finishes loading without changing the saved style.
      const geometryKey = JSON.stringify([pick3DFontUrl(textClip), fontSize, depth,
        settings.bevelThickness, settings.bevelSize, settings.bevelSegments, layout]);
      const cached = this.textGeometryCache?.get(geometryKey);
      if (cached) {
        this.textGeometryCache!.delete(geometryKey);
        this.textGeometryCache!.set(geometryKey, cached);
      }
      const geometries = cached?.lines ?? layout.map(({ line, baseline, left, right, ascent, descent }) => {
        const geometry = new TextGeometry(line, {
          font,
          size: fontSize,
          depth,
          curveSegments: 4,
          bevelEnabled,
          bevelThickness: settings.bevelThickness,
          bevelSize: settings.bevelSize,
          bevelSegments: Math.max(1, settings.bevelSegments),
          bevelOffset: 0,
        });
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        if (bbox && bbox.max.x > bbox.min.x && bbox.max.y > bbox.min.y) {
          const scaleX = right > left ? (right - left) / (bbox.max.x - bbox.min.x) : 1;
          const scaleY = ascent + descent > 0 ? (ascent + descent) / (bbox.max.y - bbox.min.y) : 1;
          const offsetX = left - bbox.min.x * scaleX;
          const offsetY = -baseline - descent - bbox.min.y * scaleY;
          geometry.scale(scaleX, scaleY, 1);
          geometry.translate(offsetX, offsetY, -depth / 2);
        }
        return geometry;
      });
      if (!cached) this.retainTextGeometry(geometryKey, geometries);

      geometries.forEach(geometry => {
        const front = settings.frontColor ?? textClip.style.color;
        const side = settings.sideColor ?? darkenHex(front, 0.6);

        let frontMat: THREE.Material;
        let sideMat: THREE.Material;
        if (settings.material === "physical") {
          frontMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(front),
            metalness: settings.metalness ?? 0.4,
            roughness: settings.roughness ?? 0.45,
          });
          sideMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(side),
            metalness: settings.metalness ?? 0.4,
            roughness: settings.roughness ?? 0.45,
          });
        } else {
          frontMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(front),
          });
          sideMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(side),
          });
        }
        const mesh = new THREE.Mesh(geometry, [frontMat, sideMat]);
        group.add(mesh);
      });

      this.applyTransform(group, textClip.transform, canvasWidth, canvasHeight);
      // Make the 3D text honor the clip-level opacity by setting it on
      // each child material.
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const materials = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          for (const m of materials) {
            (m as THREE.Material).transparent = true;
            (m as THREE.Material).opacity = textClip.transform.opacity;
          }
        }
      });
      return group;
    } catch (err) {
      console.error("[ThreeJSLayerRenderer] 3D text build failed:", err);
      return null;
    }
  }

  private retainTextGeometry(key: string, lines: THREE.BufferGeometry[]) {
    const cache = this.textGeometryCache ??= new Map();
    const owned = this.cachedTextGeometries ??= new Set();
    const bytes = lines.reduce((total, geometry) => total + Object.values(geometry.attributes)
      .reduce((sum, attribute) => sum + attribute.array.byteLength, geometry.index?.array.byteLength ?? 0), 0);
    cache.set(key, { lines, bytes });
    this.textGeometryCacheBytes += bytes;
    lines.forEach(geometry => owned.add(geometry));
    if (cache.size <= TEXT_GEOMETRY_CACHE_ENTRIES && this.textGeometryCacheBytes <= TEXT_GEOMETRY_CACHE_BYTES) return;

    const inScene = new Set<THREE.BufferGeometry>();
    this.scene.traverse(object => { if (object instanceof THREE.Mesh) inScene.add(object.geometry); });
    // Keep one large active title usable even if it alone exceeds the budget.
    while (cache.size > TEXT_GEOMETRY_CACHE_ENTRIES || (cache.size > 1 && this.textGeometryCacheBytes > TEXT_GEOMETRY_CACHE_BYTES)) {
      const oldest = cache.entries().next().value!;
      cache.delete(oldest[0]);
      this.textGeometryCacheBytes -= oldest[1].bytes;
      for (const geometry of oldest[1].lines) {
        owned.delete(geometry);
        // A multi-layer preview may still need this geometry in its next draw.
        // Removing cache ownership lets clear() release it after that draw.
        if (!inScene.has(geometry)) geometry.dispose();
      }
    }
  }

  createCanvasTexture(
    renderFn: (ctx: OverlayContext2D) => void,
    width: number,
    height: number,
  ): THREE.CanvasTexture<OverlayCanvas> {
    // Create temporary canvas for rendering, pass context to render function
    // This allows flexible rendering of shapes or other content as textures
    const canvas = createOverlayCanvas(width, height);
    const ctx = canvas.getContext("2d") as OverlayContext2D;
    renderFn(ctx);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true; // Signal THREE.js to update texture from canvas
    return texture;
  }

  /**
   * Build a 3D-primitive mesh (cube / sphere / torus / cone / etc.)
   * sized relative to the host canvas. Honors transform (including
   * rotate3d) and fill color; uses MeshStandardMaterial when the user
   * has selected a "physical" material kind so scene lights show.
   */
  private buildShape3DMesh(
    shapeClip: ShapeClip,
    canvasWidth: number,
    canvasHeight: number,
  ): THREE.Mesh | null {
    const { shapeType, style, transform } = shapeClip;
    // Base size: same "15% of min(W,H)" used by the 2D shape renderer
    // so 2D ↔ 3D toggles don't surprise the user with size jumps.
    const baseSize = Math.min(canvasWidth, canvasHeight) * 0.15;

    let geometry: THREE.BufferGeometry;
    switch (shapeType) {
      case "mesh-cube":
        geometry = new THREE.BoxGeometry(baseSize, baseSize, baseSize);
        break;
      case "mesh-sphere":
        geometry = new THREE.SphereGeometry(baseSize / 2, 32, 32);
        break;
      case "mesh-torus":
        geometry = new THREE.TorusGeometry(
          baseSize / 2,
          baseSize / 6,
          16,
          48,
        );
        break;
      case "mesh-cone":
        geometry = new THREE.ConeGeometry(baseSize / 2, baseSize, 32);
        break;
      case "mesh-cylinder":
        geometry = new THREE.CylinderGeometry(
          baseSize / 2,
          baseSize / 2,
          baseSize,
          32,
        );
        break;
      case "mesh-icosahedron":
        geometry = new THREE.IcosahedronGeometry(baseSize / 2, 0);
        break;
      default:
        return null;
    }

    const color = style.fill?.color ?? "#3b82f6";
    const mat3d = style.material3d;
    const kind = mat3d?.kind ?? "physical";
    const material =
      kind === "physical"
        ? new THREE.MeshStandardMaterial({
            color: new THREE.Color(color),
            metalness: mat3d?.metalness ?? 0.3,
            roughness: mat3d?.roughness ?? 0.5,
            transparent: true,
            opacity: transform.opacity,
          })
        : new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: transform.opacity,
          });

    const mesh = new THREE.Mesh(geometry, material);
    this.applyTransform(mesh, transform, canvasWidth, canvasHeight);
    return mesh;
  }

  renderShapeClip(
    shapeClip: ShapeClip,
    canvasWidth: number,
    canvasHeight: number,
  ): THREE.Mesh | THREE.Group | null {
    const { shapeType, style, transform } = shapeClip;

    if (shapeType.startsWith("mesh-")) {
      return this.buildShape3DMesh(shapeClip, canvasWidth, canvasHeight);
    }

    const texture = this.createCanvasTexture(
      (ctx) => {
        const posX = transform.position.x * canvasWidth;
        const posY = transform.position.y * canvasHeight;

        ctx.translate(posX, posY);
        ctx.scale(transform.scale.x, transform.scale.y);

        if (style.shadow?.blur && style.shadow.blur > 0) {
          ctx.shadowColor = style.shadow.color || "#000000";
          ctx.shadowBlur = style.shadow.blur;
          ctx.shadowOffsetX = style.shadow.offsetX || 0;
          ctx.shadowOffsetY = style.shadow.offsetY || 0;
        }

        const baseSize = Math.min(canvasWidth, canvasHeight);
        const shapeSize = baseSize * 0.15;
        const halfSize = shapeSize / 2;

        const strokeScale = baseSize / 1080;
        ctx.fillStyle = style.fill?.color || "#3b82f6";
        ctx.strokeStyle = style.stroke?.color || "#1d4ed8";
        ctx.lineWidth = (style.stroke?.width || 2) * strokeScale;

        if (style.stroke?.dashArray && style.stroke.dashArray.length > 0) {
          ctx.setLineDash(style.stroke.dashArray);
        }

        ctx.beginPath();

        switch (shapeType) {
          case "rectangle": {
            const radius = style.cornerRadius || 0;
            if (radius > 0) {
              ctx.roundRect(
                -halfSize,
                -halfSize,
                shapeSize,
                shapeSize,
                Math.min(radius, halfSize),
              );
            } else {
              ctx.rect(-halfSize, -halfSize, shapeSize, shapeSize);
            }
            break;
          }
          case "circle":
          case "ellipse": {
            ctx.ellipse(0, 0, halfSize, halfSize, 0, 0, Math.PI * 2);
            break;
          }
          case "triangle": {
            ctx.moveTo(0, -halfSize);
            ctx.lineTo(halfSize, halfSize);
            ctx.lineTo(-halfSize, halfSize);
            ctx.closePath();
            break;
          }
          case "star": {
            const outerRadius = halfSize;
            const innerRadius = halfSize * 0.4;
            const points = 5;
            for (let i = 0; i < points * 2; i++) {
              const radius = i % 2 === 0 ? outerRadius : innerRadius;
              const angle = (i * Math.PI) / points - Math.PI / 2;
              const x = Math.cos(angle) * radius;
              const y = Math.sin(angle) * radius;
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
            ctx.closePath();
            break;
          }
          case "polygon": {
            const sides = 6;
            for (let i = 0; i < sides; i++) {
              const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
              const x = Math.cos(angle) * halfSize;
              const y = Math.sin(angle) * halfSize;
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
            ctx.closePath();
            break;
          }
          case "line": {
            ctx.moveTo(-halfSize, 0);
            ctx.lineTo(halfSize, 0);
            break;
          }
          case "path": {
            drawShapePathCentered(ctx, shapeClip, shapeSize);
            break;
          }
        }

        if (style.fill?.color && shapeType !== "line") {
          ctx.fill();
        }
        if (style.stroke?.width && style.stroke.width > 0) {
          ctx.stroke();
        }
      },
      canvasWidth,
      canvasHeight,
    );

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: transform.opacity,
      side: THREE.DoubleSide,
    });

    this.applyBlendMode(
      material,
      shapeClip.blendMode || "normal",
      shapeClip.blendOpacity ?? 100,
    );

    const geometry = new THREE.PlaneGeometry(canvasWidth, canvasHeight);
    const mesh = new THREE.Mesh(geometry, material);

    this.applyTransform(mesh, transform, canvasWidth, canvasHeight);

    return mesh;
  }

  renderSVGClip(
    svgClip: SVGClip,
    canvasWidth: number,
    canvasHeight: number,
  ): THREE.Mesh | null {
    const { svgContent, transform, viewBox } = svgClip;

    const texture = this.createCanvasTexture(
      (ctx) => {
        const img = new Image();
        const blob = new Blob([svgContent], { type: "image/svg+xml" });
        img.src = URL.createObjectURL(blob);

        if (img.complete && img.naturalWidth > 0) {
          const posX = transform.position.x * canvasWidth;
          const posY = transform.position.y * canvasHeight;

          ctx.translate(posX, posY);
          ctx.scale(transform.scale.x, transform.scale.y);

          const svgWidth = viewBox?.width || 200;
          const svgHeight = viewBox?.height || 200;
          ctx.drawImage(
            img,
            -svgWidth / 2,
            -svgHeight / 2,
            svgWidth,
            svgHeight,
          );
        }

        URL.revokeObjectURL(img.src);
      },
      canvasWidth,
      canvasHeight,
    );

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: transform.opacity,
      side: THREE.DoubleSide,
    });

    this.applyBlendMode(
      material,
      svgClip.blendMode || "normal",
      svgClip.blendOpacity ?? 100,
    );

    const geometry = new THREE.PlaneGeometry(canvasWidth, canvasHeight);
    const mesh = new THREE.Mesh(geometry, material);

    this.applyTransform(mesh, transform, canvasWidth, canvasHeight);

    return mesh;
  }

  renderStickerClip(
    stickerClip: StickerClip,
    canvasWidth: number,
    canvasHeight: number,
  ): THREE.Mesh | null {
    const { imageUrl, transform } = stickerClip;

    const texture = this.createCanvasTexture(
      (ctx) => {
        const img = new Image();
        img.src = imageUrl;

        if (img.complete && img.naturalWidth > 0) {
          const posX = transform.position.x * canvasWidth;
          const posY = transform.position.y * canvasHeight;

          ctx.translate(posX, posY);
          ctx.scale(transform.scale.x, transform.scale.y);

          ctx.drawImage(
            img,
            -img.naturalWidth / 2,
            -img.naturalHeight / 2,
            img.naturalWidth,
            img.naturalHeight,
          );
        }
      },
      canvasWidth,
      canvasHeight,
    );

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: transform.opacity,
      side: THREE.DoubleSide,
    });

    this.applyBlendMode(
      material,
      stickerClip.blendMode || "normal",
      stickerClip.blendOpacity ?? 100,
    );

    const geometry = new THREE.PlaneGeometry(canvasWidth, canvasHeight);
    const mesh = new THREE.Mesh(geometry, material);

    this.applyTransform(mesh, transform, canvasWidth, canvasHeight);

    return mesh;
  }

  render(): OverlayCanvas {
    this.renderer.render(this.scene, this.camera);
    return this._canvas;
  }

  clear() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const object of [...this.scene.children]) {
      // Lighting belongs to the renderer, not the previous clip frame.
      if (object instanceof THREE.Light) continue;
      this.scene.remove(object);
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        geometries.add(child.geometry);
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          materials.add(material);
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) textures.add(value);
          }
        }
      });
    }
    geometries.forEach((geometry) => { if (!this.cachedTextGeometries?.has(geometry)) geometry.dispose(); });
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    this.renderer.clear();
  }

  dispose() {
    this._onFontReady = null;
    this.textMeasurementContext = null;
    for (const callbacks of FONT_READY_CALLBACKS.values()) {
      callbacks.delete(this.handleFontReady);
    }
    this.clear();
    for (const entry of this.textGeometryCache?.values() ?? []) {
      for (const geometry of entry.lines) geometry.dispose();
    }
    this.textGeometryCache?.clear();
    this.cachedTextGeometries?.clear();
    this.textGeometryCacheBytes = 0;
    this.scene.clear();
    this.renderer.dispose();
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  get canvas(): OverlayCanvas {
    return this._canvas;
  }
}
