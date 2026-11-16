// Authored SVG paths from Mobile home in new-screens/OpenReel Pro Editor components.html.
const paths = {
  search: "M11 18a7 7 0 1 0 0-14a7 7 0 1 0 0 14M20 20l-3.5-3.5",
  settings: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  plus: "M12 5v14M5 12h14",
  record: "M12 20a8 8 0 1 0 0-16a8 8 0 1 0 0 16M12 15a3 3 0 1 0 0-6a3 3 0 1 0 0 6",
  ai: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  templates: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  projects: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v18M17 3v18M3 12h18",
  learn: "M12 20a8 8 0 1 0 0-16a8 8 0 1 0 0 16M10 9l5 3-5 3z",
};
export function MobileHomeIcon({name}: {name: keyof typeof paths}) {
  const size = name === "plus" ? 26 : 22;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "plus" ? 2.4 : name === "search" ? 2 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[name]}/></svg>;
}
