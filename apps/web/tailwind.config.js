const token =
  (name) =>
  ({ opacityValue }) =>
    opacityValue === undefined
      ? `var(--${name})`
      : `color-mix(in srgb, var(--${name}) calc(${opacityValue} * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ── v2 editor tokens (cinematic, emerald)
        //   color-mix preserves alpha modifiers for raw CSS color tokens.
        bg: {
          DEFAULT: token("bg"),
          1: token("bg-1"),
          2: token("bg-2"),
          3: token("bg-3"),
          elev: token("bg-elev"),
        },
        fg: {
          DEFAULT: token("fg"),
          2: token("fg-2"),
          3: token("fg-3"),
          muted: token("fg-muted"),
        },
        "border-strong": token("border-strong"),
        hover: token("hover"),
        selected: token("selected"),
        "stage-bg": token("stage-bg"),
        "tl-bg": token("tl-bg"),
        "track-bg": token("track-bg"),
        waveform: token("waveform"),
        accent: {
          DEFAULT: token("accent"),
          strong: token("accent-strong"),
          soft: token("accent-soft"),
          fg: token("accent-fg"),
          // shadcn primitives (Select/DropdownMenu/ContextMenu/Button) hover
          // with `bg-accent text-accent-foreground`; without this mapping the
          // text color resolved to nothing and disappeared on the emerald
          // hover background. Maps to the on-accent text token.
          foreground: token("accent-fg"),
          glow: token("accent-glow"),
        },
        clip: {
          video: token("c-video"),
          text: token("c-text"),
          audio: token("c-audio"),
          music: token("c-music"),
        },

        // ── shadcn / existing components (HSL with <alpha-value>) ──
        background: {
          DEFAULT: "hsl(var(--background) / <alpha-value>)",
          secondary: token("bg-1"),
          tertiary: token("bg-2"),
          elevated: token("bg-elev"),
        },
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          hover: token("accent-strong"),
          active: token("accent-strong"),
          glow: token("accent-glow"),
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        border: {
          DEFAULT: token("border"),
          hover: token("border-strong"),
          active: token("border-strong"),
        },
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        text: {
          primary: token("fg"),
          secondary: token("fg-2"),
          muted: token("fg-3"),
        },
        status: {
          success: token("accent"),
          warning: "#eab308",
          error: "#ef4444",
          info: "#3b82f6",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Geist Mono", "monospace"],
      },
      boxShadow: {
        sm: token("shadow-sm"),
        md: token("shadow-md"),
        lg: token("shadow-lg"),
        glow: "0 2px 8px var(--accent-glow)",
        "glow-lg": "0 4px 14px var(--accent-glow)",
        panel: token("shadow-md"),
      },
      borderRadius: {
        lg: token("radius"),
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "0.75rem",
        "2xl": "1rem",
      },
      spacing: {
        topbar: token("topbar-h"),
        toolnav: token("toolnav-h"),
        "tl-track": token("tl-track"),
        "tl-rail": token("tl-rail"),
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "1.3" }],
        "xs+": ["10.5px", { lineHeight: "1.35" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: token("radix-accordion-content-height") },
        },
        "accordion-up": {
          from: { height: token("radix-accordion-content-height") },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
