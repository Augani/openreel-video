import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const env = process.env.ALLOWED_HOSTS;
const allowedHosts =
	!env
		? undefined
		: env === "*"
			? true
			: env.split(",").map((h) => h.trim());

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
	assetsInclude: ["**/*.wasm"],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"@openreel/core": path.resolve(__dirname, "../../packages/core/src"),
		},
	},
	worker: {
		format: "es",
	},
	optimizeDeps: {
		exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "@ffmpeg/core", "@ffmpeg/core-mt"],
	},
	build: {
		target: "esnext",
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
						return "react";
					}
					if (id.includes("node_modules/zustand")) {
						return "zustand";
					}
					if (id.includes("node_modules/three")) {
						return "three";
					}
					if (id.includes("node_modules/@radix-ui")) {
						return "radix";
					}
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
		allowedHosts,
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
});
