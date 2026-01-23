import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
        NodeJS: "readonly",
        CanvasTextAlign: "readonly",
        CanvasTextBaseline: "readonly",
        CanvasLineCap: "readonly",
        CanvasLineJoin: "readonly",
        CanvasFillRule: "readonly",
        GlobalCompositeOperation: "readonly",
        ImageBitmap: "readonly",
        OffscreenCanvas: "readonly",
        OffscreenCanvasRenderingContext2D: "readonly",
        React: "readonly",
        JSX: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "warn",
      "no-unused-vars": "off",
      "no-empty": "warn",
      "no-case-declarations": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "*.config.js",
      "*.config.ts",
      "vite.config.ts",
    ],
  },
];
