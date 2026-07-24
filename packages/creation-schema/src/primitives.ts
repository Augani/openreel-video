import type { Transform3D, Vec3 } from "./types";

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const transform3d = (
  position = vec3(),
  rotation = vec3(),
  scale = vec3(1, 1, 1),
): Transform3D => ({ position, rotation, scale });

export function offsetTransform(
  base: Transform3D,
  offset: Vec3,
  scale = base.scale,
): Transform3D {
  return {
    position: {
      x: base.position.x + offset.x,
      y: base.position.y + offset.y,
      z: base.position.z + offset.z,
    },
    rotation: base.rotation,
    scale,
  };
}
