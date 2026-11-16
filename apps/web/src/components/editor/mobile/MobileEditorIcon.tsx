// Original SVG paths from the supplied Mobile editor component.
const paths = {
  "edit": "M9 6a3 3 0 1 1-6 0a3 3 0 1 1 6 0M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0M8.1 8.1 12 12M20 4 8.1 15.9M14.8 14.8 20 20",
  "audio": "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0M21 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0",
  "text": "M4 7V4h16v3M9 20h6M12 4v16",
  "captions": "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM10.5 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4",
  "effects": "m21.6 3.6-1.2-1.2a1.2 1.2 0 0 0-1.7 0L2.4 18.6a1.2 1.2 0 0 0 0 1.7l1.2 1.2a1.2 1.2 0 0 0 1.7 0L21.6 5.4a1.2 1.2 0 0 0 0-1.8ZM14 7l3 3",
  "search": "M11 18a7 7 0 1 0 0-14a7 7 0 1 0 0 14M20 20l-3.5-3.5",
  "split": "M12 2v20M4 7h4a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM16 7h4a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z",
  "speed": "M12 21a9 9 0 1 1 9-9M12 12l4-4",
  "volume": "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14",
  "animate": "M13 3l1.5 4.5L19 9l-4.5 1.5L13 15l-1.5-4.5L7 9l4.5-1.5zM3 21l5-5",
  "crop": "M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14",
  "filters": "M9 15a6 6 0 1 0 0-12a6 6 0 1 0 0 12M15 21a6 6 0 1 0 0-12a6 6 0 1 0 0 12",
  "replace": "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  "del": "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  "trim": "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4",
  "reverse": "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  "freeze": "M12 2v20M4.9 4.9l14.2 14.2M2 12h20M4.9 19.1 19.1 4.9",
  "dup": "M9 9h11v11H9zM5 15H4V4h11v1",
  "sfx": "M2 12h2M6 8v8M10 5v14M14 9v6M18 7v10M22 11v2",
  "mic": "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 18v4",
  "noise": "M3 12h3l3-7 4 14 3-7h5",
  "sticker": "M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9.5L21 14.5V5a2 2 0 0 0-2-2zM14 21v-5a2 2 0 0 1 2-2h5",
  "tmpl": "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  "sparkle": "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  "person": "M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8M4 21a8 8 0 0 1 16 0",
  "vertical": "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z",
  "transition": "M3.5 6h6A1.5 1.5 0 0 1 11 7.5v9A1.5 1.5 0 0 1 9.5 18h-6A1.5 1.5 0 0 1 2 16.5v-9A1.5 1.5 0 0 1 3.5 6zM14.5 6h6A1.5 1.5 0 0 1 22 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-6a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 14.5 6z",
  "adjust": "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  "back": "m15 18-6-6 6-6",
  "close": "M6 6l12 12M18 6 6 18",
  "play": "M7 4.5v15l12.5-7.5z",
  "undo": "M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13",
  "redo": "M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13",
  "fullscreen": "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
} as const;

export type MobileEditorIconName = keyof typeof paths;
export function MobileEditorIcon({name, size = 22}: {name: MobileEditorIconName; size?: number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={name === "play" ? "currentColor" : "none"} stroke={name === "play" ? "none" : "currentColor"} strokeWidth={name === "back" || name === "close" || ((name === "sparkle" && size === 15) || (name === "mic" && size === 17)) ? 2 : ["undo", "redo", "fullscreen"].includes(name) ? 1.9 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[name]}/></svg>;
}
