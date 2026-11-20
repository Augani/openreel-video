import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { stripFfmpegPlugin } from "./vite-plugins/strip-ffmpeg";
import { pruneFontsPlugin } from "./vite-plugins/prune-fonts";
import { desktopPreloadPlugin } from "./vite-plugins/desktop-preload";

const isDesktop = process.env.OPENREEL_DESKTOP === "1";

function desktopHtmlPlugin() {
  return {
    name: "openreel-desktop-html",
    transformIndexHtml(html: string) {
      if (!isDesktop) return html;
      let out = html
        .replace(/href="\/favicon\.svg"/g, 'href="./favicon.svg"')
        .replace(/href="\/manifest\.json"/g, 'href="./manifest.json"')
        .replace(/href="\/icons\/icon-192\.png"/g, 'href="./icons/icon-192.png"');
      out = out.replace(
        /<link rel="preconnect"[^>]*>\s*/g,
        "",
      );
      out = out.replace(
        /<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g,
        '<link href="./fonts/google-fonts.css" rel="stylesheet" />',
      );
      return out;
    },
  };
}

export default defineConfig({
  base: isDesktop ? "./" : "/",
  plugins: [react(), desktopHtmlPlugin(), stripFfmpegPlugin(isDesktop), pruneFontsPlugin(isDesktop), desktopPreloadPlugin(isDesktop)],
  assetsInclude: ["**/*.wasm"],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      // Profiling aid (perf-harness): React's profiling renderer populates fiber.actualDuration.
      ...(process.env.OPENREEL_REACT_PROFILING === "1"
        ? { "react-dom/client": path.resolve(__dirname, "./node_modules/react-dom/profiling") }
        : {}),
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "@": path.resolve(__dirname, "./src"),
      "@openreel/core": path.resolve(__dirname, "../../packages/core/src"),
      "@openreel/collab": path.resolve(__dirname, "../../packages/collab/src"),
      "@openreel/agent": path.resolve(__dirname, "../../packages/agent/src"),
      "@openreel/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  worker: { format: "es" },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "@ffmpeg/core", "@ffmpeg/core-mt"],
  },
  build: {
    target: "esnext",
    // Profiling aid (perf-harness): keep component names readable in CPU profiles.
    minify: process.env.OPENREEL_NO_MINIFY === "1" ? false : undefined,
    rollupOptions: {
      output: {
        // Desktop: every chunk is a request through the app:// protocol handler and a V8 compile unit, and the
        // core barrel's small shared modules (executor, smart-bins, sequence-par, ...) were each split into a
        // chunk of their own by the lazy dialogs. Fold chunks under this size into their neighbours.
        ...(isDesktop ? { experimentalMinChunkSize: 65_000 } : {}),
        manualChunks: (id) => {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "react";
          if (id.includes("node_modules/zustand")) return "zustand";
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/@radix-ui")) return "radix";
          // Icons are shared by the welcome screen, the editor and a dozen lazy dialogs, so Rollup
          // gave each shared icon its own ~400 byte chunk (20+ requests, 8 of them on the welcome
          // path, each a round trip through the desktop protocol handler). One chunk, one request.
          // Desktop only: over HTTP/2 the tiny chunks are cheap, so the web build keeps its smaller
          // initial closure (bundle-budgets.json).
          if (isDesktop && id.includes("node_modules/lucide-react")) return "icons";
          // Desktop: multicam-workflow is shared by the lazy multicam panel and the agent bridge but is
          // only ~13 KB, so experimentalMinChunkSize folded it into the chunk that also holds the desktop
          // shell's WindowControls, and the welcome screen then statically imported the whole export
          // engine through it. A chunk of its own keeps the shell's closure small.
          if (isDesktop && id.includes("/components/editor/inspector/multicam-workflow")) return "multicam-workflow";
        },
      },
    },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
