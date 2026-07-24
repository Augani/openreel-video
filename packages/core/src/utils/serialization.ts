import type { Project, Action } from "../types";

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

/**
 * Serializes a single Action to a JSON string with formatting.
 *
 * @param action - Action to serialize
 * @returns Formatted JSON string
 */
export function serializeAction(action: Action): string {
  return JSON.stringify(action, null, 2);
}

/**
 * Deserializes a JSON string back to an Action object.
 *
 * @param json - JSON string to parse
 * @returns Deserialized Action object
 * @throws SyntaxError if JSON is invalid
 */
export function deserializeAction(json: string): Action {
  return JSON.parse(json) as Action;
}

/**
 * Serializes an array of Actions to a JSON string with formatting.
 *
 * @param actions - Actions array to serialize
 * @returns Formatted JSON string
 */
export function serializeActions(actions: Action[]): string {
  return JSON.stringify(actions, null, 2);
}

/**
 * Deserializes a JSON string back to an Actions array.
 *
 * @param json - JSON string to parse
 * @returns Deserialized Actions array
 * @throws SyntaxError if JSON is invalid
 */
export function deserializeActions(json: string): Action[] {
  return JSON.parse(json) as Action[];
}

/**
 * Deep equality comparison for any values.
 * Handles primitives, arrays, objects, NaN, and Infinity correctly.
 * Ignores undefined properties when comparing objects.
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns true if values are deeply equal, false otherwise
 */
export function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" && typeof b === "number") {
    // Both NaN
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (!Number.isFinite(a) && !Number.isFinite(b)) return a === b;
    return a === b;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEquals(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    // (since JSON.stringify removes undefined properties)
    const aKeys = Object.keys(aObj).filter((k) => aObj[k] !== undefined);
    const bKeys = Object.keys(bObj).filter((k) => bObj[k] !== undefined);

    if (aKeys.length !== bKeys.length) return false;

    return aKeys.every((key) => deepEquals(aObj[key], bObj[key]));
  }
  return false;
}
