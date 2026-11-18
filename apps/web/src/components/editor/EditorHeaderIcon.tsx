/** Authored editor-header paths, shared by browser and native shadcn buttons. */
export function EditorHeaderIcon({ kind }: { kind: "undo" | "redo" | "ai" | "export" | "saved" }) {
  const size = kind === "ai" ? 13 : kind === "export" ? 15 : kind === "saved" ? 14 : 16;
  const paths = {
    undo: ["M3 7v6h6", "M21 17a9 9 0 0 0-15-6.7L3 13"],
    redo: ["M21 7v6h-6", "M3 17a9 9 0 0 1 15-6.7L21 13"],
    ai: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"],
    export: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
    saved: ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z", "m9 14 2 2 4-4"],
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={kind === "export" ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths[kind].map(path => <path key={path} d={path} />)}
  </svg>;
}
