/** @type {import('tailwindcss').Config} */
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: rgb("--bg-base"),
        panel: rgb("--bg-panel"),
        elev1: rgb("--bg-elev-1"),
        elev2: rgb("--bg-elev-2"),
        inputbg: rgb("--bg-input"),
        hover: rgb("--bg-hover"),
        selected: rgb("--bg-selected"),
        border: {
          subtle: rgb("--b-subtle"),
          DEFAULT: rgb("--b-default"),
          strong: rgb("--b-strong"),
        },
        text: {
          primary: rgb("--t-primary"),
          secondary: rgb("--t-secondary"),
          tertiary: rgb("--t-tertiary"),
          disabled: rgb("--t-disabled"),
        },
        accent: {
          DEFAULT: rgb("--accent"),
          2: rgb("--accent-2"),
        },
        ok: rgb("--ok"),
        warn: rgb("--warn"),
        error: rgb("--error"),
        info: rgb("--info"),
      },
      fontFamily: {
        sans: ['"Geist"', "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      borderRadius: {
        sm: "3px",
        md: "5px",
        lg: "8px",
        xl: "12px",
      },
      boxShadow: {
        node: "0 2px 6px rgba(0,0,0,0.35)",
        "node-selected": "0 0 0 1px rgb(var(--accent)), 0 4px 14px rgba(124,92,255,0.18)",
        float: "0 2px 8px rgba(0,0,0,0.3)",
      },
    },
  },
  plugins: [],
};
