import { Icon } from "../icons";
import { TUTORIALS, type Tutorial } from "./data";

export function Tutorials({ onStart }: { onStart: (t: Tutorial) => void }) {
  return (
    <main className="h-full overflow-y-auto bg-base px-14 py-12">
      <div className="mb-1.5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-2" /> Learn
      </div>
      <h1 className="m-0 mb-2 text-3xl font-semibold tracking-[-0.02em] text-text-primary">From zero to your first effect</h1>
      <p className="m-0 mb-8 max-w-[560px] text-sm leading-[1.5] text-text-secondary">
        Step-by-step, hands-on tutorials inside the real editor. Build it yourself from the palette, or let each step build for you — then watch it validate, compile, and preview.
      </p>

      <div className="grid max-w-[820px] grid-cols-2 gap-4">
        {TUTORIALS.map((t) => (
          <button
            key={t.id}
            onClick={() => onStart(t)}
            className="group flex flex-col gap-2 rounded-lg border border-border bg-panel p-4 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-accent"
          >
            <div className="flex items-center justify-between">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-elev2 text-accent">
                <Icon name={t.kind === "effect" ? "sparkle" : "palette"} size={16} />
              </span>
              <span className="rounded-xl border border-border px-2 py-0.5 text-[9px] uppercase tracking-[0.06em] text-text-tertiary">{t.level} · {t.minutes} min</span>
            </div>
            <div className="text-[14px] font-semibold text-text-primary">{t.title}</div>
            <div className="text-[11px] leading-[1.5] text-text-tertiary">{t.summary}</div>
            <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-accent">Start tutorial →</span>
          </button>
        ))}
      </div>
    </main>
  );
}
