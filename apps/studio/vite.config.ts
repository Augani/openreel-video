import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.wasm"],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@openreel/core": path.resolve(__dirname, "../../packages/core/src"),
      "@openreel/fxpkg": path.resolve(__dirname, "../../packages/fxpkg/src"),
      "@openreel/i18n/react": path.resolve(__dirname, "../../packages/i18n/src/react.ts"),
      "@openreel/i18n/translate": path.resolve(__dirname, "../../packages/i18n/src/translate.ts"),
      "@openreel/i18n": path.resolve(__dirname, "../../packages/i18n/src"),
      "@openreel/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "@ffmpeg/core", "@ffmpeg/core-mt"],
  },
  server: {
    port: 5174,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "esnext",
  },
});
