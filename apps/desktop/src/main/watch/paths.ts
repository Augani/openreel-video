import fs from "node:fs";
import path from "node:path";

/**
 * Path identity for watch folders. Two spellings of the same place (case, separators, trailing slash,
 * `.`/`..` segments) must compare equal, otherwise overlap and loop detection can be sidestepped on
 * Windows. `api` is injectable so the Windows rules are unit-tested on any host.
 */
export type PathApi = Pick<typeof path, "resolve" | "sep" | "parse">;

export function pathKey(input: string, api: PathApi = path): string {
  let resolved = api.resolve(input);
  const root = api.parse(resolved).root;
  while (resolved.length > root.length && resolved.endsWith(api.sep)) resolved = resolved.slice(0, -1);
  // Windows (backslash) volumes are case-insensitive.
  return api.sep === "\\" ? resolved.toLowerCase() : resolved;
}

export function samePath(a: string, b: string, api: PathApi = path): boolean {
  return pathKey(a, api) === pathKey(b, api);
}

/**
 * The canonical on-disk spelling. `realpath.native` also expands Windows 8.3 short names (RUNNER~1)
 * which the JS realpath leaves alone. Resolves to null when the path does not exist.
 */
export function canonicalPath(input: string): Promise<string | null> {
  return new Promise((resolve) => {
    fs.realpath.native(input, (error, resolved) => resolve(error ? null : resolved));
  });
}
