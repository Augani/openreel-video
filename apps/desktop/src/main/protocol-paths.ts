import path from "node:path";

type ResolvedAppPath =
  | { kind: "ok"; pathname: string; resolved: string; spaFallback: boolean }
  | { kind: "bad-request" }
  | { kind: "forbidden" };

const CONTENT_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

export function resolveAppPath(rendererRoot: string, rawPathname: string): ResolvedAppPath {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return { kind: "bad-request" };
  }
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  if (pathname === "/motion") pathname = "/index.html";

  const root = path.normalize(rendererRoot);
  const resolved = path.normalize(path.join(root, pathname));
  const rel = path.relative(root, resolved);
  if (rel !== "" && (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))) {
    return { kind: "forbidden" };
  }
  const ext = path.extname(pathname).toLowerCase();
  // Only extensionless routes fall back to the SPA shell; a missing asset is a real 404.
  return { kind: "ok", pathname, resolved, spaFallback: ext === "" || ext === ".html" };
}

export function contentTypeFor(pathname: string): string | null {
  return CONTENT_TYPES[path.extname(pathname).toLowerCase()] ?? null;
}

// Vite emits `name-<hash>.ext`; only those names change when content changes.
// Vite emits a base64url hash (8+ chars); requiring a non-lowercase character keeps
// plain words like "bg-gradient.png" out of the immutable cache.
const HASHED_FILE = /-(?=[A-Za-z0-9_-]*[A-Z0-9_])[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

export function cacheControlFor(pathname: string): string | null {
  if (pathname.startsWith("/assets/") && HASHED_FILE.test(pathname)) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}
