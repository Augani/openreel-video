import type { HtmlTagDescriptor, Plugin } from "vite";

interface ChunkLike {
  type: string;
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: string[];
}

/**
 * Files to `modulepreload` from the desktop shell's index.html beyond what Vite already adds
 * (the entry chunk's own static closure).
 *
 * The desktop entry imports its shell with `import("./desktop/DesktopApp")`. A dynamic import is not
 * discovered until the entry chunk has been fetched, compiled and evaluated (~50 ms of evaluation),
 * so the shell chunk and its icon chunks were requested ~115 ms after the entry's own request
 * (measured in a Chromium trace: entry request at 202 ms, DesktopApp at 318 ms). Preloading the
 * shell's static closure from the HTML puts those requests in flight next to the entry's, which
 * moves the welcome screen's critical path from three sequential fetch rounds to two.
 */
export function desktopPreloadFiles(bundle: Record<string, ChunkLike>, shellSuffix = "/desktop/DesktopApp.tsx"): string[] {
  const chunks = Object.values(bundle).filter((chunk) => chunk.type === "chunk");
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const shell = chunks.find((chunk) => chunk.facadeModuleId?.endsWith(shellSuffix));
  if (!shell) return [];

  const closure = (root: ChunkLike): Set<string> => {
    const seen = new Set<string>();
    const walk = (chunk: ChunkLike): void => {
      if (seen.has(chunk.fileName)) return;
      seen.add(chunk.fileName);
      for (const imported of chunk.imports ?? []) {
        const next = byName.get(imported);
        if (next) walk(next);
      }
    };
    walk(root);
    return seen;
  };

  const entry = chunks.find((chunk) => chunk.isEntry);
  const alreadyPreloaded = entry ? closure(entry) : new Set<string>();
  return [...closure(shell)].filter((file) => !alreadyPreloaded.has(file));
}

export function desktopPreloadPlugin(isDesktop: boolean): Plugin {
  return {
    name: "openreel-desktop-preload",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        if (!isDesktop || !ctx.bundle) return undefined;
        const files = desktopPreloadFiles(ctx.bundle as unknown as Record<string, ChunkLike>);
        return files.map<HtmlTagDescriptor>((file) => ({
          tag: "link",
          attrs: { rel: "modulepreload", crossorigin: true, href: `./${file}` },
          injectTo: "head",
        }));
      },
    },
  };
}
