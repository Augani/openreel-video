import type {
  AssetRecipe,
  CreationScene,
  CreationValidationIssue,
  ProductPart,
} from "./types";

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function issue(
  severity: CreationValidationIssue["severity"],
  code: string,
  message: string,
  path?: string,
): CreationValidationIssue {
  return { severity, code, message, ...(path ? { path } : {}) };
}

function validateProductAsset(asset: AssetRecipe, issues: CreationValidationIssue[]): void {
  const parts = asset.productParts ?? [];
  if (parts.length === 0) {
    issues.push(issue("error", "product_parts_missing", `Product asset "${asset.id}" has no semantic product parts.`, `assets.${asset.id}.productParts`));
    return;
  }

  const materialIds = new Set(asset.materials.map((material) => material.id));
  const nodeIds = new Set(asset.nodes.map((node) => node.id));
  for (const part of parts) {
    if (!materialIds.has(part.materialId)) {
      issues.push(issue("error", "unknown_material", `Part "${part.name}" references unknown material "${part.materialId}".`, `parts.${part.id}.materialId`));
    }
    if (!nodeIds.has(part.nodeId)) {
      issues.push(issue("error", "unknown_node", `Part "${part.name}" references unknown node "${part.nodeId}".`, `parts.${part.id}.nodeId`));
    }
    if (!part.explodedTransform) {
      issues.push(issue("warning", "missing_exploded_transform", `Part "${part.name}" has no exploded-view transform.`, `parts.${part.id}.explodedTransform`));
    }
  }
}

export function validateCreationScene(scene: CreationScene): readonly CreationValidationIssue[] {
  const issues: CreationValidationIssue[] = [];
  if (scene.duration <= 0) issues.push(issue("error", "bad_duration", "Scene duration must be positive.", "duration"));
  if (scene.frameRate <= 0) issues.push(issue("error", "bad_frame_rate", "Scene frame rate must be positive.", "frameRate"));
  if (scene.assets.length === 0) issues.push(issue("error", "assets_missing", "Scene has no assets.", "assets"));
  if (scene.objects.length === 0) issues.push(issue("error", "objects_missing", "Scene has no scene objects.", "objects"));

  for (const dupe of duplicates(scene.assets.map((asset) => asset.id))) {
    issues.push(issue("error", "duplicate_asset_id", `Duplicate asset id "${dupe}".`, "assets"));
  }
  for (const dupe of duplicates(scene.objects.map((object) => object.id))) {
    issues.push(issue("error", "duplicate_object_id", `Duplicate object id "${dupe}".`, "objects"));
  }

  const assetIds = new Set(scene.assets.map((asset) => asset.id));
  for (const object of scene.objects) {
    if (!assetIds.has(object.assetId)) {
      issues.push(issue("error", "unknown_asset", `Object "${object.name}" references unknown asset "${object.assetId}".`, `objects.${object.id}.assetId`));
    }
  }

  const cameraIds = new Set(scene.cameras.map((camera) => camera.id));
  if (!cameraIds.has(scene.activeCameraId)) {
    issues.push(issue("error", "unknown_camera", `Active camera "${scene.activeCameraId}" does not exist.`, "activeCameraId"));
  }

  const productParts = new Map<string, ProductPart>();
  for (const asset of scene.assets) {
    if (asset.kind === "product") validateProductAsset(asset, issues);
    for (const part of asset.productParts ?? []) productParts.set(part.id, part);
  }

  for (const callout of scene.callouts) {
    if (!productParts.has(callout.targetPartId)) {
      issues.push(issue("error", "unknown_callout_target", `Callout "${callout.label}" targets unknown part "${callout.targetPartId}".`, `callouts.${callout.id}.targetPartId`));
    }
    if (callout.revealTime < 0 || callout.revealTime > scene.duration) {
      issues.push(issue("warning", "callout_time_out_of_range", `Callout "${callout.label}" reveal time is outside the scene duration.`, `callouts.${callout.id}.revealTime`));
    }
  }

  for (const clip of scene.animations) {
    if (clip.duration <= 0) issues.push(issue("error", "bad_animation_duration", `Animation "${clip.name}" duration must be positive.`, `animations.${clip.id}.duration`));
    if (clip.tracks.length === 0) issues.push(issue("warning", "animation_tracks_missing", `Animation "${clip.name}" has no tracks.`, `animations.${clip.id}.tracks`));
    for (const track of clip.tracks) {
      if (track.keyframes.length < 2) {
        issues.push(issue("warning", "too_few_keyframes", `Track "${track.id}" has fewer than two keyframes.`, `animations.${clip.id}.tracks.${track.id}`));
      }
    }
  }

  return issues;
}

export function summarizeCreationScene(scene: CreationScene): string {
  const productPartCount = scene.assets.reduce(
    (total, asset) => total + (asset.productParts?.length ?? 0),
    0,
  );
  const materialCount = scene.assets.reduce(
    (total, asset) => total + asset.materials.length,
    0,
  );
  const trackCount = scene.animations.reduce(
    (total, animation) => total + animation.tracks.length,
    0,
  );
  return `${scene.name}: ${scene.assets.length} asset(s), ${productPartCount} product part(s), ${materialCount} material(s), ${scene.callouts.length} callout(s), ${trackCount} animation track(s).`;
}
