export type CreationAssetKind =
  | "product"
  | "character"
  | "environment"
  | "prop"
  | "ui"
  | "custom";

export type RecipeNodeType =
  | "primitive"
  | "curve"
  | "sdf"
  | "boolean"
  | "bevel"
  | "subdivision"
  | "array"
  | "scatter"
  | "deform"
  | "cloth"
  | "skeleton"
  | "ik-control"
  | "material"
  | "uv"
  | "decal"
  | "bake"
  | "product-part";

export type ProductPartRole =
  | "shell"
  | "screen"
  | "lens"
  | "camera-module"
  | "board"
  | "battery"
  | "chip"
  | "thermal"
  | "screw"
  | "connector"
  | "decorative"
  | "callout";

export type MaterialKind =
  | "pbr"
  | "screen"
  | "glass"
  | "metal"
  | "plastic"
  | "fabric"
  | "emissive"
  | "procedural";

export type AnimationChannel =
  | "position"
  | "rotation"
  | "scale"
  | "opacity"
  | "material.emissiveIntensity"
  | "camera.position"
  | "camera.target"
  | "camera.fov"
  | "camera.focusDistance";

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Transform3D {
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

export interface MaterialRecipe {
  readonly id: string;
  readonly name: string;
  readonly kind: MaterialKind;
  readonly baseColor: string;
  readonly metallic?: number;
  readonly roughness?: number;
  readonly opacity?: number;
  readonly transmission?: number;
  readonly clearcoat?: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly procedural?: readonly string[];
}

export interface RecipeNode {
  readonly id: string;
  readonly type: RecipeNodeType;
  readonly name: string;
  readonly inputs?: readonly string[];
  readonly parameters: Record<string, unknown>;
}

export interface ProductPart {
  readonly id: string;
  readonly name: string;
  readonly role: ProductPartRole;
  readonly materialId: string;
  readonly nodeId: string;
  readonly transform: Transform3D;
  readonly explodedTransform?: Transform3D;
  readonly calloutAnchor?: Vec3;
  readonly visible?: boolean;
}

export interface AssetOutput {
  readonly id: string;
  readonly kind: "preview-mesh" | "final-mesh" | "collision-mesh" | "texture-atlas" | "animation";
  readonly nodeId: string;
}

export interface AssetDependency {
  readonly id: string;
  readonly kind: "reference-image" | "font" | "texture" | "mesh" | "motion-clip";
  readonly uri: string;
  readonly required: boolean;
}

export interface AssetCacheRef {
  readonly id: string;
  readonly kind: "mesh" | "texture" | "animation" | "thumbnail";
  readonly uri: string;
  readonly generatedAt: number;
}

export interface AssetRecipe {
  readonly id: string;
  readonly name: string;
  readonly kind: CreationAssetKind;
  readonly seed: number;
  readonly parameters: Record<string, unknown>;
  readonly nodes: readonly RecipeNode[];
  readonly materials: readonly MaterialRecipe[];
  readonly productParts?: readonly ProductPart[];
  readonly outputs: readonly AssetOutput[];
  readonly dependencies: readonly AssetDependency[];
  readonly bakedCaches: readonly AssetCacheRef[];
}

export interface SceneObject {
  readonly id: string;
  readonly name: string;
  readonly assetId: string;
  readonly transform: Transform3D;
  readonly visible: boolean;
}

export interface CreationCamera {
  readonly id: string;
  readonly name: string;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fov: number;
  readonly focalLength?: number;
  readonly focusDistance?: number;
  readonly depthOfField?: boolean;
}

export interface CreationLight {
  readonly id: string;
  readonly name: string;
  readonly kind: "ambient" | "directional" | "point" | "area" | "spot";
  readonly color: string;
  readonly intensity: number;
  readonly position?: Vec3;
  readonly target?: Vec3;
  readonly size?: number;
}

export interface Callout {
  readonly id: string;
  readonly label: string;
  readonly targetPartId: string;
  readonly anchor: Vec3;
  readonly screenOffset: Vec2;
  readonly revealTime: number;
}

export interface Keyframe<T = number | Vec3 | string> {
  readonly time: number;
  readonly value: T;
  readonly easing?: "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface AnimationTrack<T = number | Vec3 | string> {
  readonly id: string;
  readonly targetId: string;
  readonly channel: AnimationChannel;
  readonly keyframes: readonly Keyframe<T>[];
}

export interface AnimationClip {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly tracks: readonly AnimationTrack[];
}

export interface CreationScene {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly frameRate: number;
  readonly assets: readonly AssetRecipe[];
  readonly objects: readonly SceneObject[];
  readonly cameras: readonly CreationCamera[];
  readonly activeCameraId: string;
  readonly lights: readonly CreationLight[];
  readonly callouts: readonly Callout[];
  readonly animations: readonly AnimationClip[];
  readonly metadata: {
    readonly createdBy: "agent" | "user" | "system";
    readonly generator: string;
    readonly warnings: readonly string[];
  };
}

export interface CreationValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly path?: string;
}
