import { Icon, type IconName } from "../icons";
import { RecentProjects } from "./RecentProjects";
import { PresetGallery } from "./PresetGallery";

export interface HubCommands {
  newEffect(): void;
  newFilter(): void;
  newTemplate(): void;
  openPreset(id: string): void;
  openRecent(id: string): void;
  openTutorials(): void;
}

export function Hub({ commands }: { commands: HubCommands }) {
  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="mx-auto max-w-5xl px-8 py-10">
        <h1 className="mb-6 text-xl font-medium text-zinc-100">Studio</h1>

        <section className="mb-10">
          <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Start something new</h2>
          <div className="grid grid-cols-3 gap-3">
            <Tile icon="sparkle" title="Effect" description="Subject-aware VFX" onClick={commands.newEffect} />
            <Tile icon="palette" title="Filter" description="Color & stylize" onClick={commands.newFilter} />
            <Tile icon="layers" title="Template" description="Multi-clip recipe" onClick={commands.newTemplate} />
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Continue your work</h2>
          <RecentProjects onOpen={commands.openRecent} onNew={commands.newEffect} />
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Start from a preset</h2>
          <PresetGallery onOpen={commands.openPreset} />
        </section>

        <footer className="mt-12 flex justify-center gap-6 text-xs text-zinc-600">
          <button type="button" onClick={commands.openTutorials} className="hover:text-zinc-300">Tutorials</button>
          <span>·</span>
          <span>Docs</span>
          <span>·</span>
          <span>Marketplace (coming soon)</span>
        </footer>
      </div>
    </div>
  );
}

function Tile({ icon, title, description, onClick }: { icon: IconName; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-5 text-left hover:border-zinc-600 hover:bg-zinc-800"
    >
      <Icon name={icon} size={24} className="text-zinc-300" />
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-xs text-zinc-500">{description}</div>
      </div>
    </button>
  );
}
