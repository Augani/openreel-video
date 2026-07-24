import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  ModelInspectionAnimation,
  ModelInspectionMaterial,
  ModelInspectionMesh,
  ModelInspectionReport,
  ModelInspectionTexture,
  ModelInspectionWarning,
} from "@openreel/agent";

const HIGH_TRIANGLE_WARNING_THRESHOLD = 250_000;
const LARGE_TEXTURE_WARNING_THRESHOLD = 4096;

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function vec3(value: THREE.Vector3): { readonly x: number; readonly y: number; readonly z: number } {
  return {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
    z: finiteNumber(value.z),
  };
}

function materialList(material: THREE.Material | THREE.Material[] | undefined): THREE.Material[] {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function materialName(material: THREE.Material): string {
  return material.name?.trim() || material.type || "Material";
}

function textureImageSize(texture: THREE.Texture): { readonly width?: number; readonly height?: number } {
  const image = texture.image as
    | { readonly width?: number; readonly height?: number; readonly naturalWidth?: number; readonly naturalHeight?: number }
    | undefined;
  const width = image?.width ?? image?.naturalWidth;
  const height = image?.height ?? image?.naturalHeight;
  return {
    ...(typeof width === "number" && Number.isFinite(width) ? { width } : {}),
    ...(typeof height === "number" && Number.isFinite(height) ? { height } : {}),
  };
}

function inspectMaterialTextures(
  material: THREE.Material,
  textures: Map<string, ModelInspectionTexture>,
): readonly string[] {
  const slots: string[] = [];
  const record = material as unknown as Record<string, unknown>;
  for (const [slot, value] of Object.entries(record)) {
    if (!(value instanceof THREE.Texture)) continue;
    slots.push(slot);
    const key = value.uuid || `${material.uuid}:${slot}`;
    if (!textures.has(key)) {
      textures.set(key, {
        name: value.name?.trim() || `${materialName(material)} ${slot}`,
        slot,
        ...textureImageSize(value),
      });
    }
  }
  return slots;
}

function inspectMaterial(
  material: THREE.Material,
  textures: Map<string, ModelInspectionTexture>,
): ModelInspectionMaterial {
  const standard = material as THREE.MeshStandardMaterial;
  const color = "color" in standard && standard.color ? `#${standard.color.getHexString()}` : undefined;
  const metalness = typeof standard.metalness === "number" ? standard.metalness : undefined;
  const roughness = typeof standard.roughness === "number" ? standard.roughness : undefined;
  return {
    name: materialName(material),
    type: material.type,
    ...(color ? { color } : {}),
    ...(metalness !== undefined ? { metalness } : {}),
    ...(roughness !== undefined ? { roughness } : {}),
    textureSlots: inspectMaterialTextures(material, textures),
  };
}

function inspectMesh(mesh: THREE.Mesh): ModelInspectionMesh {
  const position = mesh.geometry?.attributes.position;
  const vertexCount = position ? position.count : 0;
  const triangleCount = mesh.geometry?.index
    ? Math.floor(mesh.geometry.index.count / 3)
    : Math.floor(vertexCount / 3);
  return {
    name: mesh.name?.trim() || "Mesh",
    vertexCount,
    triangleCount,
    skinned: (mesh as THREE.SkinnedMesh).isSkinnedMesh === true,
    materialNames: materialList(mesh.material).map(materialName),
  };
}

function inspectAnimation(clip: THREE.AnimationClip): ModelInspectionAnimation {
  const targets = new Set<string>();
  for (const track of clip.tracks) {
    const target = track.name.split(".")[0]?.trim();
    if (target) targets.add(target);
  }
  return {
    name: clip.name?.trim() || "Animation",
    duration: finiteNumber(clip.duration),
    trackCount: clip.tracks.length,
    targetCount: targets.size,
    tracks: clip.tracks.slice(0, 24).map((track) => track.name),
  };
}

function buildWarnings(report: Omit<ModelInspectionReport, "warnings" | "suggestedNextTools">): ModelInspectionWarning[] {
  const warnings: ModelInspectionWarning[] = [];
  const push = (severity: ModelInspectionWarning["severity"], code: string, message: string) => {
    warnings.push({ severity, code, message });
  };
  if (report.meshCount === 0) {
    push("error", "NO_MESHES", "Model has no renderable meshes.");
  }
  if (!report.bounds || report.bounds.size.x === 0 || report.bounds.size.y === 0 || report.bounds.size.z === 0) {
    push("warning", "INVALID_BOUNDS", "Model bounds are empty or flat; placement and auto-framing may be unreliable.");
  }
  if (report.materialCount === 0) {
    push("warning", "NO_MATERIALS", "Model has no materials.");
  }
  if (report.animationCount === 0) {
    push("info", "NO_ANIMATIONS", "Model has no embedded animation clips.");
  }
  if (!report.armature.hasSkinnedMesh || report.armature.boneCount === 0) {
    push("info", "NO_ARMATURE", "Model does not expose a skinned armature.");
  }
  if (report.triangleCount > HIGH_TRIANGLE_WARNING_THRESHOLD) {
    push(
      "warning",
      "HIGH_TRIANGLE_COUNT",
      `Model has ${report.triangleCount.toLocaleString()} triangles; realtime preview may need optimization.`,
    );
  }
  for (const texture of report.textures) {
    if (
      (texture.width ?? 0) > LARGE_TEXTURE_WARNING_THRESHOLD ||
      (texture.height ?? 0) > LARGE_TEXTURE_WARNING_THRESHOLD
    ) {
      push(
        "warning",
        "LARGE_TEXTURE",
        `${texture.name} is ${texture.width ?? "?"}x${texture.height ?? "?"}; consider resizing for realtime playback.`,
      );
    }
  }
  return warnings;
}

function suggestedTools(report: Omit<ModelInspectionReport, "warnings" | "suggestedNextTools">): string[] {
  const tools = ["probe_rigging_backend"];
  if (report.animationCount > 0) tools.push("set_model_animation");
  if (!report.armature.hasSkinnedMesh || report.armature.boneCount === 0) {
    tools.push("rig_humanoid_model");
  } else {
    tools.push("retarget_animation_clip", "set_bone_pose", "set_ik_target");
  }
  if (
    report.triangleCount > HIGH_TRIANGLE_WARNING_THRESHOLD ||
    report.textures.some(
      (texture) =>
        (texture.width ?? 0) > LARGE_TEXTURE_WARNING_THRESHOLD ||
        (texture.height ?? 0) > LARGE_TEXTURE_WARNING_THRESHOLD,
    )
  ) {
    tools.push("optimize_3d_model");
  }
  return tools;
}

function disposeLoadedScene(scene: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    for (const material of materialList(mesh.material)) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    material.dispose();
  }
}

export async function inspectGltfModel(
  modelUrl: string,
  options: { readonly name?: string; readonly source?: string } = {},
): Promise<ModelInspectionReport> {
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const scene = gltf.scene;
  const meshes: ModelInspectionMesh[] = [];
  const materialsByUuid = new Map<string, THREE.Material>();
  const texturesByUuid = new Map<string, ModelInspectionTexture>();
  const bones: THREE.Bone[] = [];
  let skinnedMeshCount = 0;

  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      meshes.push(inspectMesh(mesh));
      for (const material of materialList(mesh.material)) {
        materialsByUuid.set(material.uuid, material);
      }
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh === true) skinnedMeshCount += 1;
    }
    const bone = node as THREE.Bone;
    if (bone.isBone) bones.push(bone);
  });

  const materials = Array.from(materialsByUuid.values()).map((material) =>
    inspectMaterial(material, texturesByUuid),
  );
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const hasBounds =
    !box.isEmpty() &&
    Number.isFinite(size.x) &&
    Number.isFinite(size.y) &&
    Number.isFinite(size.z);
  const rootBones = bones
    .filter((bone) => !(bone.parent as THREE.Bone | null)?.isBone)
    .map((bone) => bone.name?.trim() || "Bone");

  const reportBase: Omit<ModelInspectionReport, "warnings" | "suggestedNextTools"> = {
    modelUrl,
    ...(options.name ? { name: options.name } : {}),
    ...(options.source ? { source: options.source } : {}),
    meshCount: meshes.length,
    materialCount: materials.length,
    textureCount: texturesByUuid.size,
    animationCount: gltf.animations.length,
    vertexCount: meshes.reduce((sum, mesh) => sum + mesh.vertexCount, 0),
    triangleCount: meshes.reduce((sum, mesh) => sum + mesh.triangleCount, 0),
    ...(hasBounds
      ? {
          bounds: {
            min: vec3(box.min),
            max: vec3(box.max),
            size: vec3(size),
            center: vec3(center),
          },
        }
      : {}),
    meshes,
    materials,
    textures: Array.from(texturesByUuid.values()),
    animations: gltf.animations.map(inspectAnimation),
    armature: {
      hasSkinnedMesh: skinnedMeshCount > 0,
      skinnedMeshCount,
      boneCount: bones.length,
      rootBones,
      sampleBones: bones.slice(0, 48).map((bone) => bone.name?.trim() || "Bone"),
    },
  };

  try {
    return {
      ...reportBase,
      warnings: buildWarnings(reportBase),
      suggestedNextTools: suggestedTools(reportBase),
    };
  } finally {
    disposeLoadedScene(scene);
  }
}
