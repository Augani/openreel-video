import type { View } from "../App";

export function StatusBar({ view }: { view: View }) {
  return (
    <footer className="flex h-[22px] items-center gap-3 border-t border-zinc-800 bg-zinc-950 px-4 text-[10px] text-zinc-600">
      {view === "hub" ? (
        <span>Ready</span>
      ) : (
        <>
          <span>● Saved</span>
          <span className="ml-auto">— ms/frame</span>
        </>
      )}
    </footer>
  );
}
