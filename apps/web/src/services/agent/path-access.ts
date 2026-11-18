import { HostFileError, type FileAccessResolveResult, type LocalFileAccess } from "@openreel/agent";

/**
 * Local file access for the MCP path tools (desktop only). The allowed-roots check runs in the main
 * process (`mcp.resolveFiles`); the renderer only reads what main resolved.
 */
export function createLocalFileAccess(): LocalFileAccess | undefined {
  const bridge = typeof window === "undefined" ? undefined : window.openreel;
  const resolveFiles = bridge?.mcp?.resolveFiles;
  const readFileBytes = bridge?.fs?.readFileBytes;
  if (typeof resolveFiles !== "function" || typeof readFileBytes !== "function") return undefined;
  return {
    async resolve(paths, options): Promise<FileAccessResolveResult> {
      return resolveFiles({
        paths: [...paths],
        mode: options?.mode ?? "read",
        ...(options?.recursive ? { recursive: true } : {}),
      });
    },
    async readBytes(realPath): Promise<Uint8Array> {
      return new Uint8Array(await readFileBytes(realPath));
    },
  };
}

export function requireLocalFileAccess(): LocalFileAccess {
  const access = createLocalFileAccess();
  if (!access) {
    throw new HostFileError("UNSUPPORTED", "Local file access is only available in the OpenReel desktop app.", "Run OpenReel desktop.");
  }
  return access;
}

/** Resolve one path; a rejection becomes a HostFileError with the main process's code. */
export async function resolveOne(access: LocalFileAccess, path: string, mode: "read" | "write"): Promise<{ path: string; realPath: string; sizeBytes: number; exists: boolean }> {
  const result = await access.resolve([path], { mode });
  const rejected = result.rejected[0];
  if (rejected) throw new HostFileError(rejected.code, rejected.message);
  const entry = result.resolved.find((file) => file.kind === "file");
  if (!entry) throw new HostFileError("NOT_FOUND", "No file exists at that path.");
  return { path: entry.path, realPath: entry.realPath, sizeBytes: entry.sizeBytes, exists: entry.exists !== false };
}
