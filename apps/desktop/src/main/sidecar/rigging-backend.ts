import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type {
  RigHumanoidModelArgs,
  RigHumanoidModelResult,
  RiggingBackendProbe,
} from "../../shared/ipc-contract";
import { blenderCandidates, isExecutable } from "./blender-path";

const execFileAsync = promisify(execFile);
const RIG_JOB_TIMEOUT_MS = 180_000;

export function parseBlenderVersion(output: string): string | null {
  const match = output.match(/Blender\s+([0-9]+(?:\.[0-9]+){1,2})/i);
  return match?.[1] ?? null;
}

export async function probeRiggingBackend(): Promise<RiggingBackendProbe> {
  const attempted: string[] = [];

  for (const candidate of blenderCandidates()) {
    if (candidate.path !== "blender" && !(await isExecutable(candidate.path))) {
      attempted.push(`${candidate.mode}:${candidate.path}`);
      continue;
    }

    try {
      const { stdout, stderr } = await execFileAsync(candidate.path, ["--version"], {
        timeout: 5000,
        windowsHide: true,
      });
      return {
        available: true,
        provider: "blender",
        mode: candidate.mode,
        path: candidate.path,
        version: parseBlenderVersion(`${stdout}\n${stderr}`) ?? undefined,
      };
    } catch (error) {
      attempted.push(`${candidate.mode}:${candidate.path}`);
      if (candidate.mode === "configured") {
        return {
          available: false,
          provider: "blender",
          mode: candidate.mode,
          path: candidate.path,
          error: error instanceof Error ? error.message : "Could not run Blender",
        };
      }
    }
  }

  return {
    available: false,
    provider: "blender",
    error: `Blender not found. Checked ${attempted.length} candidate(s). Set OPENREEL_BLENDER_PATH or bundle Blender under resources/rigging/blender/<platform>-<arch>.`,
  };
}

async function availableBlender(): Promise<RiggingBackendProbe> {
  return probeRiggingBackend();
}

async function tempRiggingDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "openreel-rigging-"));
}

function extensionFromUrl(url: string): string {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ext || ".glb";
  } catch {
    return path.extname(url).toLowerCase() || ".glb";
  }
}

async function resolveModelInput(modelUrl: string, workDir: string): Promise<string> {
  if (modelUrl.startsWith("file://")) return fileURLToPath(modelUrl);
  if (path.isAbsolute(modelUrl)) return modelUrl;
  if (/^https?:\/\//i.test(modelUrl)) {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Could not download model (${response.status} ${response.statusText})`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const inputPath = path.join(workDir, `source${extensionFromUrl(modelUrl)}`);
    await writeFile(inputPath, bytes);
    return inputPath;
  }
  throw new Error("rig_humanoid_model requires an absolute path, file:// URL, or http(s) URL");
}

async function resolveRigOutput(args: RigHumanoidModelArgs, workDir: string): Promise<string> {
  const outputPath = args.outputPath?.trim() || path.join(workDir, "rigged-model.glb");
  await mkdir(path.dirname(outputPath), { recursive: true });
  return outputPath;
}

function blenderRigScript(): string {
  return String.raw`
import argparse
import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Vector


def warning(code, severity, message):
    return {"code": code, "severity": severity, "message": message}


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--name", default="OpenReelHumanoid")
    parser.add_argument("--height-meters", type=float, default=0.0)
    parser.add_argument("--overwrite-existing", action="store_true")
    return parser.parse_args(argv)


def import_model(input_path):
    ext = os.path.splitext(input_path)[1].lower()
    if ext not in [".glb", ".gltf"]:
        raise RuntimeError("Only GLB/glTF humanoid rig jobs are supported")
    bpy.ops.import_scene.gltf(filepath=input_path)


def mesh_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def armature_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]


def mesh_bounds(meshes):
    points = []
    for obj in meshes:
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    if not points:
        return Vector((-0.5, -0.5, 0.0)), Vector((0.5, 0.5, 2.0))
    min_v = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    max_v = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return min_v, max_v


def count_skinned_meshes(meshes):
    count = 0
    for obj in meshes:
        if any(mod.type == "ARMATURE" for mod in obj.modifiers):
            count += 1
    return count


def create_bone(edit_bones, name, head, tail, parent=None):
    bone = edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    if parent is not None:
        bone.parent = parent
        bone.use_connect = False
    return bone


def create_humanoid_armature(name, meshes):
    min_v, max_v = mesh_bounds(meshes)
    size = max_v - min_v
    height = max(size.z, 0.01)
    center = (min_v + max_v) * 0.5
    shoulder_span = max(size.x * 0.55, height * 0.28)
    hip_span = max(size.x * 0.22, height * 0.10)
    arm_len = max(size.x * 0.32, height * 0.24)
    y = center.y
    z0 = min_v.z

    armature_data = bpy.data.armatures.new(f"{name}Armature")
    armature_obj = bpy.data.objects.new(f"{name} Armature", armature_data)
    bpy.context.collection.objects.link(armature_obj)
    bpy.context.view_layer.objects.active = armature_obj
    armature_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature_data.edit_bones

    hips = create_bone(
        bones,
        "Hips",
        Vector((center.x, y, z0 + height * 0.45)),
        Vector((center.x, y, z0 + height * 0.55)),
    )
    spine = create_bone(
        bones,
        "Spine",
        hips.tail,
        Vector((center.x, y, z0 + height * 0.70)),
        hips,
    )
    chest = create_bone(
        bones,
        "Chest",
        spine.tail,
        Vector((center.x, y, z0 + height * 0.82)),
        spine,
    )
    neck = create_bone(
        bones,
        "Neck",
        chest.tail,
        Vector((center.x, y, z0 + height * 0.89)),
        chest,
    )
    create_bone(
        bones,
        "Head",
        neck.tail,
        Vector((center.x, y, z0 + height * 0.98)),
        neck,
    )

    for suffix, sign in [(".L", -1.0), (".R", 1.0)]:
        shoulder = Vector((center.x + sign * shoulder_span * 0.5, y, z0 + height * 0.79))
        elbow = Vector((center.x + sign * (shoulder_span * 0.5 + arm_len * 0.45), y, z0 + height * 0.63))
        wrist = Vector((center.x + sign * (shoulder_span * 0.5 + arm_len * 0.85), y, z0 + height * 0.48))
        hand_tip = Vector((center.x + sign * (shoulder_span * 0.5 + arm_len), y, z0 + height * 0.45))
        upper = create_bone(bones, f"UpperArm{suffix}", shoulder, elbow, chest)
        fore = create_bone(bones, f"Forearm{suffix}", elbow, wrist, upper)
        create_bone(bones, f"Hand{suffix}", wrist, hand_tip, fore)

        hip = Vector((center.x + sign * hip_span * 0.5, y, z0 + height * 0.45))
        knee = Vector((center.x + sign * hip_span * 0.45, y, z0 + height * 0.23))
        ankle = Vector((center.x + sign * hip_span * 0.42, y, z0 + height * 0.04))
        toe = Vector((center.x + sign * hip_span * 0.42, y - height * 0.10, z0 + height * 0.02))
        thigh = create_bone(bones, f"UpperLeg{suffix}", hip, knee, hips)
        shin = create_bone(bones, f"LowerLeg{suffix}", knee, ankle, thigh)
        create_bone(bones, f"Foot{suffix}", ankle, toe, shin)

    bpy.ops.object.mode_set(mode="OBJECT")
    return armature_obj


def bind_meshes_to_armature(meshes, armature_obj, warnings):
    for obj in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        armature_obj.select_set(True)
        bpy.context.view_layer.objects.active = armature_obj
        try:
            bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        except Exception as exc:
            warnings.append(warning("AUTO_WEIGHTS_FAILED", "warning", f"{obj.name}: {exc}"))
            if not any(mod.type == "ARMATURE" and mod.object == armature_obj for mod in obj.modifiers):
                mod = obj.modifiers.new("OpenReel Armature", "ARMATURE")
                mod.object = armature_obj


def export_glb(output_path):
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_skins=True,
        export_animations=True,
    )


def run():
    args = parse_args()
    warnings = []
    try:
        import_model(args.input)
        meshes = mesh_objects()
        existing_armatures = armature_objects()
        created_armature = False
        preserved = False
        armature = existing_armatures[0] if existing_armatures else None

        if not meshes:
            warnings.append(warning("NO_MESHES", "error", "Imported model has no meshes to rig."))

        if armature is not None and not args.overwrite_existing:
            preserved = True
            warnings.append(warning("EXISTING_ARMATURE", "info", "Existing armature preserved."))
        else:
            if args.overwrite_existing:
                for obj in existing_armatures:
                    bpy.data.objects.remove(obj, do_unlink=True)
            armature = create_humanoid_armature(args.name, meshes)
            created_armature = True
            bind_meshes_to_armature(meshes, armature, warnings)

        meshes = mesh_objects()
        armatures = armature_objects()
        bone_count = sum(len(obj.data.bones) for obj in armatures)
        skinned_mesh_count = count_skinned_meshes(meshes)
        if created_armature and skinned_mesh_count == 0 and meshes:
            warnings.append(warning("NO_SKIN_BINDINGS", "warning", "Armature was created, but no mesh has an armature binding."))

        export_glb(args.output)
        result = {
            "ok": True,
            "provider": "blender",
            "inputUrl": args.input,
            "outputPath": args.output,
            "outputUrl": "",
            "armatureName": armature.name if armature else None,
            "createdArmature": created_armature,
            "preservedExistingArmature": preserved,
            "skinnedMeshCount": skinned_mesh_count,
            "meshCount": len(meshes),
            "boneCount": bone_count,
            "warnings": warnings,
        }
    except Exception as exc:
        result = {
            "ok": False,
            "provider": "blender",
            "inputUrl": args.input,
            "outputPath": args.output,
            "createdArmature": False,
            "preservedExistingArmature": False,
            "skinnedMeshCount": 0,
            "meshCount": 0,
            "boneCount": 0,
            "warnings": [warning("RIG_JOB_FAILED", "error", str(exc))],
            "error": traceback.format_exc(),
        }
    with open(args.report, "w", encoding="utf-8") as handle:
        json.dump(result, handle)


run()
`;
}

async function writeRigScript(workDir: string): Promise<string> {
  const scriptPath = path.join(workDir, "rig_humanoid_model.py");
  await writeFile(scriptPath, blenderRigScript(), "utf8");
  return scriptPath;
}

export async function rigHumanoidModel(
  args: RigHumanoidModelArgs,
): Promise<RigHumanoidModelResult> {
  const backend = await availableBlender();
  if (!backend.available || !backend.path) {
    return {
      ok: false,
      provider: "blender",
      inputUrl: args.modelUrl,
      createdArmature: false,
      preservedExistingArmature: false,
      skinnedMeshCount: 0,
      meshCount: 0,
      boneCount: 0,
      warnings: [
        {
          code: "BACKEND_UNAVAILABLE",
          severity: "error",
          message: backend.error ?? "Blender rigging backend is unavailable.",
        },
      ],
      error: backend.error,
    };
  }

  const workDir = await tempRiggingDir();
  const inputPath = await resolveModelInput(args.modelUrl, workDir);
  const outputPath = await resolveRigOutput(args, workDir);
  const reportPath = path.join(workDir, "rig-report.json");
  const scriptPath = await writeRigScript(workDir);

  try {
    await execFileAsync(
      backend.path,
      [
        "--background",
        "--factory-startup",
        "--python",
        scriptPath,
        "--",
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--report",
        reportPath,
        "--name",
        args.name ?? "OpenReelHumanoid",
        ...(args.heightMeters ? ["--height-meters", String(args.heightMeters)] : []),
        ...(args.overwriteExisting ? ["--overwrite-existing"] : []),
      ],
      {
        timeout: RIG_JOB_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
  } catch (error) {
    return {
      ok: false,
      provider: "blender",
      inputUrl: args.modelUrl,
      outputPath,
      outputUrl: pathToFileURL(outputPath).href,
      createdArmature: false,
      preservedExistingArmature: false,
      skinnedMeshCount: 0,
      meshCount: 0,
      boneCount: 0,
      warnings: [
        {
          code: "BLENDER_JOB_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : "Blender rigging job failed.",
        },
      ],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const rawReport = JSON.parse(await readFile(reportPath, "utf8")) as RigHumanoidModelResult;
  return {
    ...rawReport,
    inputUrl: args.modelUrl,
    outputPath,
    outputUrl: pathToFileURL(outputPath).href,
  };
}
