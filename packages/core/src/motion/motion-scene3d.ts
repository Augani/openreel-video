import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionMaterial3D,
  type MotionObject3D,
  type MotionObject3DKind,
  type MotionScene3DCamera,
  type MotionScene3DLayer,
  type MotionScene3DLighting,
  type MotionScene3DRoom,
  type MotionSceneObject3D,
} from "./types";

export const MOTION_OBJECT_3D_KINDS: readonly MotionObject3DKind[] = [
  "box",
  "rounded-box",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "icosahedron",
  "plane",
  "phone",
  "model",
  "text3d",
  "soccer-ball",
  "open-box",
  "room",
];

export interface CreateMotionScene3DOptions {
  readonly id: string;
  readonly name?: string;
  readonly startTime?: number;
  readonly duration: number;
  readonly compositionWidth: number;
  readonly compositionHeight: number;
  readonly object: MotionObject3D;
  readonly material?: MotionMaterial3D;
  readonly lighting?: MotionScene3DLighting;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
  readonly fov?: number;
  readonly cameraDistance?: number;
  readonly objects?: readonly MotionSceneObject3D[];
  readonly camera?: MotionScene3DCamera;
  readonly room?: MotionScene3DRoom;
}

export function createMotionScene3DLayer(
  options: CreateMotionScene3DOptions,
): MotionScene3DLayer {
  return {
    id: options.id,
    type: "scene3d",
    name: options.name ?? "3D Object",
    startTime: Math.max(0, options.startTime ?? 0),
    duration: Math.max(0.1, options.duration),
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: {
        x: options.x ?? options.compositionWidth / 2,
        y: options.y ?? options.compositionHeight / 2,
      },
      rotation3d: {
        x: options.rotationX ?? 0,
        y: options.rotationY ?? 0,
        z: options.rotationZ ?? 0,
      },
    },
    keyframes: [],
    object: options.object,
    material: options.material,
    lighting: options.lighting,
    fov: options.fov,
    cameraDistance: options.cameraDistance,
    width: options.width,
    height: options.height,
    objects: options.objects,
    camera: options.camera,
    room: options.room,
  };
}
