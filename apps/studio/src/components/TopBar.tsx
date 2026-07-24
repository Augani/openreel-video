import { Logo } from "./Logo";
import { Menubar } from "./Menubar";
import type { View, ProjectState } from "../App";

export function TopBar({ project, view, onHome }: { project: ProjectState; view: View; onHome: () => void }) {
  return (
    <header className="flex h-10 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4 text-xs text-zinc-300">
      <button type="button" onClick={onHome} className="flex items-center gap-2">
        <Logo size={16} className="text-zinc-300" />
        <span className="text-zinc-500">Studio</span>
      </button>
      {view !== "hub" && <span className="text-zinc-700">›</span>}
      {view !== "hub" && <span>{project.name}</span>}
      <div className="ml-auto flex items-center gap-2">
        <Menubar view={view} />
      </div>
    </header>
  );
}
