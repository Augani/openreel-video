import type { Bounds3, Transform3D, Vec2, Vec3 } from "./common";

export type CreationAssetKind =
  | "product"
  | "character"
  | "environment"
  | "prop"
  | "ui"
  | "material"
  | "custom";

export type CreationRecipeNodeType =
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
  | "product-part"
  | "cache";

export type CreationMaterialModel =
  | "pbr"
  | "screen"
  | "glass"
  | "metal"
  | "plastic"
  | "fabric"
  | "emissive"
  | "procedural";

export type CreationCacheKind =
  | "preview-mesh"
  | "final-mesh"
  | "collision-mesh"
  | "texture-atlas"
  | "animation"
  | "thumbnail"
  | "render-preview";

export type CreationCacheStatus = "missing" | "dirty" | "ready" | "failed";

export type CreationParameterValue =
  | string
  | number
  | boolean
  | null
  | Vec2
  | Vec3
  | readonly CreationParameterValue[]
  | { readonly [key: string]: CreationParameterValue };

export type CreationParameters = Record<string, CreationParameterValue>;

export interface CreationMaterial {
  readonly id: string;
  readonly name: string;
  readonly model: CreationMaterialModel;
  readonly baseColor: string;
  readonly metallic?: number;
  readonly roughness?: number;
  readonly opacity?: number;
  readonly transmission?: number;
  readonly clearcoat?: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly normalCacheId?: string;
  readonly textureCacheId?: string;
  readonly parameters?: CreationParameters;
}

export interface CreationRecipeNode {
  readonly id: string;
  readonly type: CreationRecipeNodeType;
  readonly name: string;
  readonly inputs: readonly string[];
  readonly parameters: CreationParameters;
}

export interface CreationAssetDependency {
  readonly id: string;
  readonly kind: "reference-image" | "font" | "texture" | "mesh" | "motion-clip" | "cad";
  readonly uri: string;
  readonly required: boolean;
}

export interface CreationCacheRef {
  readonly id: string;
  readonly kind: CreationCacheKind;
  readonly status: CreationCacheStatus;
  readonly uri?: string;
  readonly bounds?: Bounds3;
  readonly generatedAt?: number;
  readonly generatorVersion?: string;
  readonly error?: string;
}

export interface CreationAssetRecipe {
  readonly id: string;
  readonly name: string;
  readonly kind: CreationAssetKind;
  readonly seed: string | number;
  readonly parameters: CreationParameters;
  readonly nodes: readonly CreationRecipeNode[];
  readonly materials: readonly CreationMaterial[];
  readonly dependencies: readonly CreationAssetDependency[];
  readonly caches: readonly CreationCacheRef[];
  readonly createdAt: number;
  readonly modifiedAt: number;
}

export interface CreationSceneObject {
  readonly id: string;
  readonly name: string;
  readonly assetId: string;
  readonly materialId?: string;
  readonly partId?: string;
  readonly parentId?: string;
  readonly transform: Transform3D;
  readonly visible: boolean;
  readonly selectable: boolean;
  readonly tags: readonly string[];
}

export interface CreationCamera {
  readonly id: string;
  readonly name: string;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fov: number;
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

export interface CreationAnimationKeyframe<T = number | Vec3 | string> {
  readonly time: number;
  readonly value: T;
  readonly easing: "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface CreationAnimationTrack<T = number | Vec3 | string> {
  readonly id: string;
  readonly targetId: string;
  readonly channel:
    | "position"
    | "rotation"
    | "scale"
    | "opacity"
    | "material"
    | "camera.position"
    | "camera.target"
    | "camera.fov"
    | "camera.focusDistance";
  readonly keyframes: readonly CreationAnimationKeyframe<T>[];
}

export interface CreationAnimationClip {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly tracks: readonly CreationAnimationTrack[];
}

export interface CreationSceneEnvironment {
  readonly kind: "none" | "studio" | "stage" | "outdoor" | "space" | "custom";
  readonly backgroundColor?: string;
  readonly groundEnabled?: boolean;
  readonly groundColor?: string;
}

export interface CreationRenderObjectBinding {
  readonly sceneObjectId: string;
  readonly renderObjectId: string;
}

export interface CreationRenderBinding {
  readonly id: string;
  readonly kind: "motion-scene3d";
  readonly compositionId: string;
  readonly layerId: string;
  readonly objectBindings: readonly CreationRenderObjectBinding[];
  readonly calloutLayerIds?: readonly string[];
  readonly createdAt: number;
  readonly modifiedAt: number;
}

export interface CreationScene {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly frameRate: number;
  readonly objects: readonly CreationSceneObject[];
  readonly cameras: readonly CreationCamera[];
  readonly activeCameraId?: string;
  readonly lights: readonly CreationLight[];
  readonly animations: readonly CreationAnimationClip[];
  readonly environment: CreationSceneEnvironment;
  readonly renderBindings: readonly CreationRenderBinding[];
  readonly createdAt: number;
  readonly modifiedAt: number;
}

export type CreationOperationSource = "agent" | "user" | "system";

export type CreationOperation =
  | {
      readonly id: string;
      readonly type: "asset/upsert";
      readonly timestamp: number;
      readonly source: CreationOperationSource;
      readonly label?: string;
      readonly asset: CreationAssetRecipe;
    }
  | {
      readonly id: string;
      readonly type: "asset/remove";
      readonly timestamp: number;
      readonly source: CreationOperationSource;
      readonly label?: string;
      readonly assetId: string;
    }
  | {
      readonly id: string;
      readonly type: "scene/upsert";
      readonly timestamp: number;
      readonly source: CreationOperationSource;
      readonly label?: string;
      readonly scene: CreationScene;
    }
  | {
      readonly id: string;
      readonly type: "scene/set-active";
      readonly timestamp: number;
      readonly source: CreationOperationSource;
      readonly label?: string;
      readonly sceneId: string;
    }
  | {
      readonly id: string;
      readonly type: "camera/upsert";
      readonly timestamp: number;
      readonly source: CreationOperationSource;
      readonly label?: string;
      readonly sceneId: string;
      readonly camera: CreationCamera;
      readonly active?: boolean;
    }
  | {
      readonly id: string;
      readonly type: "scene-object/upsert";
      readonly timestamp: number;
      readonly source: CreationOperationSource;
      readonly label?: string;
      readonly sceneId: string;
      readonly object: CreationSceneObject;
    }
  | {
      readonly id: string;
      readonly type: "scene-object/update-transform";
      readonly timestamp: number;
      readonly source: CreationOperationSource;
      readonly label?: string;
      readonly sceneId: string;
      readonly objectId: string;
      readonly transform: Transform3D;
    }
  | {
      readonly id: string;
      readonly type: "scene-object/update-material";
      readonly timestamp: number;
      readonly source: CreationOperationSource;
      readonly label?: string;
      readonly sceneId: string;
      readonly objectId: string;
      readonly materialId?: string;
    }
  | {
      readonly id: string;
      readonly type: "scene-object/remove";
      readonly timestamp: number;
      readonly source: CreationOperationSource;
      readonly label?: string;
      readonly sceneId: string;
      readonly objectId: string;
    }
  | {
      readonly id: string;
      readonly type: "animation/upsert-clip";
      readonly timestamp: number;
      readonly source: CreationOperationSource;
      readonly label?: string;
      readonly sceneId: string;
      readonly clip: CreationAnimationClip;
    };

export interface CreationProjectState {
  readonly version: string;
  readonly assets: readonly CreationAssetRecipe[];
  readonly scenes: readonly CreationScene[];
  readonly activeSceneId?: string;
  readonly operationHistory: readonly CreationOperation[];
}

export interface CreationValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly path?: string;
}
