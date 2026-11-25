import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { stripFfmpegPlugin } from "./vite-plugins/strip-ffmpeg";
import { pruneFontsPlugin } from "./vite-plugins/prune-fonts";
import { desktopPreloadPlugin } from "./vite-plugins/desktop-preload";
import { ortRuntimePlugin } from "./vite-plugins/ort-runtime";

const isDesktop = process.env.OPENREEL_DESKTOP === "1";

/**
 * Desktop: the small @openreel/ui components the welcome entry does not use (dialog, dropdown-menu, tabs, slider, toggle, card,
 * input, ...) are shared by the editor and by lazy panels. Each is tiny, so Rollup folded every one into whichever lazy chunk
 * it fell next to (the collaboration session, the watch-folder panel, the plugin manager, the tour, the AI connection status),
 * and the editor then pulled all of those chunks in for one ui component. One chunk of their own keeps those features lazy.
 * Left out: what the entry itself uses (alert, button, label, progress, switch, tooltip) and what imports framer-motion
 * (collapsible, context-menu, select), which must not be dragged onto the entry's path.
 */
const DESKTOP_SHARED_UI = /\/packages\/ui\/src\/(components\/(?!(alert|button|label|progress|switch|tooltip|collapsible|context-menu|select)\.tsx$)[^/]+\.tsx|lib\/pointer-lock\.ts)$/;

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
  plugins: [react(), desktopHtmlPlugin(), stripFfmpegPlugin(isDesktop), pruneFontsPlugin(isDesktop), desktopPreloadPlugin(isDesktop), ortRuntimePlugin()],
  assetsInclude: ["**/*.wasm"],
  resolve: {
    // onnxruntime-web's own switch for "do not bundle the .wasm": every ONNX user fetches the one runtime under ort/ instead.
    conditions: ["onnxruntime-web-use-extern-wasm"],
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
        ...(isDesktop ? { experimentalMinChunkSize: 70_000 } : {}),
        manualChunks: (id) => {
          // Exact package match: a prefix test also caught react-markdown / react-syntax-highlighter, and Rollup then pulled
          // their whole dependency trees (unified, micromark, highlight.js, ~100 KB gzip) into the chunk every page preloads.
          if (/node_modules\/(?:react|react-dom|scheduler)\//.test(id)) return "react";
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
          // Desktop: Vite's dynamic-import helper (__vitePreload) is imported by every chunk that has a dynamic import. Left to Rollup
          // it lands in whichever manual chunk happens to contain a module with a dynamic import (it was the agent text tools chunk,
          // then the three.js renderers), and the whole app, the entry first, then statically imports that chunk for the helper.
          // It is tiny and has no dependencies, so it lives with react, which every page loads first anyway.
          if (isDesktop && id.includes("vite/preload-helper")) return "react";
          // Desktop: the two three.js renderers are lazy (dynamic imports, used only by a 3D layer or text), but
          // experimentalMinChunkSize folded them into the shared engine chunk, which then statically imported
          // the 960 KB three chunk: ~18 ms of compile on every editor open for code a 2D project never runs.
          if (isDesktop && /\/(?:packages\/core\/src\/(?:motion\/motion|video\/overlay)-three-renderer|apps\/web\/src\/components\/editor\/preview\/threejs-layer-renderer)\.ts$/.test(id)) return "three-renderers";
          // ...and their small dependencies that the shared engines also use stay out of that chunk, or a manual chunk
          // would drag them in and the engines would import the renderers (and three) back for them.
          if (isDesktop && /\/packages\/core\/src\/(?:graphics\/shape-path|motion\/motion-object-sampling|motion\/motion-render-quality)\.ts$/.test(id)) return "three-renderer-deps";
          if (isDesktop && DESKTOP_SHARED_UI.test(id)) return "ui-components";
          // The class-name helpers shared by every ui component stay with react: otherwise Rollup moves them into ui-components,
          // which then imports the entry chunk back (a cycle) or the entry imports the ui chunk for them.
          if (isDesktop && (id.includes("node_modules/clsx") || id.includes("node_modules/tailwind-merge") || id.includes("node_modules/class-variance-authority") || id.endsWith("/packages/ui/src/lib/utils.ts"))) return "react";
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
