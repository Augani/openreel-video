/**
 * Generates a unique ID string using timestamp and random values.
 *
 * @returns Unique ID in format "timestamp-randomhash"
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
export * from "./serialization";
export * from "./immutable-updates";
