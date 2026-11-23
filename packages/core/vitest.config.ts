import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // The VR effects' CPU reference and GLSL are a lazy chunk in the app; the unit tests render them directly.
    setupFiles: ["./src/video/vr-runtime.ts"],
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
  resolve: {
    alias: {
      "@openreel/core": path.resolve(__dirname, "./src"),
    },
  },
});
