import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "main/index": "src/main/index.ts",
    "preload/index": "src/preload/index.ts",
    "aurora-host/index": "src/aurora-host/index.ts",
    // Standalone stdio->HTTP MCP shim spawned by external clients (Claude
    // Desktop / Cursor / Cline). Electron-free so it runs under plain node.
    "mcp-shim/index": "src/mcp-shim/index.ts",
  },
  format: ["cjs"],
  platform: "node",
  target: "node18",
  // Only electron is provided by the runtime. Everything else (electron-updater
  // and its transitive deps like fs-extra) is bundled into the main process so
  // the packaged asar needs no JS node_modules — pnpm's symlinked store is not
  // fully copied into the asar, which dropped electron-updater's deps and
  // crashed the app on launch ("Cannot find module 'fs-extra'").
  external: ["electron"],
  noExternal: ["electron-updater", "zod"],
  clean: true,
  sourcemap: true,
});
