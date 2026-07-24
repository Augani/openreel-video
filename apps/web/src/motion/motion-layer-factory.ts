import {
  createMotionAdjustmentLayer,
  createMotionNullLayer,
  createMotionParticleLayer,
  createMotionScene3DLayer,
  DEFAULT_MOTION_TRANSFORM,
  DEFAULT_SHAPE_STYLE,
  type MotionComposition,
  type MotionLayer,
  type MotionObject3D,
} from "@openreel/core";

export type CreatableMotionLayerType =
  | "text"
  | "shape"
  | "group"
  | "null"
  | "adjustment"
  | "particle"
  | "scene3d";

interface CreateLayerOptions {
  readonly id?: string;
  readonly position?: { readonly x: number; readonly y: number };
  readonly width?: number;
  readonly height?: number;
  readonly shapeType?: "rectangle" | "ellipse" | "line";
}

const makeId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export function createMotionLayerOfType(
  composition: MotionComposition,
  type: CreatableMotionLayerType,
  options: CreateLayerOptions = {},
): MotionLayer {
  const id = options.id ?? makeId("motion-layer");
  const position = options.position ?? {
    x: composition.width / 2,
    y: composition.height / 2,
  };

  switch (type) {
    case "text":
      return {
        id,
        type: "text",
        name: "Text Layer",
        startTime: 0,
        duration: composition.duration,
        visible: true,
        locked: false,
        transform: { ...DEFAULT_MOTION_TRANSFORM, position },
        keyframes: [],
        text: "New text",
        style: {
          fontFamily: "Inter",
          fontSize: 96,
          fontWeight: 800,
          color: "#ffffff",
          align: "center",
          lineHeight: 1.05,
        },
      };
    case "shape": {
      const shapeType = options.shapeType ?? "rectangle";
      return {
        id,
        type: "shape",
        name:
          shapeType === "ellipse"
            ? "Ellipse"
            : shapeType === "line"
              ? "Line"
              : "Rectangle",
        startTime: 0,
        duration: composition.duration,
        visible: true,
        locked: false,
        transform: { ...DEFAULT_MOTION_TRANSFORM, position },
        keyframes: [],
        shapeType,
        width: Math.max(1, options.width ?? 420),
        height: Math.max(1, options.height ?? 220),
        style: {
          ...DEFAULT_SHAPE_STYLE,
          fill: { type: "solid", color: "#14b8a6", opacity: 1 },
          stroke: { color: "#0f766e", width: 0, opacity: 0 },
          cornerRadius: shapeType === "rectangle" ? 20 : 0,
        },
      };
    }
    case "group":
      return {
        id,
        type: "group",
        name: "Group",
        startTime: 0,
        duration: composition.duration,
        visible: true,
        locked: false,
        transform: { ...DEFAULT_MOTION_TRANSFORM, position },
        keyframes: [],
        children: [],
      };
    case "null":
      return createMotionNullLayer(composition, { id, position });
    case "adjustment":
      return createMotionAdjustmentLayer({
        id,
        duration: composition.duration,
        compositionWidth: composition.width,
        compositionHeight: composition.height,
      });
    case "particle":
      return createMotionParticleLayer(composition, { id, position });
    case "scene3d": {
      const heroObject: MotionObject3D = {
        kind: "rounded-box",
        size: 0.5,
        depth: 1,
        cornerRadius: 0.12,
      };
      return createMotionScene3DLayer({
        id,
        name: "3D Scene",
        duration: composition.duration,
        compositionWidth: composition.width,
        compositionHeight: composition.height,
        x: position.x,
        y: position.y,
        object: heroObject,
        objects: [
          {
            id: makeId("scene-obj"),
            name: "Object 1",
            object: heroObject,
            material: {
              kind: "physical",
              color: "#10b981",
              metalness: 0.1,
              roughness: 0.4,
            },
            transform3d: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
          },
        ],
        camera: {
          position: { x: 0, y: 0.5, z: 4 },
          target: { x: 0, y: 0, z: 0 },
          fov: 35,
        },
        lighting: { environment: "studio", groundShadow: true },
      });
    }
    default: {
      const exhaustive: never = type;
      throw new Error(`Unsupported motion layer type: ${String(exhaustive)}`);
    }
  }
}
