/**
 * Frozen copy of a project for work that outlives the edit that started it
 * (queued exports). The editor's action system edits the project object in
 * place, so holding a reference is not a snapshot.
 *
 * Plain objects and arrays are copied deeply; anything else (Blob, typed
 * arrays, file handles, ImageBitmap, ...) is shared by reference, which keeps
 * a snapshot cheap even when the project carries large media.
 */
export function cloneProjectSnapshot<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const copy = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") return input;
    const known = seen.get(input);
    if (known !== undefined) return known;
    if (Array.isArray(input)) {
      const out: unknown[] = new Array(input.length);
      seen.set(input, out);
      for (let i = 0; i < input.length; i++) out[i] = copy(input[i]);
      return out;
    }
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return input;
    const out: Record<string, unknown> = {};
    seen.set(input, out);
    for (const key of Object.keys(input)) out[key] = copy((input as Record<string, unknown>)[key]);
    return out;
  };
  return copy(value) as T;
}
