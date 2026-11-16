import type { Project } from "../types";

/**
 * Serializes a Project to a JSON string with formatting.
 *
 * Baked scene3d geometry (`object.mesh`) is persisted so displacement/extrude
 * relief survives a reload; its size is bounded at bake time by the triangle
 * budget in the geometry kernel.
 *
 * @param project - Project to serialize
 * @returns Formatted JSON string
 */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

/**
 * Deserializes a JSON string back to a Project object.
 *
 * @param json - JSON string to parse
 * @returns Deserialized Project object
 * @throws SyntaxError if JSON is invalid
 */
export function deserializeProject(json: string): Project {
  return JSON.parse(json) as Project;
}
