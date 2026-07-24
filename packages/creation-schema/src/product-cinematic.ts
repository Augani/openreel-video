import { offsetTransform, transform3d, vec3 } from "./primitives";
import type {
  AnimationClip,
  AssetOutput,
  AssetRecipe,
  Callout,
  CreationCamera,
  CreationScene,
  MaterialRecipe,
  ProductPart,
  ProductPartRole,
  RecipeNode,
  Transform3D,
} from "./types";

export interface ProductCinematicSpec {
  readonly id?: string;
  readonly name?: string;
  readonly productKind?: "phone" | "watch" | "laptop" | "headphones" | "custom";
  readonly style?: string;
  readonly duration?: number;
  readonly frameRate?: number;
  readonly seed?: number;
  readonly includeInternals?: boolean;
  readonly includeCallouts?: boolean;
}

const material = (
  id: string,
  name: string,
  kind: MaterialRecipe["kind"],
  baseColor: string,
  extras: Omit<MaterialRecipe, "id" | "name" | "kind" | "baseColor"> = {},
): MaterialRecipe => ({ id, name, kind, baseColor, ...extras });

const node = (
  id: string,
  name: string,
  role: ProductPartRole,
  parameters: Record<string, unknown>,
): RecipeNode => ({
  id,
  name,
  type: "product-part",
  parameters: { role, ...parameters },
});

function part(
  id: string,
  name: string,
  role: ProductPartRole,
  materialId: string,
  baseTransform: Transform3D,
  explode: { x?: number; y?: number; z?: number },
): ProductPart {
  return {
    id,
    name,
    role,
    materialId,
    nodeId: `node-${id}`,
    transform: baseTransform,
    explodedTransform: offsetTransform(
      baseTransform,
      vec3(explode.x ?? 0, explode.y ?? 0, explode.z ?? 0),
    ),
    calloutAnchor: baseTransform.position,
    visible: true,
  };
}

function buildPhoneMaterials(): MaterialRecipe[] {
  return [
    material("mat-titanium", "Brushed titanium", "metal", "#b8b0a4", {
      metallic: 1,
      roughness: 0.32,
      procedural: ["anisotropic-brush", "soft-edge-wear"],
    }),
    material("mat-glass", "Layered ceramic glass", "glass", "#d8f1ff", {
      roughness: 0.04,
      transmission: 0.72,
      clearcoat: 1,
      opacity: 0.62,
    }),
    material("mat-oled", "OLED display", "screen", "#05070d", {
      emissive: "#6ea8ff",
      emissiveIntensity: 0.18,
      roughness: 0.18,
    }),
    material("mat-graphite", "Graphite thermal sheet", "plastic", "#171a1f", {
      roughness: 0.56,
      procedural: ["fine-carbon-grain"],
    }),
    material("mat-board", "Layered logic board", "pbr", "#12352c", {
      roughness: 0.42,
      procedural: ["copper-traces", "micro-components"],
    }),
    material("mat-chip", "Silicon package", "pbr", "#202735", {
      metallic: 0.15,
      roughness: 0.28,
      procedural: ["etched-label", "beveled-package"],
    }),
    material("mat-battery", "Battery cell", "plastic", "#202329", {
      roughness: 0.48,
      procedural: ["soft-wrapper-lines"],
    }),
    material("mat-lens", "Sapphire camera lens", "glass", "#101827", {
      roughness: 0.02,
      transmission: 0.86,
      clearcoat: 1,
    }),
    material("mat-copper", "Copper connector", "metal", "#c07636", {
      metallic: 1,
      roughness: 0.24,
    }),
  ];
}

function buildPhoneParts(includeInternals: boolean): ProductPart[] {
  const parts: ProductPart[] = [
    part("part-frame", "Titanium frame", "shell", "mat-titanium", transform3d(vec3(0, 0, 0)), { z: -1.2 }),
    part("part-screen-glass", "Ceramic shield glass", "screen", "mat-glass", transform3d(vec3(0, 0.03, 0.18), vec3(), vec3(0.96, 1, 1)), { z: 1.35 }),
    part("part-display", "OLED display layer", "screen", "mat-oled", transform3d(vec3(0, 0.02, 0.1), vec3(), vec3(0.92, 1, 1)), { z: 1.1 }),
    part("part-back-plate", "Back glass plate", "shell", "mat-glass", transform3d(vec3(0, -0.04, -0.16), vec3(), vec3(0.98, 1, 1)), { z: -1.8 }),
    part("part-camera-island", "Camera island", "camera-module", "mat-titanium", transform3d(vec3(-0.46, 0.48, -0.24), vec3(), vec3(0.34, 0.34, 0.16)), { x: -0.55, z: -1.15 }),
    part("part-main-lens", "Main camera lens", "lens", "mat-lens", transform3d(vec3(-0.55, 0.58, -0.34), vec3(), vec3(0.14, 0.14, 0.08)), { x: -0.65, z: -1.28 }),
    part("part-wide-lens", "Wide camera lens", "lens", "mat-lens", transform3d(vec3(-0.36, 0.58, -0.34), vec3(), vec3(0.12, 0.12, 0.08)), { x: -0.5, z: -1.28 }),
    part("part-tele-lens", "Telephoto camera lens", "lens", "mat-lens", transform3d(vec3(-0.46, 0.38, -0.34), vec3(), vec3(0.12, 0.12, 0.08)), { x: -0.56, z: -1.28 }),
  ];

  if (!includeInternals) return parts;

  return [
    ...parts,
    part("part-logic-board", "Logic board", "board", "mat-board", transform3d(vec3(0.12, 0.32, -0.02), vec3(), vec3(0.42, 0.52, 0.05)), { x: 0.62, z: 0.65 }),
    part("part-a-chip", "Pro chip package", "chip", "mat-chip", transform3d(vec3(0.12, 0.44, 0.03), vec3(), vec3(0.18, 0.18, 0.04)), { x: 0.72, z: 0.84 }),
    part("part-battery", "Stacked battery cell", "battery", "mat-battery", transform3d(vec3(-0.08, -0.28, -0.02), vec3(), vec3(0.52, 0.72, 0.08)), { y: -0.35, z: 0.75 }),
    part("part-thermal", "Graphite cooling layer", "thermal", "mat-graphite", transform3d(vec3(0.08, 0.02, 0.06), vec3(), vec3(0.72, 0.92, 0.025)), { z: 0.48 }),
    part("part-flex", "Copper flex connector", "connector", "mat-copper", transform3d(vec3(0.02, 0.16, 0.09), vec3(), vec3(0.62, 0.05, 0.02)), { x: 0.3, z: 0.74 }),
  ];
}

function buildNodes(parts: readonly ProductPart[]): RecipeNode[] {
  return parts.map((productPart) =>
    node(productPart.nodeId, productPart.name, productPart.role, {
      productPartId: productPart.id,
      transform: productPart.transform,
      explodedTransform: productPart.explodedTransform,
    }),
  );
}

function buildOutputs(parts: readonly ProductPart[]): AssetOutput[] {
  return [
    { id: "out-preview-phone", kind: "preview-mesh", nodeId: parts[0]?.nodeId ?? "node-part-frame" },
    { id: "out-final-phone", kind: "final-mesh", nodeId: parts[0]?.nodeId ?? "node-part-frame" },
  ];
}

function buildCallouts(parts: readonly ProductPart[], includeCallouts: boolean): Callout[] {
  if (!includeCallouts) return [];
  const labels = new Map<string, string>([
    ["part-a-chip", "Next-gen pro chip"],
    ["part-camera-island", "Triple camera system"],
    ["part-battery", "Stacked battery cell"],
    ["part-thermal", "Graphite cooling layer"],
    ["part-display", "OLED display stack"],
  ]);

  return parts
    .filter((productPart) => labels.has(productPart.id))
    .map((productPart, index) => ({
      id: `callout-${productPart.id}`,
      label: labels.get(productPart.id) ?? productPart.name,
      targetPartId: productPart.id,
      anchor: productPart.calloutAnchor ?? vec3(),
      screenOffset: { x: index % 2 === 0 ? 260 : -260, y: -120 + index * 54 },
      revealTime: 1.6 + index * 0.18,
    }));
}

function buildCamera(duration: number): { cameras: CreationCamera[]; animations: AnimationClip[] } {
  const camera: CreationCamera = {
    id: "camera-hero-orbit",
    name: "Hero macro orbit camera",
    position: vec3(0.1, 0.35, 4.8),
    target: vec3(0, 0.02, 0),
    fov: 34,
    focalLength: 70,
    focusDistance: 4.2,
    depthOfField: true,
  };

  return {
    cameras: [camera],
    animations: [
      {
        id: "anim-camera-orbit",
        name: "Macro hero orbit",
        duration,
        tracks: [
          {
            id: "track-camera-position",
            targetId: camera.id,
            channel: "position",
            keyframes: [
              { time: 0, value: vec3(-0.35, 0.42, 5.4), easing: "ease-out" },
              { time: duration * 0.45, value: vec3(0.7, 0.32, 4.2), easing: "ease-in-out" },
              { time: duration, value: vec3(0.12, 0.22, 3.2), easing: "ease-in" },
            ],
          },
          {
            id: "track-camera-fov",
            targetId: camera.id,
            channel: "camera.fov",
            keyframes: [
              { time: 0, value: 38, easing: "ease-out" },
              { time: duration, value: 28, easing: "ease-in" },
            ],
          },
        ],
      },
    ],
  };
}

function buildExplodedAnimation(parts: readonly ProductPart[], duration: number): AnimationClip {
  return {
    id: "anim-product-exploded-view",
    name: "Semantic exploded product reveal",
    duration,
    tracks: parts.flatMap((productPart, index) => {
      const start = 0.9 + index * 0.035;
      const end = Math.min(duration - 1.2, start + 1.15);
      return [
        {
          id: `track-${productPart.id}-position`,
          targetId: productPart.id,
          channel: "position" as const,
          keyframes: [
            { time: 0, value: productPart.transform.position, easing: "ease" as const },
            { time: start, value: productPart.transform.position, easing: "ease-in-out" as const },
            {
              time: end,
              value: productPart.explodedTransform?.position ?? productPart.transform.position,
              easing: "ease-out" as const,
            },
            {
              time: duration - 0.7,
              value: productPart.transform.position,
              easing: "ease-in-out" as const,
            },
          ],
        },
      ];
    }),
  };
}

export function createPhoneProductCinematicScene(
  spec: ProductCinematicSpec = {},
): CreationScene {
  const id = spec.id ?? "scene-product-phone-cinematic";
  const duration = spec.duration ?? 6;
  const frameRate = spec.frameRate ?? 30;
  const seed = spec.seed ?? 1701;
  const includeInternals = spec.includeInternals ?? true;
  const includeCallouts = spec.includeCallouts ?? true;
  const parts = buildPhoneParts(includeInternals);
  const recipe: AssetRecipe = {
    id: "asset-phone-product",
    name: spec.name ?? "Editable phone product asset",
    kind: "product",
    seed,
    parameters: {
      productKind: spec.productKind ?? "phone",
      style: spec.style ?? "titanium pro phone",
      editable: true,
      hasSemanticParts: true,
      supportsExplodedView: true,
    },
    nodes: buildNodes(parts),
    materials: buildPhoneMaterials(),
    productParts: parts,
    outputs: buildOutputs(parts),
    dependencies: [],
    bakedCaches: [],
  };
  const cameraRig = buildCamera(duration);
  const exploded = buildExplodedAnimation(parts, duration);
  const warnings = [
    "Internals are procedural/plausible unless the user provides verified CAD or teardown references.",
  ];

  return {
    id,
    name: spec.name ?? "Phone Product Cinematic",
    duration,
    frameRate,
    assets: [recipe],
    objects: [
      {
        id: "object-phone-product",
        name: "Phone product assembly",
        assetId: recipe.id,
        transform: transform3d(vec3(0, 0, 0), vec3(-0.08, 0.18, 0), vec3(1, 1, 1)),
        visible: true,
      },
    ],
    cameras: cameraRig.cameras,
    activeCameraId: "camera-hero-orbit",
    lights: [
      {
        id: "light-softbox-key",
        name: "Large softbox key",
        kind: "area",
        color: "#ffffff",
        intensity: 4.2,
        position: vec3(-2.4, 3.2, 3.2),
        target: vec3(),
        size: 5,
      },
      {
        id: "light-rim",
        name: "Titanium rim light",
        kind: "directional",
        color: "#b8d8ff",
        intensity: 1.8,
        position: vec3(2, 1.2, -2),
        target: vec3(),
      },
    ],
    callouts: buildCallouts(parts, includeCallouts),
    animations: [exploded, ...cameraRig.animations],
    metadata: {
      createdBy: "agent",
      generator: "openreel.creation.product-cinematic.v1",
      warnings,
    },
  };
}
