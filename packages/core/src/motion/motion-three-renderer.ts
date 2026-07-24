import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FontLoader, type Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import type {
  MotionMaterial3D,
  MotionObject3D,
  MotionScene3DLayer,
  MotionScene3DLighting,
  MotionScene3DRoom,
} from "./types";

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface BuiltThreeObject {
  readonly root: THREE.Object3D;
  readonly texture?: THREE.Texture;
  readonly animations?: readonly THREE.AnimationClip[];
}

interface LoadedModel {
  readonly root: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
}

interface AnimatedSceneEntry {
  sig: string;
  root: THREE.Object3D;
  lidPivot?: THREE.Object3D;
  materials: THREE.Material[];
  textures: THREE.Texture[];
  mixer?: THREE.AnimationMixer;
  animations?: readonly THREE.AnimationClip[];
  activeAnimationKey?: string;
}

/** One object inside a scene, already sampled at the current time by motion-renderer. */
export interface MotionThreeSceneObjectInput {
  readonly id: string;
  readonly object: MotionObject3D;
  readonly material?: MotionMaterial3D;
  readonly position: Vec3;
  /** Euler degrees. */
  readonly rotation: Vec3;
  readonly scale: Vec3;
  readonly opacity: number;
  /** kind="open-box": lid angle in degrees. */
  readonly lidAngle: number;
  readonly texture?: TexImageSource | null;
  readonly normalTexture?: TexImageSource | null;
  readonly roughnessTexture?: TexImageSource | null;
  readonly metalnessTexture?: TexImageSource | null;
}

export interface MotionThreeSceneInput {
  readonly objects: readonly MotionThreeSceneObjectInput[];
  readonly camera: {
    readonly position: Vec3;
    readonly target: Vec3;
    readonly fov: number;
    readonly near?: number;
    readonly far?: number;
  };
  readonly room?: MotionScene3DRoom;
}

/** View transform applied at present time — "agx" matches the Blender 4.x look. */
export type MotionToneMapping =
  | "agx"
  | "aces"
  | "filmic"
  | "neutral"
  | "linear"
  | "none";

/** Image-based-lighting world preset. Drives reflections + ambient fill. */
export type MotionEnvironmentPreset =
  | "studio"
  | "warm"
  | "cool"
  | "sunset"
  | "city"
  | "dark"
  | "none";

export interface MotionRenderQuality {
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly environment: boolean;
  /** Cinematic post-processing (bloom + optional AO/DOF). Off for fast preview. */
  readonly postProcessing?: boolean;
  /** UnrealBloom strength when postProcessing is on. */
  readonly bloomStrength?: number;
  /** Screen-space ambient occlusion (GTAO) — grounds objects with contact shadows. */
  readonly ambientOcclusion?: boolean;
  /** Cinematic depth-of-field (Bokeh): focal plane on the camera target. */
  readonly depthOfField?: boolean;
  /** DOF aperture (blur strength) when depthOfField is on. */
  readonly dofAperture?: number;
  /** MSAA samples for the post-processing pipeline (0 disables; 4 is a good default). */
  readonly antialiasSamples?: number;
  /** View transform / tonemap applied on present. Defaults to AgX (the Blender look). */
  readonly toneMapping?: MotionToneMapping;
  /** Tonemap exposure multiplier. */
  readonly exposure?: number;
  /** Soft area (softbox) key light for product-grade speculars. */
  readonly softLighting?: boolean;
  /** Image-based-lighting intensity (reflections + ambient fill). */
  readonly environmentIntensity?: number;
}

export const DEFAULT_ENVIRONMENT_INTENSITY = 0.85;

export const DEFAULT_MOTION_RENDER_QUALITY: MotionRenderQuality = {
  shadows: true,
  shadowMapSize: 2048,
  environment: true,
  postProcessing: true,
  bloomStrength: 0.34,
  ambientOcclusion: true,
  depthOfField: true,
  dofAperture: 0.0016,
  antialiasSamples: 4,
  toneMapping: "agx",
  exposure: 1,
  softLighting: true,
  environmentIntensity: DEFAULT_ENVIRONMENT_INTENSITY,
};

export function mergeMotionRenderQuality(
  partial?: Partial<MotionRenderQuality>,
): MotionRenderQuality {
  return { ...DEFAULT_MOTION_RENDER_QUALITY, ...(partial ?? {}) };
}

export function resolveMotionToneMapping(
  mapping: MotionToneMapping | undefined,
): THREE.ToneMapping {
  switch (mapping) {
    case "aces":
      return THREE.ACESFilmicToneMapping;
    case "filmic":
      return THREE.CineonToneMapping;
    case "neutral":
      return THREE.NeutralToneMapping;
    case "linear":
      return THREE.LinearToneMapping;
    case "none":
      return THREE.NoToneMapping;
    case "agx":
    default:
      return THREE.AgXToneMapping;
  }
}

export interface MotionEnvironmentDescriptor {
  readonly kind: "room" | "gradient" | "none";
  readonly intensity: number;
  readonly gradient?: {
    readonly zenith: string;
    readonly horizon: string;
    readonly ground: string;
  };
}

const ENVIRONMENT_GRADIENTS: Record<
  string,
  { readonly zenith: string; readonly horizon: string; readonly ground: string }
> = {
  warm: { zenith: "#3a2a1a", horizon: "#ffd9a0", ground: "#1a120a" },
  cool: { zenith: "#14233a", horizon: "#cfe6ff", ground: "#0a1018" },
  sunset: { zenith: "#2a1a4a", horizon: "#ff7a3c", ground: "#160d08" },
  city: { zenith: "#1a2230", horizon: "#aab6c4", ground: "#0c0e12" },
};

export function resolveEnvironmentPreset(
  preset: MotionEnvironmentPreset | string | undefined,
  baseIntensity: number,
): MotionEnvironmentDescriptor {
  const intensity = baseIntensity > 0 ? baseIntensity : DEFAULT_ENVIRONMENT_INTENSITY;
  switch (preset) {
    case "none":
      return { kind: "none", intensity: 0 };
    case "dark":
      return { kind: "room", intensity: Math.min(intensity, 0.18) };
    case "warm":
    case "cool":
    case "sunset":
    case "city":
      return { kind: "gradient", intensity, gradient: ENVIRONMENT_GRADIENTS[preset] };
    case "studio":
    default:
      return { kind: "room", intensity };
  }
}

export type MotionEnvironmentUrlKind = "hdr" | "exr" | "ldr";

export function classifyEnvironmentUrl(
  url: string | undefined,
): MotionEnvironmentUrlKind | null {
  if (!url) return null;
  const withoutQuery = url.split(/[?#]/)[0] ?? "";
  const match = /\.([a-z0-9]+)$/i.exec(withoutQuery);
  if (!match) return null;
  const ext = match[1]!.toLowerCase();
  if (ext === "hdr") return "hdr";
  if (ext === "exr") return "exr";
  if (["jpg", "jpeg", "png", "webp", "avif"].includes(ext)) return "ldr";
  return null;
}

export interface MotionEnvironmentSource {
  readonly mode: "url" | "preset" | "none";
  readonly intensity: number;
  readonly background: boolean;
  readonly url?: string;
  readonly urlKind?: MotionEnvironmentUrlKind;
  /** Preset descriptor used as the fallback while a url loads, or when mode === "preset". */
  readonly preset: MotionEnvironmentDescriptor;
}

export function resolveEnvironmentSource(
  lighting: MotionScene3DLighting | undefined,
  baseIntensity: number,
): MotionEnvironmentSource {
  const intensity = baseIntensity > 0 ? baseIntensity : DEFAULT_ENVIRONMENT_INTENSITY;
  const background = lighting?.environmentBackground === true;
  const preset = resolveEnvironmentPreset(lighting?.environment ?? "studio", intensity);
  const urlKind = classifyEnvironmentUrl(lighting?.environmentUrl);
  if (lighting?.environmentUrl && urlKind) {
    return {
      mode: "url",
      intensity,
      background,
      url: lighting.environmentUrl,
      urlKind,
      preset,
    };
  }
  if (preset.kind === "none") {
    return { mode: "none", intensity, background, preset };
  }
  return { mode: "preset", intensity, background, preset };
}

export interface MotionThreeRenderInput {
  readonly layer: MotionScene3DLayer;
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number };
  /** Dolly zoom in stops: +1 halves the camera distance (2x closer), -1 doubles it. */
  readonly cameraZoom?: number;
  readonly timeSeconds?: number;
  readonly width: number;
  readonly height: number;
  readonly screenTexture?: TexImageSource | null;
  /** Present => multi-object SCENE mode (pre-evaluated camera + objects). */
  readonly scene?: MotionThreeSceneInput;
  readonly quality?: MotionRenderQuality;
}

type MotionThreeCanvas = OffscreenCanvas | HTMLCanvasElement;

const DEG = Math.PI / 180;
const DEFAULT_TEXT3D_FONT_URL =
  "https://threejs.org/examples/fonts/helvetiker_bold.typeface.json";

const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

function collectMaterials(root: THREE.Object3D): THREE.Material[] {
  const materials: THREE.Material[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) materials.push(...mesh.material);
    else if (mesh.material) materials.push(mesh.material);
  });
  return materials;
}

function meshFingerprint(mesh: MotionObject3D["mesh"]): string | null {
  if (!mesh) return null;
  const positions = mesh.positions;
  const length = positions.length;
  const normalsLength = mesh.normals?.length ?? 0;
  const uvsLength = mesh.uvs?.length ?? 0;
  let accumulator = (length * 131 + mesh.indices.length + normalsLength * 17 + uvsLength * 7) | 0;
  for (let index = 0; index < length; index += 1) {
    accumulator = (Math.imul(accumulator, 31) + Math.round(positions[index]! * 1000)) | 0;
  }
  return `${length}:${mesh.indices.length}:${normalsLength}:${uvsLength}:${accumulator >>> 0}`;
}

function sceneObjectStructuralSig(obj: MotionThreeSceneObjectInput): string {
  const { mesh, ...objectWithoutMesh } = obj.object;
  return JSON.stringify({
    object: objectWithoutMesh,
    meshSig: meshFingerprint(mesh),
    material: obj.material,
    tex: !!obj.texture,
    nrm: !!obj.normalTexture,
    rgh: !!obj.roughnessTexture,
    mtl: !!obj.metalnessTexture,
  });
}

function normalizeModel(object: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 2.4 / maxDim;
  object.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  const wrapper = new THREE.Group();
  object.position.sub(center);
  wrapper.add(object);
  return wrapper;
}

function modelAnimationKey(
  animation: MotionObject3D["animation"] | undefined,
): string {
  return JSON.stringify({
    clipName: animation?.clipName ?? "",
    clipIndex: animation?.clipIndex ?? null,
    loop: animation?.loop ?? true,
  });
}

function selectModelAnimationClip(
  clips: readonly THREE.AnimationClip[] | undefined,
  animation: MotionObject3D["animation"] | undefined,
): THREE.AnimationClip | null {
  if (!animation) return null;
  if (!clips || clips.length === 0) return null;
  const clipName = animation?.clipName?.trim();
  if (clipName) {
    const exact = clips.find((clip) => clip.name === clipName);
    if (exact) return exact;
    const lowered = clipName.toLowerCase();
    const fuzzy = clips.find((clip) => clip.name.toLowerCase() === lowered);
    if (fuzzy) return fuzzy;
  }
  const clipIndex = animation?.clipIndex;
  if (
    typeof clipIndex === "number" &&
    Number.isInteger(clipIndex) &&
    clipIndex >= 0 &&
    clipIndex < clips.length
  ) {
    return clips[clipIndex];
  }
  return clips[0] ?? null;
}

function modelAnimationTime(
  animation: MotionObject3D["animation"] | undefined,
  clip: THREE.AnimationClip,
  timeSeconds: number,
): number {
  const duration = Math.max(1e-6, clip.duration || 1);
  const offset = animation?.timeOffset ?? 0;
  const playbackRate = animation?.playbackRate ?? 1;
  const raw =
    offset + Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0) * playbackRate;
  if (animation?.loop === false) {
    return Math.min(duration, Math.max(0, raw));
  }
  const wrapped = raw % duration;
  return wrapped < 0 ? wrapped + duration : wrapped;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const m of material) m.dispose();
    } else if (material) {
      material.dispose();
    }
  });
}

export class MotionThreeRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private canvas: MotionThreeCanvas | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private ambient: THREE.AmbientLight | null = null;
  private rimLight: THREE.DirectionalLight | null = null;
  private areaLight: THREE.RectAreaLight | null = null;
  private envCache = new Map<string, THREE.Texture>();
  private envUrlCache = new Map<
    string,
    { readonly env: THREE.Texture; readonly raw: THREE.Texture }
  >();
  private envUrlPending = new Set<string>();
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private gtaoPass: GTAOPass | null = null;
  private bokehPass: BokehPass | null = null;
  private dofFocus = 10;
  private composerSize = { w: 0, h: 0 };
  private composerSamples = -1;
  private toneMappingKey: number | null = null;
  private appliedQualityKey: string | null = null;
  private groundPlane: THREE.Mesh | null = null;
  private modelCache = new Map<string, LoadedModel>();
  private fontCache = new Map<string, Font>();
  private current: {
    sig: string;
    root: THREE.Object3D;
    texture?: THREE.Texture;
    halfW: number;
    halfH: number;
    mixer?: THREE.AnimationMixer;
    animations?: readonly THREE.AnimationClip[];
    activeAnimationKey?: string;
  } | null = null;
  private sceneGraphs = new Map<
    string,
    {
      container: THREE.Group;
      objects: Map<string, AnimatedSceneEntry>;
      roomGroup: THREE.Group | null;
      roomSig: string | null;
    }
  >();
  private unavailable = false;

  isAvailable(): boolean {
    return !this.unavailable;
  }

  private ensure(width: number, height: number): boolean {
    if (this.unavailable) return false;
    const targetWidth = Math.max(1, width);
    const targetHeight = Math.max(1, height);
    if (!this.renderer) {
      try {
        const canvases: MotionThreeCanvas[] = [];
        if (typeof document !== "undefined" && document.createElement) {
          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          canvases.push(canvas);
        }
        if (typeof OffscreenCanvas !== "undefined") {
          canvases.push(new OffscreenCanvas(targetWidth, targetHeight));
        }
        if (canvases.length === 0) {
          this.unavailable = true;
          return false;
        }

        for (const canvas of canvases) {
          try {
            const renderer = new THREE.WebGLRenderer({
              canvas: canvas as HTMLCanvasElement,
              alpha: true,
              antialias: true,
              premultipliedAlpha: true,
              preserveDrawingBuffer: true,
            });
            if (!renderer.getContext()) {
              renderer.dispose();
              continue;
            }
            renderer.setSize(targetWidth, targetHeight, false);
            this.canvas = canvas;
            this.renderer = renderer;
            break;
          } catch {
            // Try the next canvas implementation before giving up.
          }
        }

        if (!this.renderer || !this.canvas) {
          this.unavailable = true;
          return false;
        }
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = resolveMotionToneMapping(
          DEFAULT_MOTION_RENDER_QUALITY.toneMapping,
        );
        this.renderer.toneMappingExposure = 1;
        this.toneMappingKey = this.renderer.toneMapping;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
          35,
          targetWidth / targetHeight,
          0.1,
          100,
        );
        this.ambient = new THREE.AmbientLight(0xffffff, 0.55);
        this.keyLight = new THREE.DirectionalLight(0xfff2e6, 2.1);
        this.keyLight.position.set(-2.5, 3.5, 4);
        this.keyLight.castShadow = true;
        this.keyLight.shadow.mapSize.set(2048, 2048);
        this.keyLight.shadow.bias = -0.0004;
        this.keyLight.shadow.radius = 4;
        this.keyLight.shadow.camera.near = 0.1;
        this.keyLight.shadow.camera.far = 40;
        const shadowCam = this.keyLight.shadow.camera as THREE.OrthographicCamera;
        shadowCam.left = -6;
        shadowCam.right = 6;
        shadowCam.top = 6;
        shadowCam.bottom = -6;
        this.rimLight = new THREE.DirectionalLight(0xbcd2ff, 1.1);
        this.rimLight.position.set(3, -1.5, -3);
        this.scene.add(this.ambient, this.keyLight, this.rimLight);
        this.setupAreaLight();
      } catch {
        this.unavailable = true;
        return false;
      }
    }
    const c = this.canvas!;
    if (c.width !== targetWidth || c.height !== targetHeight) {
      this.renderer!.setSize(targetWidth, targetHeight, false);
      this.camera!.aspect = targetWidth / targetHeight;
      this.camera!.updateProjectionMatrix();
    }
    return true;
  }

  private async buildObjectAsync(
    object: MotionObject3D,
    material: MotionMaterial3D | undefined,
    screenTexture: TexImageSource | null,
    normalizeLoaded = true,
  ): Promise<BuiltThreeObject> {
    if (object.kind === "model" && object.modelUrl) {
      const model = await this.loadModel(object.modelUrl, normalizeLoaded);
      if (model) {
        if (material?.color) {
          model.root.traverse((node) => {
            const mesh = node as THREE.Mesh;
            const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
            if (mesh.isMesh && mat && "color" in mat && material?.color) {
              mat.color = new THREE.Color(material.color);
            }
          });
        }
        return model;
      }
    }
    if (object.kind === "text3d") {
      const built = await this.buildText3D(object, material, normalizeLoaded);
      if (built) return { root: built };
    }
    return buildObject3D(object, material, screenTexture);
  }

  private async loadModel(
    url: string,
    normalize = true,
  ): Promise<BuiltThreeObject | null> {
    const cached = this.modelCache.get(url);
    const source = cached ?? (await this.fetchModel(url));
    if (!source) return null;
    if (!cached) this.modelCache.set(url, source);
    const clone = SkeletonUtils.clone(source.root);
    return {
      root: normalize ? normalizeModel(clone) : clone,
      animations: source.animations,
    };
  }

  private async fetchModel(url: string): Promise<LoadedModel | null> {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      return { root: gltf.scene, animations: gltf.animations };
    } catch {
      return null;
    }
  }

  private async buildText3D(
    object: MotionObject3D,
    material: MotionMaterial3D | undefined,
    normalize = true,
  ): Promise<THREE.Object3D | null> {
    const text = object.text?.trim();
    if (!text) return null;
    const font = await this.loadFont(DEFAULT_TEXT3D_FONT_URL);
    if (!font) return null;
    try {
      const geometry = new TextGeometry(text, {
        font,
        size: 1,
        depth: Math.max(0.01, object.extrude ?? 0.2),
        curveSegments: 8,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.015,
        bevelSegments: 3,
      });
      geometry.center();
      const mesh = new THREE.Mesh(geometry, buildMaterial(material));
      return normalize ? normalizeModel(mesh) : mesh;
    } catch {
      return null;
    }
  }

  private async loadFont(url: string): Promise<Font | null> {
    const cached = this.fontCache.get(url);
    if (cached) return cached;
    try {
      const loader = new FontLoader();
      const font = await loader.loadAsync(url);
      this.fontCache.set(url, font);
      return font;
    } catch {
      return null;
    }
  }

  private setupAreaLight(): void {
    if (!this.scene || this.areaLight) return;
    try {
      RectAreaLightUniformsLib.init();
      const area = new THREE.RectAreaLight(0xffffff, 0, 7, 7);
      area.position.set(-3.2, 5, 4.2);
      area.lookAt(0, 0, 0);
      this.scene.add(area);
      this.areaLight = area;
    } catch {
      this.areaLight = null;
    }
  }

  private resolveEnvironmentTexture(
    descriptor: MotionEnvironmentDescriptor,
  ): THREE.Texture | null {
    if (!this.renderer || descriptor.kind === "none") return null;
    const key =
      descriptor.kind === "room"
        ? "room"
        : `grad:${descriptor.gradient!.zenith}:${descriptor.gradient!.horizon}:${descriptor.gradient!.ground}`;
    const cached = this.envCache.get(key);
    if (cached) return cached;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      let texture: THREE.Texture;
      if (descriptor.kind === "room") {
        const room = new RoomEnvironment();
        texture = pmrem.fromScene(room, 0.04).texture;
        disposeObject(room as unknown as THREE.Object3D);
      } else {
        const gradient = descriptor.gradient!;
        const equirect = buildGradientEquirectTexture(
          gradient.zenith,
          gradient.horizon,
          gradient.ground,
        );
        texture = pmrem.fromEquirectangular(equirect).texture;
        equirect.dispose();
      }
      pmrem.dispose();
      this.envCache.set(key, texture);
      return texture;
    } catch {
      return null;
    }
  }

  private applyEnvironment(
    lighting: MotionScene3DLighting | undefined,
    enabled: boolean,
    baseIntensity: number,
  ): void {
    if (!this.scene) return;
    if (!enabled) {
      this.scene.environment = null;
      this.scene.background = null;
      return;
    }
    const source = resolveEnvironmentSource(lighting, baseIntensity);
    if (source.mode === "none") {
      this.scene.environment = null;
      this.scene.background = null;
      return;
    }

    if (source.mode === "url" && source.url && source.urlKind) {
      const loaded = this.envUrlCache.get(source.url);
      if (loaded) {
        this.scene.environment = loaded.env;
        this.scene.environmentIntensity = source.intensity;
        this.scene.background = source.background ? loaded.raw : null;
        return;
      }
      // Not loaded yet: kick off the async load and show the preset fallback now.
      this.requestUrlEnvironment(source.url, source.urlKind);
    }

    const fallback = this.resolveEnvironmentTexture(source.preset);
    this.scene.environment = fallback;
    if (fallback) this.scene.environmentIntensity = source.intensity;
    this.scene.background = null;
  }

  private requestUrlEnvironment(url: string, kind: MotionEnvironmentUrlKind): void {
    if (!this.renderer || this.envUrlCache.has(url) || this.envUrlPending.has(url)) {
      return;
    }
    this.envUrlPending.add(url);
    const loader =
      kind === "hdr"
        ? new HDRLoader()
        : kind === "exr"
          ? new EXRLoader()
          : new THREE.TextureLoader();
    loader.setCrossOrigin?.("anonymous");
    loader.load(
      url,
      (raw: THREE.Texture) => {
        this.envUrlPending.delete(url);
        if (!this.renderer) {
          raw.dispose();
          return;
        }
        try {
          raw.mapping = THREE.EquirectangularReflectionMapping;
          if (kind === "ldr") raw.colorSpace = THREE.SRGBColorSpace;
          const pmrem = new THREE.PMREMGenerator(this.renderer);
          const env = pmrem.fromEquirectangular(raw).texture;
          pmrem.dispose();
          this.envUrlCache.set(url, { env, raw });
        } catch {
          raw.dispose();
        }
      },
      undefined,
      () => {
        this.envUrlPending.delete(url);
      },
    );
  }

  private applyToneMapping(quality: MotionRenderQuality): void {
    if (!this.renderer) return;
    const mapping = resolveMotionToneMapping(quality.toneMapping);
    if (this.toneMappingKey !== mapping) {
      this.renderer.toneMapping = mapping;
      this.toneMappingKey = mapping;
    }
    this.renderer.toneMappingExposure = quality.exposure ?? 1;
  }

  private syncGround(visible: boolean, halfH: number): void {
    if (!this.scene) return;
    if (visible && !this.groundPlane) {
      this.groundPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        new THREE.ShadowMaterial({ opacity: 0.3 }),
      );
      this.groundPlane.rotation.x = -Math.PI / 2;
      this.groundPlane.receiveShadow = true;
      this.scene.add(this.groundPlane);
    }
    if (this.groundPlane) {
      this.groundPlane.visible = visible;
      this.groundPlane.position.y = -halfH * 1.03;
    }
  }

  private syncModelAnimation(
    entry: {
      root: THREE.Object3D;
      mixer?: THREE.AnimationMixer;
      animations?: readonly THREE.AnimationClip[];
      activeAnimationKey?: string;
    },
    object: MotionObject3D,
    timeSeconds: number,
  ): void {
    const clip = selectModelAnimationClip(entry.animations, object.animation);
    if (!clip) {
      entry.mixer?.stopAllAction();
      delete entry.activeAnimationKey;
      return;
    }
    if (!entry.mixer) {
      entry.mixer = new THREE.AnimationMixer(entry.root);
    }
    const key = modelAnimationKey(object.animation);
    if (entry.activeAnimationKey !== key) {
      entry.mixer.stopAllAction();
      const action = entry.mixer.clipAction(clip);
      action.reset();
      action.enabled = true;
      action.clampWhenFinished = object.animation?.loop === false;
      action.setLoop(
        object.animation?.loop === false ? THREE.LoopOnce : THREE.LoopRepeat,
        object.animation?.loop === false ? 1 : Infinity,
      );
      action.play();
      entry.activeAnimationKey = key;
    }
    entry.mixer.setTime(modelAnimationTime(object.animation, clip, timeSeconds));
  }

  private ensureComposer(
    width: number,
    height: number,
    samples: number,
  ): boolean {
    if (!this.renderer || !this.scene || !this.camera) return false;
    try {
      const safeSamples = Math.max(0, Math.floor(samples));
      if (this.composer && this.composerSamples !== safeSamples) {
        this.composer.dispose();
        this.composer = null;
        this.bloomPass = null;
        this.gtaoPass = null;
        this.bokehPass = null;
      }
      if (!this.composer) {
        // Multisampled HDR target so the post chain keeps antialiased edges and
        // bloom/tonemap work in linear high-dynamic-range (matching EEVEE).
        const renderTarget = new THREE.WebGLRenderTarget(
          Math.max(1, width),
          Math.max(1, height),
          { type: THREE.HalfFloatType, samples: safeSamples },
        );
        const composer = new EffectComposer(this.renderer, renderTarget);
        this.composerSamples = safeSamples;
        composer.addPass(new RenderPass(this.scene, this.camera));
        // Screen-space ambient occlusion — scale-independent contact shadows.
        try {
          const gtao = new GTAOPass(this.scene, this.camera, width, height);
          gtao.output = GTAOPass.OUTPUT.Default;
          gtao.blendIntensity = 0.85;
          gtao.updateGtaoMaterial({
            radius: 0.16,
            distanceExponent: 1,
            thickness: 1,
            scale: 1.1,
            samples: 16,
            distanceFallOff: 1,
            screenSpaceRadius: true,
          });
          composer.addPass(gtao);
          this.gtaoPass = gtao;
        } catch {
          this.gtaoPass = null;
        }
        // Cinematic depth of field.
        try {
          const bokeh = new BokehPass(this.scene, this.camera, {
            focus: this.dofFocus,
            aperture: 0.0016,
            maxblur: 0.01,
          });
          composer.addPass(bokeh);
          this.bokehPass = bokeh;
        } catch {
          this.bokehPass = null;
        }
        const bloom = new UnrealBloomPass(
          new THREE.Vector2(width, height),
          0.34,
          0.4,
          0.86,
        );
        composer.addPass(bloom);
        composer.addPass(new OutputPass());
        this.composer = composer;
        this.bloomPass = bloom;
      }
      if (this.composerSize.w !== width || this.composerSize.h !== height) {
        this.composer.setSize(width, height);
        this.gtaoPass?.setSize(width, height);
        this.composerSize = { w: width, h: height };
      }
      return true;
    } catch {
      this.composer = null;
      this.bloomPass = null;
      this.gtaoPass = null;
      this.bokehPass = null;
      return false;
    }
  }

  /** Final present: post-processed (bloom/AO/DOF) when enabled, else direct. */
  private present(quality: MotionRenderQuality | undefined): void {
    const q = mergeMotionRenderQuality(quality);
    this.applyToneMapping(q);
    const width = this.canvas?.width ?? 1;
    const height = this.canvas?.height ?? 1;
    if (q.postProcessing && this.ensureComposer(width, height, q.antialiasSamples ?? 4)) {
      if (this.bloomPass) {
        this.bloomPass.enabled = true;
        this.bloomPass.strength =
          q.bloomStrength ?? DEFAULT_MOTION_RENDER_QUALITY.bloomStrength ?? 0.34;
      }
      if (this.gtaoPass) this.gtaoPass.enabled = q.ambientOcclusion ?? true;
      if (this.bokehPass) {
        this.bokehPass.enabled = q.depthOfField ?? false;
        const u = (this.bokehPass as unknown as {
          uniforms: { focus: { value: number }; aperture: { value: number } };
        }).uniforms;
        u.focus.value = this.dofFocus;
        u.aperture.value =
          q.dofAperture ?? DEFAULT_MOTION_RENDER_QUALITY.dofAperture ?? 0.0016;
      }
      this.composer!.render();
    } else {
      this.renderer!.render(this.scene!, this.camera!);
    }
  }

  async render(input: MotionThreeRenderInput): Promise<MotionThreeCanvas | null> {
    if (!this.ensure(input.width, input.height)) return null;
    this.applyRenderQuality(input.quality ?? DEFAULT_MOTION_RENDER_QUALITY);
    if (input.scene) {
      return this.renderSceneMode(input, input.scene);
    }
    const { layer, rotation } = input;
    // Leaving scene mode: hide every cached scene graph (kept alive for reuse) and
    // restore the legacy single-object light rig so it can't bleed in.
    if (this.sceneGraphs.size > 0) {
      for (const [, graph] of this.sceneGraphs) graph.container.visible = false;
      this.resetLegacyRig();
    }
    const sig = JSON.stringify({
      id: layer.id,
      object: layer.object,
      material: layer.material,
      tex: !!input.screenTexture,
    });
    if (!this.current || this.current.sig !== sig) {
      if (this.current) {
        this.current.mixer?.stopAllAction();
        this.scene!.remove(this.current.root);
        disposeObject(this.current.root);
        this.current.texture?.dispose();
      }
      const built = await this.buildObjectAsync(
        layer.object,
        layer.material,
        input.screenTexture ?? null,
      );
      built.root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      built.root.rotation.set(0, 0, 0);
      const box = new THREE.Box3().setFromObject(built.root);
      const size = box.getSize(new THREE.Vector3());
      this.scene!.add(built.root);
      this.current = {
        sig,
        root: built.root,
        texture: built.texture,
        halfW: Math.max(0.01, size.x / 2),
        halfH: Math.max(0.01, size.y / 2),
        ...(built.animations?.length ? { animations: built.animations } : {}),
      };
    }
    const quality = mergeMotionRenderQuality(input.quality);
    applyLighting(
      this.ambient!,
      this.keyLight!,
      this.rimLight!,
      this.areaLight,
      layer.lighting,
      quality.softLighting ?? true,
    );
    this.applyEnvironment(
      layer.lighting,
      quality.environment,
      quality.environmentIntensity ?? DEFAULT_ENVIRONMENT_INTENSITY,
    );
    this.syncGround(layer.lighting?.groundShadow === true, this.current.halfH);
    const root = this.current.root;
    root.visible = true;
    this.syncModelAnimation(this.current, layer.object, input.timeSeconds ?? 0);
    root.rotation.set(rotation.x * DEG, rotation.y * DEG, rotation.z * DEG);

    // Auto-frame: pull the camera back so the object (at any rotation) always fits,
    // then apply the user's cameraDistance and the keyframeable dolly zoom.
    const fov = layer.fov ?? 30;
    this.camera!.fov = fov;
    const aspect = input.width / Math.max(1, input.height);
    const vTan = Math.tan((fov / 2) * DEG);
    const fitH = this.current.halfH / vTan;
    const fitW = this.current.halfW / (vTan * aspect);
    const zoomFactor = Math.pow(2, -(input.cameraZoom ?? 0));
    const distance =
      Math.max(fitH, fitW) * 1.12 * (layer.cameraDistance ?? 1) * Math.max(0.05, zoomFactor);
    this.camera!.position.set(0, 0, distance);
    this.camera!.far = Math.max(100, distance * 3 + 50);
    this.camera!.lookAt(0, 0, 0);
    this.camera!.updateProjectionMatrix();

    this.dofFocus = Math.max(0.1, distance);
    this.present(input.quality);
    return this.canvas;
  }

  private async renderSceneMode(
    input: MotionThreeRenderInput,
    scene: MotionThreeSceneInput,
  ): Promise<MotionThreeCanvas | null> {
    const layer = input.layer;
    // Hide the legacy hero + every OTHER layer's cached scene graph. Graphs are kept
    // alive per-layer so two scene3d layers don't dispose+rebuild each other per frame.
    if (this.current) this.current.root.visible = false;
    for (const [id, graph] of this.sceneGraphs) {
      if (id !== layer.id) graph.container.visible = false;
    }
    let graph = this.sceneGraphs.get(layer.id);
    if (!graph) {
      const container = new THREE.Group();
      this.scene!.add(container);
      graph = { container, objects: new Map(), roomGroup: null, roomSig: null };
      this.sceneGraphs.set(layer.id, graph);
    }
    graph.container.visible = true;

    const sceneQuality = mergeMotionRenderQuality(input.quality);
    applyLighting(
      this.ambient!,
      this.keyLight!,
      this.rimLight!,
      this.areaLight,
      layer.lighting,
      sceneQuality.softLighting ?? true,
    );
    this.applyEnvironment(
      layer.lighting,
      sceneQuality.environment,
      sceneQuality.environmentIntensity ?? DEFAULT_ENVIRONMENT_INTENSITY,
    );

    // Diff: drop objects that no longer exist.
    const incomingIds = new Set(scene.objects.map((entry) => entry.id));
    for (const [id, entry] of graph.objects) {
      if (!incomingIds.has(id)) {
        graph.container.remove(entry.root);
        this.disposeSceneEntry(entry);
        graph.objects.delete(id);
      }
    }

    // Build new / structurally-changed objects (parallel, fault-tolerant).
    await Promise.allSettled(
      scene.objects.map(async (obj) => {
        const sig = sceneObjectStructuralSig(obj);
        const existing = graph!.objects.get(obj.id);
        if (existing && existing.sig === sig) return;
        if (existing) {
          graph!.container.remove(existing.root);
          this.disposeSceneEntry(existing);
          graph!.objects.delete(obj.id);
        }
        const built = await this.buildSceneObjectAsync(obj);
        const castsShadow = obj.object.kind !== "room";
        built.root.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = castsShadow;
            mesh.receiveShadow = true;
          }
        });
        graph!.container.add(built.root);
        graph!.objects.set(obj.id, { sig, ...built });
      }),
    );

    // Per-frame: apply the already-sampled transforms, opacity, and lid angle.
    for (const obj of scene.objects) {
      const entry = graph.objects.get(obj.id);
      if (!entry) continue;
      this.syncModelAnimation(entry, obj.object, input.timeSeconds ?? 0);
      entry.root.position.set(obj.position.x, obj.position.y, obj.position.z);
      entry.root.rotation.set(
        obj.rotation.x * DEG,
        obj.rotation.y * DEG,
        obj.rotation.z * DEG,
      );
      entry.root.scale.set(
        obj.scale.x || 0.0001,
        obj.scale.y || 0.0001,
        obj.scale.z || 0.0001,
      );
      if (entry.lidPivot) entry.lidPivot.rotation.x = -obj.lidAngle * DEG;
      const opacity = clamp01(obj.opacity);
      const isTransparent = opacity < 1;
      for (const material of entry.materials) {
        if (
          material instanceof THREE.MeshPhysicalMaterial &&
          material.transmission > 0
        ) {
          material.opacity = 1;
          continue;
        }
        if (material.transparent !== isTransparent) {
          material.transparent = isTransparent;
          material.depthWrite = !isTransparent;
          material.needsUpdate = true;
        }
        material.opacity = opacity;
      }
    }

    this.syncRoom(graph, scene.room);
    this.sizeSceneShadow(scene);

    // Explicit cinematic camera — no auto-frame, no position.z dolly.
    const cam = scene.camera;
    this.camera!.fov = cam.fov;
    this.camera!.position.set(cam.position.x, cam.position.y, cam.position.z);
    this.camera!.near = cam.near ?? 0.1;
    const dist = Math.hypot(
      cam.position.x - cam.target.x,
      cam.position.y - cam.target.y,
      cam.position.z - cam.target.z,
    );
    this.camera!.far = cam.far ?? Math.max(100, dist * 4 + 60);
    this.camera!.lookAt(cam.target.x, cam.target.y, cam.target.z);
    this.camera!.updateProjectionMatrix();

    this.dofFocus = Math.max(0.1, dist);
    this.present(input.quality);
    return this.canvas;
  }

  private async buildSceneObjectAsync(
    obj: MotionThreeSceneObjectInput,
  ): Promise<{
    root: THREE.Object3D;
    lidPivot?: THREE.Object3D;
    materials: THREE.Material[];
    textures: THREE.Texture[];
    animations?: readonly THREE.AnimationClip[];
  }> {
    const built = await this.buildObjectAsync(
      obj.object,
      obj.material,
      obj.texture ?? null,
    );
    const root = built.root;
    const lidPivot = root.getObjectByName("lidPivot") ?? undefined;
    const materials = collectMaterials(root);
    const textures: THREE.Texture[] = [];
    if (built.texture) textures.push(built.texture);
    applyDetailMaps(materials, obj, textures);
    for (const material of materials) {
      const map = (material as THREE.MeshStandardMaterial).map;
      if (map && (map as THREE.CanvasTexture).isCanvasTexture) textures.push(map);
    }
    return {
      root,
      lidPivot,
      materials,
      textures,
      ...(built.animations?.length ? { animations: built.animations } : {}),
    };
  }

  private syncRoom(
    graph: {
      container: THREE.Group;
      roomGroup: THREE.Group | null;
      roomSig: string | null;
    },
    room: MotionScene3DRoom | undefined,
  ): void {
    if (room?.enabled !== true) {
      if (graph.roomGroup) graph.roomGroup.visible = false;
      return;
    }
    const size = room.size ?? 14;
    const wallColor = room.wallColor ?? "#2a2d34";
    const floorColor = room.floorColor ?? "#191b1f";
    const sig = `${size}|${wallColor}|${floorColor}`;
    if (graph.roomGroup && graph.roomSig !== sig) {
      graph.container.remove(graph.roomGroup);
      disposeObject(graph.roomGroup);
      graph.roomGroup = null;
    }
    if (!graph.roomGroup) {
      graph.roomGroup = buildRoom(size, wallColor, floorColor);
      graph.roomSig = sig;
      graph.container.add(graph.roomGroup);
    }
    graph.roomGroup.visible = true;
  }

  private applyRenderQuality(quality: MotionRenderQuality): void {
    const key = `${quality.shadows}:${quality.shadowMapSize}`;
    if (key === this.appliedQualityKey) return;
    this.appliedQualityKey = key;
    if (!this.renderer || !this.keyLight) return;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.keyLight.castShadow = quality.shadows;
    if (quality.shadows) {
      this.keyLight.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  private resetLegacyRig(): void {
    if (this.keyLight) {
      this.keyLight.position.set(-2.5, 3.5, 4);
      const shadowCam = this.keyLight.shadow.camera as THREE.OrthographicCamera;
      shadowCam.left = -6;
      shadowCam.right = 6;
      shadowCam.top = 6;
      shadowCam.bottom = -6;
      shadowCam.near = 0.1;
      shadowCam.far = 40;
      shadowCam.updateProjectionMatrix();
    }
    if (this.camera) this.camera.near = 0.1;
  }

  private sizeSceneShadow(scene: MotionThreeSceneInput): void {
    if (!this.keyLight) return;
    let radius = 6;
    if (scene.room?.enabled) radius = Math.max(radius, (scene.room.size ?? 14) * 0.6);
    for (const obj of scene.objects) {
      radius = Math.max(
        radius,
        Math.abs(obj.position.x) + 2,
        Math.abs(obj.position.y) + 2,
        Math.abs(obj.position.z) + 2,
      );
    }
    this.keyLight.position.set(-radius * 0.5, radius * 1.2, radius * 0.6);
    const shadowCam = this.keyLight.shadow.camera as THREE.OrthographicCamera;
    shadowCam.left = -radius;
    shadowCam.right = radius;
    shadowCam.top = radius;
    shadowCam.bottom = -radius;
    shadowCam.near = 0.1;
    shadowCam.far = radius * 6;
    shadowCam.updateProjectionMatrix();
    if (this.areaLight) {
      const span = Math.max(4, radius * 1.4);
      this.areaLight.width = span;
      this.areaLight.height = span;
      this.areaLight.position.set(-radius * 0.55, radius * 1.1, radius * 0.7);
      this.areaLight.lookAt(0, 0, 0);
    }
  }

  private disposeSceneEntry(entry: {
    root: THREE.Object3D;
    textures: THREE.Texture[];
    mixer?: THREE.AnimationMixer;
  }): void {
    entry.mixer?.stopAllAction();
    disposeObject(entry.root);
    for (const texture of entry.textures) texture.dispose();
  }

  private disposeSceneGraph(): void {
    for (const [, graph] of this.sceneGraphs) {
      for (const [, entry] of graph.objects) this.disposeSceneEntry(entry);
      if (graph.roomGroup) disposeObject(graph.roomGroup);
      this.scene?.remove(graph.container);
    }
    this.sceneGraphs.clear();
    this.resetLegacyRig();
  }

  dispose(): void {
    if (this.current) {
      this.current.mixer?.stopAllAction();
      disposeObject(this.current.root);
      this.current.texture?.dispose();
      this.current = null;
    }
    this.disposeSceneGraph();
    for (const texture of this.envCache.values()) texture.dispose();
    this.envCache.clear();
    for (const entry of this.envUrlCache.values()) {
      entry.env.dispose();
      entry.raw.dispose();
    }
    this.envUrlCache.clear();
    this.envUrlPending.clear();
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (this.groundPlane) {
      this.scene?.remove(this.groundPlane);
      disposeObject(this.groundPlane);
      this.groundPlane = null;
    }
    for (const model of this.modelCache.values()) disposeObject(model.root);
    this.modelCache.clear();
    this.fontCache.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
    this.scene = null;
  }
}

function applyLighting(
  ambient: THREE.AmbientLight,
  key: THREE.DirectionalLight,
  rim: THREE.DirectionalLight,
  area: THREE.RectAreaLight | null,
  lighting: MotionScene3DLighting | undefined,
  softLighting: boolean,
): void {
  ambient.intensity = lighting?.ambient ?? 0.55;
  const keyIntensity = lighting?.keyIntensity ?? 2.1;
  key.intensity = keyIntensity;
  if (lighting?.keyColor) key.color.set(lighting.keyColor);
  rim.intensity = lighting?.rimIntensity ?? 1.1;
  if (area) {
    area.intensity = softLighting
      ? Math.min(12, Math.max(1.5, keyIntensity * 1.6))
      : 0;
    if (lighting?.keyColor) area.color.set(lighting.keyColor);
    area.lookAt(0, 0, 0);
  }
}

/** sRGB-encoded equirectangular sky: zenith → horizon → ground vertical ramp. */
function buildGradientEquirectTexture(
  zenith: string,
  horizon: string,
  ground: string,
  height = 256,
): THREE.DataTexture {
  const width = height * 2;
  const data = new Uint8Array(width * height * 4);
  const top = new THREE.Color(zenith);
  const mid = new THREE.Color(horizon);
  const bottom = new THREE.Color(ground);
  const sampled = new THREE.Color();
  for (let y = 0; y < height; y += 1) {
    const v = height === 1 ? 0 : y / (height - 1);
    if (v < 0.5) sampled.copy(top).lerp(mid, v / 0.5);
    else sampled.copy(mid).lerp(bottom, (v - 0.5) / 0.5);
    sampled.convertLinearToSRGB();
    const r = Math.round(clamp01(sampled.r) * 255);
    const g = Math.round(clamp01(sampled.g) * 255);
    const b = Math.round(clamp01(sampled.b) * 255);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

function buildMaterial(material: MotionMaterial3D | undefined): THREE.Material {
  const color = new THREE.Color(material?.color ?? "#D9622B");
  if ((material?.kind ?? "physical") === "basic") {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: (material?.opacity ?? 1) < 1,
      opacity: material?.opacity ?? 1,
    });
  }
  const opacity = material?.opacity ?? 1;
  const transmission = Math.max(0, Math.min(1, material?.transmission ?? 0));
  const clearcoat = Math.max(0, Math.min(1, material?.clearcoat ?? 0));
  const needsPhysical = transmission > 0 || clearcoat > 0;
  const std = needsPhysical
    ? new THREE.MeshPhysicalMaterial({
        color,
        metalness: material?.metalness ?? 0.6,
        roughness: material?.roughness ?? 0.35,
        transmission,
        ior: material?.ior ?? 1.5,
        thickness: transmission > 0 ? 0.5 : 0,
        clearcoat,
        clearcoatRoughness: material?.clearcoatRoughness ?? 0.1,
        transparent: opacity < 1 || transmission > 0,
        opacity: transmission > 0 ? 1 : opacity,
      })
    : new THREE.MeshStandardMaterial({
        color,
        metalness: material?.metalness ?? 0.6,
        roughness: material?.roughness ?? 0.35,
        transparent: opacity < 1,
        opacity,
      });
  if (material?.emissive) {
    std.emissive = new THREE.Color(material.emissive);
    std.emissiveIntensity = material.emissiveIntensity ?? 1;
  }
  return std;
}

function makeWallMaterial(color: THREE.ColorRepresentation): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
  });
}

function buildRoom(
  size: number,
  wallColor: string,
  floorColor: string,
): THREE.Group {
  const half = size / 2;
  const group = new THREE.Group();
  const plane = (): THREE.PlaneGeometry => new THREE.PlaneGeometry(size, size);

  const floor = new THREE.Mesh(plane(), makeWallMaterial(floorColor));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -half;
  floor.receiveShadow = true;
  group.add(floor);

  const ceiling = new THREE.Mesh(plane(), makeWallMaterial(wallColor));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = half;
  group.add(ceiling);

  const back = new THREE.Mesh(plane(), makeWallMaterial(wallColor));
  back.position.z = -half;
  back.receiveShadow = true;
  group.add(back);

  const left = new THREE.Mesh(plane(), makeWallMaterial(wallColor));
  left.rotation.y = Math.PI / 2;
  left.position.x = -half;
  left.receiveShadow = true;
  group.add(left);

  const right = new THREE.Mesh(plane(), makeWallMaterial(wallColor));
  right.rotation.y = -Math.PI / 2;
  right.position.x = half;
  right.receiveShadow = true;
  group.add(right);

  return group;
}

function buildRoomObject(
  object: MotionObject3D,
  material: MotionMaterial3D | undefined,
): { root: THREE.Object3D } {
  const size = (object.size ?? 8) * 1.6;
  return { root: buildRoom(size, material?.color ?? "#2a2d34", "#191b1f") };
}

function buildOpenBox(
  object: MotionObject3D,
  material: MotionMaterial3D | undefined,
): { root: THREE.Object3D } {
  const s = (object.size ?? 1) * 1.6;
  const width = s;
  const height = s * (object.aspect ?? 0.85);
  const depth = s;
  const wall = Math.max(0.04, s * 0.05);
  const color = material?.color ?? "#8a5a2b";
  const metalness = material?.metalness ?? 0.1;
  const roughness = material?.roughness ?? 0.78;
  const mat = (): THREE.Material =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      metalness,
      roughness,
    });

  const group = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(width, wall, depth), mat());
  floor.position.y = -height / 2;
  group.add(floor);
  const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, wall), mat());
  back.position.z = -depth / 2;
  group.add(back);
  const front = new THREE.Mesh(new THREE.BoxGeometry(width, height, wall), mat());
  front.position.z = depth / 2;
  group.add(front);
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wall, height, depth), mat());
  leftWall.position.x = -width / 2;
  group.add(leftWall);
  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(wall, height, depth), mat());
  rightWall.position.x = width / 2;
  group.add(rightWall);

  // Lid hinged at the back-top edge; lidPivot.rotation.x opens it.
  const lidPivot = new THREE.Group();
  lidPivot.name = "lidPivot";
  lidPivot.position.set(0, height / 2, -depth / 2);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(width, wall, depth), mat());
  lid.position.set(0, 0, depth / 2);
  lidPivot.add(lid);
  group.add(lidPivot);

  return { root: group };
}

function drawPentagon(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 5; i += 1) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function buildSoccerTexture(
  labels: readonly string[] | string | undefined,
): THREE.Texture {
  const width = 1024;
  const height = 512;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = "#f5f5f4";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#15171c";
  const cols = 6;
  const rows = 3;
  const cell = Math.min(width / cols, height / rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = (col + (row % 2 ? 0.5 : 0)) * (width / cols);
      const y = (row + 0.5) * (height / rows);
      drawPentagon(ctx, x, y, cell * 0.3);
    }
  }
  const texts = Array.isArray(labels)
    ? labels
    : typeof labels === "string"
      ? [labels]
      : [];
  if (texts.length) {
    ctx.fillStyle = "#c8102e";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const band = height / (texts.length + 1);
    texts.forEach((label, index) => {
      ctx.font = `bold ${Math.round(72 - texts.length * 6)}px sans-serif`;
      ctx.fillText(label, width / 2, band * (index + 1));
    });
  }
  const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function buildSoccerBall(
  object: MotionObject3D,
  material: MotionMaterial3D | undefined,
): { root: THREE.Object3D; texture?: THREE.Texture } {
  const radius = (object.size ?? 1) * 0.95;
  const texture = buildSoccerTexture(object.panelTexts ?? object.text);
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    metalness: material?.metalness ?? 0.05,
    roughness: material?.roughness ?? 0.5,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), mat);
  return { root: mesh, texture };
}

export function sampleMotionObjectMeshFrame(
  object: MotionObject3D,
  timeSeconds: number,
): MotionObject3D {
  const frames = object.meshFrames;
  if (!frames || frames.frames.length === 0 || frames.fps <= 0) return object;
  const count = frames.frames.length;
  const raw = Math.floor(timeSeconds * frames.fps);
  const index = frames.loop
    ? ((raw % count) + count) % count
    : Math.max(0, Math.min(count - 1, raw));
  const positions = frames.frames[index] ?? frames.frames[count - 1]!;
  if (positions.length < 9 || frames.indices.length < 3) return object;
  const { meshFrames: _meshFrames, ...rest } = object;
  return {
    ...rest,
    mesh: { positions, indices: frames.indices, uvs: frames.uvs, preScaled: true },
  };
}

function buildBufferGeometryFromMesh(
  object: MotionObject3D,
): THREE.BufferGeometry | null {
  const mesh = object.mesh;
  if (!mesh || mesh.positions.length < 9 || mesh.indices.length < 3) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(Float32Array.from(mesh.positions), 3),
  );
  const vertexCount = mesh.positions.length / 3;
  if (mesh.uvs && mesh.uvs.length === vertexCount * 2) {
    geometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(Float32Array.from(mesh.uvs), 2),
    );
  }
  geometry.setIndex(Array.from(mesh.indices));
  if (mesh.normals && mesh.normals.length === mesh.positions.length) {
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(Float32Array.from(mesh.normals), 3),
    );
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box && !mesh.preScaled) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    const extent = new THREE.Vector3();
    box.getSize(extent);
    const maxDim = Math.max(extent.x, extent.y, extent.z) || 1;
    const referenceDim = extent.x > maxDim * 0.05 ? extent.x : maxDim;
    const target = (object.size ?? 1) * 1.6;
    const scale = target / referenceDim;
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(scale, scale, scale);
  }
  return geometry;
}

function buildGeometry(object: MotionObject3D): THREE.BufferGeometry {
  const baked = buildBufferGeometryFromMesh(object);
  if (baked) return baked;
  const s = (object.size ?? 1) * 1.6;
  const depth = (object.depth ?? 1) * s;
  const aspect = object.aspect ?? 1;
  switch (object.kind) {
    case "box":
      return new THREE.BoxGeometry(s, s * aspect, depth);
    case "rounded-box":
      return new RoundedBoxGeometry(s, s * aspect, depth, 6, object.cornerRadius ?? s * 0.12);
    case "sphere":
      return new THREE.SphereGeometry(s * 0.6, 48, 48);
    case "cylinder":
      return new THREE.CylinderGeometry(s * 0.5, s * 0.5, s * aspect, 48);
    case "cone":
      return new THREE.ConeGeometry(s * 0.55, s * aspect, 48);
    case "torus":
      return new THREE.TorusGeometry(s * 0.5, s * 0.18, 24, 64);
    case "icosahedron":
      return new THREE.IcosahedronGeometry(s * 0.6, 0);
    case "plane":
      return new THREE.PlaneGeometry(s, s * aspect);
    default:
      return new THREE.BoxGeometry(s, s * aspect, depth);
  }
}

function buildObject3D(
  object: MotionObject3D,
  material: MotionMaterial3D | undefined,
  screenTexture: TexImageSource | null,
): { root: THREE.Object3D; texture?: THREE.Texture } {
  if (!object.mesh) {
    if (object.kind === "phone") {
      return buildPhone(object, material, screenTexture);
    }
    if (object.kind === "soccer-ball") {
      return buildSoccerBall(object, material);
    }
    if (object.kind === "open-box") {
      return buildOpenBox(object, material);
    }
    if (object.kind === "room") {
      return buildRoomObject(object, material);
    }
  }
  const geometry = buildGeometry(object);
  const builtMaterial = buildMaterial(material);
  let texture: THREE.Texture | undefined;
  if (screenTexture) {
    texture = buildImageTexture(screenTexture);
    applyTextureToMaterial(builtMaterial, texture);
  }
  const mesh = new THREE.Mesh(geometry, builtMaterial);
  return { root: mesh, texture };
}

function buildImageTexture(source: TexImageSource): THREE.Texture {
  const texture = new THREE.Texture(source as unknown as HTMLImageElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function applyTextureToMaterial(
  material: THREE.Material,
  texture: THREE.Texture,
): void {
  if (
    material instanceof THREE.MeshBasicMaterial ||
    material instanceof THREE.MeshStandardMaterial
  ) {
    material.map = texture;
    material.side = THREE.DoubleSide;
    material.needsUpdate = true;
  }
}

function makeDataTexture(source: TexImageSource): THREE.Texture {
  const texture = new THREE.Texture(source as unknown as HTMLImageElement);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function applyDetailMaps(
  materials: readonly THREE.Material[],
  obj: MotionThreeSceneObjectInput,
  sink: THREE.Texture[],
): void {
  const normal = obj.normalTexture ?? null;
  const roughness = obj.roughnessTexture ?? null;
  const metalness = obj.metalnessTexture ?? null;
  if (!normal && !roughness && !metalness) return;
  for (const material of materials) {
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    if (normal) {
      material.normalMap = makeDataTexture(normal);
      sink.push(material.normalMap);
    }
    if (roughness) {
      material.roughnessMap = makeDataTexture(roughness);
      sink.push(material.roughnessMap);
    }
    if (metalness) {
      material.metalnessMap = makeDataTexture(metalness);
      sink.push(material.metalnessMap);
    }
    material.needsUpdate = true;
  }
}

function buildPhone(
  object: MotionObject3D,
  material: MotionMaterial3D | undefined,
  screenTexture: TexImageSource | null,
): { root: THREE.Object3D; texture?: THREE.Texture } {
  const group = new THREE.Group();
  const W = 1.55;
  const H = W * (object.aspect ?? 2.0);
  const D = W * (object.depth ?? 0.13);
  const radius = object.cornerRadius ?? W * 0.16;

  // Titanium/aluminum body
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(W, H, D, 6, radius),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(material?.color ?? "#D9622B"),
      metalness: material?.metalness ?? 0.85,
      roughness: material?.roughness ?? 0.32,
    }),
  );
  group.add(body);

  // Front screen
  const screenMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#0a0a0c"),
    metalness: 0.1,
    roughness: 0.25,
  });
  let texture: THREE.Texture | undefined;
  if (screenTexture) {
    texture = buildImageTexture(screenTexture);
    screenMat.map = texture;
    screenMat.emissive = new THREE.Color("#ffffff");
    screenMat.emissiveMap = texture;
    screenMat.emissiveIntensity = 0.55;
  }
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(W - radius * 0.7, H - radius * 0.7),
    screenMat,
  );
  screen.position.set(0, 0, D / 2 + 0.001);
  group.add(screen);

  // Dynamic island
  const island = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.045, 0.13, 4, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  island.rotation.z = Math.PI / 2;
  island.position.set(0, H / 2 - radius - 0.12, D / 2 + 0.01);
  group.add(island);

  // Back camera plateau + lenses
  const plateau = new THREE.Mesh(
    new RoundedBoxGeometry(W * 0.62, H * 0.2, 0.06, 4, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.5, roughness: 0.5 }),
  );
  plateau.position.set(-W * 0.13, H * 0.3, -D / 2 - 0.03);
  group.add(plateau);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x05060a, metalness: 0.9, roughness: 0.15 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x3a3c44, metalness: 0.95, roughness: 0.25 });
  const lensPos: Array<[number, number]> = [
    [-W * 0.21, H * 0.36],
    [-W * 0.05, H * 0.36],
    [-W * 0.13, H * 0.24],
  ];
  for (const [lx, ly] of lensPos) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 32), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(lx, ly, -D / 2 - 0.05);
    group.add(ring);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.07, 32), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(lx, ly, -D / 2 - 0.055);
    group.add(lens);
  }
  return { root: group, texture };
}
