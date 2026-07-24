import type { ReactNode } from "react";

export type IconName =
  | "search" | "plus" | "minus" | "home" | "folder" | "layers" | "box" | "cpu"
  | "chip" | "play" | "pause" | "chevron" | "chevronDown" | "user" | "image"
  | "video" | "text" | "music" | "sparkle" | "flame" | "droplet" | "contrast"
  | "sun" | "palette" | "eye" | "target" | "person" | "face" | "map" | "wind"
  | "waves" | "refresh" | "settings" | "bell" | "save" | "upload" | "grid"
  | "mouse" | "hand" | "zoomIn" | "zoomOut" | "fit" | "monitor" | "bezier"
  | "crosshair" | "diff" | "function" | "blur" | "copy" | "history" | "sliders"
  | "check" | "x" | "file" | "git" | "cube" | "activity" | "flag";

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

const PATHS: Record<IconName, ReactNode> = {
  search: <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.5-3.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  layers: <g><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5M3 18l9 5 9-5" /></g>,
  box: <g><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></g>,
  cpu: <g><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" /></g>,
  chip: <g><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 9h6v6H9z" /></g>,
  play: <path d="M6 4l14 8-14 8V4z" />,
  pause: <path d="M6 4h4v16H6zM14 4h4v16h-4z" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  user: <g><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></g>,
  image: <g><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></g>,
  video: <g><rect x="3" y="6" width="14" height="12" rx="1" /><path d="M17 10l4-2v8l-4-2z" /></g>,
  text: <g><path d="M4 7V5h16v2" /><path d="M9 5v14M15 5v14" /></g>,
  music: <g><path d="M9 18V6l12-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></g>,
  sparkle: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  flame: <path d="M12 2c1 5 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4-1 3 1 4 2 3-1-3 2-6 1-10z" />,
  droplet: <path d="M12 3l5 7a5 5 0 1 1-10 0z" />,
  contrast: <g><circle cx="12" cy="12" r="9" /><path d="M12 3v18M12 12a9 9 0 0 0 0-9" /></g>,
  sun: <g><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></g>,
  palette: <g><circle cx="9" cy="9" r="1.5" /><circle cx="15" cy="9" r="1.5" /><circle cx="17" cy="14" r="1.5" /><path d="M12 3a9 9 0 0 0 0 18c2 0 2-2 1-3s-1-3 1-3h2a5 5 0 0 0 5-5c0-4-4-7-9-7z" /></g>,
  eye: <g><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></g>,
  target: <g><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></g>,
  person: <g><circle cx="12" cy="6" r="3" /><path d="M5 22c0-4 3-8 7-8s7 4 7 8" /></g>,
  face: <g><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><circle cx="9" cy="10" r="1" /><circle cx="15" cy="10" r="1" /></g>,
  map: <g><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v16M15 6v16" /></g>,
  wind: <path d="M3 8h12a3 3 0 1 0-3-3M3 16h16a3 3 0 1 1-3 3M3 12h18" />,
  waves: <path d="M2 6c3 0 3 2 6 2s3-2 6-2 3 2 6 2M2 12c3 0 3 2 6 2s3-2 6-2 3 2 6 2M2 18c3 0 3 2 6 2s3-2 6-2 3 2 6 2" />,
  refresh: <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />,
  settings: <g><circle cx="12" cy="12" r="3" /><path d="M20 13v-2l-2-.5-.5-1.5 1-1.5-1.5-1.5-1.5 1-1.5-.5L13 4h-2l-.5 2-1.5.5-1.5-1L6 7l1 1.5-.5 1.5L4 11v2l2 .5.5 1.5-1 1.5L7 18l1.5-1 1.5.5L11 20h2l.5-2 1.5-.5 1.5 1L18 17l-1-1.5.5-1.5z" /></g>,
  bell: <path d="M6 8a6 6 0 1 1 12 0v5l1.5 3h-15L6 13zM10 19a2 2 0 1 0 4 0" />,
  save: <g><path d="M4 4h12l4 4v12H4z" /><path d="M7 4v6h9V4M7 20v-6h9v6" /></g>,
  upload: <path d="M12 4v12M6 10l6-6 6 6M4 20h16" />,
  grid: <g><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></g>,
  mouse: <path d="M5 5l6 14 2-6 6-2z" />,
  hand: <path d="M8 12V6a2 2 0 1 1 4 0v6M12 12V4a2 2 0 1 1 4 0v8M16 12V6a2 2 0 1 1 4 0v9a6 6 0 0 1-12 0v-3H8" />,
  zoomIn: <g><circle cx="11" cy="11" r="7" /><path d="M21 21l-3.5-3.5M11 8v6M8 11h6" /></g>,
  zoomOut: <g><circle cx="11" cy="11" r="7" /><path d="M21 21l-3.5-3.5M8 11h6" /></g>,
  fit: <path d="M3 9V5a2 2 0 0 1 2-2h4M3 15v4a2 2 0 0 0 2 2h4M21 9V5a2 2 0 0 0-2-2h-4M21 15v4a2 2 0 0 1-2 2h-4" />,
  monitor: <g><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></g>,
  bezier: <path d="M4 18c0-7 5-12 12-12M4 20l2-2M6 18l-2 2M18 4l2-2M20 6l-2-2" />,
  crosshair: <g><circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18" /></g>,
  diff: <path d="M12 3v18M6 8L3 12l3 4M18 8l3 4-3 4" />,
  function: <g><path d="M9 4c-1 0-2 1-2 2v3h-2v2h2v9c0 1 1 2 2 2" /><path d="M14 11h6M14 15h4" /></g>,
  blur: <g><circle cx="12" cy="12" r="1" /><circle cx="5" cy="12" r="1" opacity=".4" /><circle cx="19" cy="12" r="1" opacity=".4" /><circle cx="8" cy="6" r="1" opacity=".6" /><circle cx="16" cy="6" r="1" opacity=".6" /><circle cx="8" cy="18" r="1" opacity=".6" /><circle cx="16" cy="18" r="1" opacity=".6" /></g>,
  copy: <g><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></g>,
  history: <g><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /><path d="M12 8v5l3 2" /></g>,
  sliders: <g><path d="M4 7h12M20 7h0M4 12h6M14 12h6M4 17h12M20 17h0" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="18" cy="17" r="2" /></g>,
  check: <path d="M5 12l5 5 9-11" />,
  x: <path d="M6 6l12 12M18 6l-12 12" />,
  file: <g><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></g>,
  git: <g><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 8v8M8 18h6c2 0 4-2 4-4M6 6c0 4 6 6 10 6" /></g>,
  cube: <g><path d="M21 8l-9-5-9 5 9 5z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></g>,
  activity: <path d="M3 12h4l3-9 4 18 3-9h4" />,
  flag: <path d="M5 21V4h12l-2 4 2 4H5" />,
};

export function Icon({ name, size = 14, strokeWidth = 1.5, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

export type CatKey =
  | "input" | "detection" | "math" | "sampling" | "color" | "spatial"
  | "composite" | "particles" | "overlays" | "temporal" | "behavior" | "output";

export interface CatMeta {
  label: string;
  color: string;
  icon: IconName;
}

export const CATS: Record<CatKey, CatMeta> = {
  input: { label: "Inputs", color: "var(--cat-input)", icon: "chip" },
  detection: { label: "Detection", color: "var(--cat-detection)", icon: "person" },
  math: { label: "Math", color: "var(--cat-math)", icon: "function" },
  sampling: { label: "Sampling", color: "var(--cat-sampling)", icon: "blur" },
  color: { label: "Color", color: "var(--cat-color)", icon: "palette" },
  spatial: { label: "Spatial", color: "var(--cat-spatial)", icon: "grid" },
  composite: { label: "Composite", color: "var(--cat-composite)", icon: "layers" },
  particles: { label: "Particles", color: "var(--cat-particles)", icon: "sparkle" },
  overlays: { label: "Overlays", color: "var(--cat-overlays)", icon: "image" },
  temporal: { label: "Temporal", color: "var(--cat-temporal)", icon: "history" },
  behavior: { label: "Behavior", color: "var(--cat-behavior)", icon: "activity" },
  output: { label: "Output", color: "var(--cat-output)", icon: "flag" },
};

export type PortType =
  | "texture" | "mask" | "depth" | "landmark" | "float" | "color"
  | "vec2" | "vec3" | "any";

export const TYPE_COLOR: Record<PortType, string> = {
  texture: "var(--type-texture)",
  mask: "var(--type-mask)",
  depth: "var(--type-depth)",
  landmark: "var(--type-landmark)",
  float: "var(--type-float)",
  color: "var(--type-color)",
  vec2: "var(--type-vec)",
  vec3: "var(--type-vec)",
  any: "var(--type-vec)",
};
