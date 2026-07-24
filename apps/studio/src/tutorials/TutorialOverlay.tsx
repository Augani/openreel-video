import { Icon } from "../icons";
import { useTutorial } from "./context";
import { getTutorial } from "./data";

export function TutorialOverlay({ title }: { title?: string }) {
  const { active, setStep, exit } = useTutorial();
  const tutorial = active ? getTutorial(active.tutorialId) : undefined;
  const step = tutorial && active ? tutorial.steps[active.step] : undefined;

  if (!tutorial || !active || !step) return null;

  const isLast = active.step === tutorial.steps.length - 1;

  return (
    <div className="pointer-events-auto absolute bottom-[276px] left-[246px] z-30 w-[360px] rounded-lg border border-accent/50 bg-elev1 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">
          <Icon name="sparkle" size={12} /> Tutorial · {active.step + 1}/{tutorial.steps.length}
        </span>
        <button onClick={exit} className="grid h-5 w-5 place-items-center rounded text-text-tertiary hover:bg-hover hover:text-text-primary"><Icon name="x" size={12} /></button>
      </div>
      <div className="mb-1 text-[13px] font-semibold text-text-primary">{step.title}</div>
      <p className="mb-2.5 text-[11px] leading-[1.55] text-text-secondary">{step.body}</p>

      <div className="flex items-center gap-1.5">
        {active.step > 0 && (
          <button onClick={() => setStep(active.step - 1)} className="rounded border border-border bg-elev2 px-2 py-1 text-[10px] text-text-secondary hover:bg-hover">Back</button>
        )}
        <div className="ml-auto flex gap-1.5">
          {!isLast ? (
            <button
              onClick={() => setStep(active.step + 1)}
              className="rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-white hover:brightness-110"
            >
              Next
            </button>
          ) : (
            <button onClick={exit} className="rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-white hover:brightness-110">Finish</button>
          )}
        </div>
      </div>
      {title !== undefined && isLast && <div className="mt-2 text-[10px] text-text-tertiary">Tip: rename &quot;{title}&quot; and press Submit when you&apos;re happy.</div>}
    </div>
  );
}
