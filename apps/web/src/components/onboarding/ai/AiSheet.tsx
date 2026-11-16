import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles, X } from "@/icons/lucide-compat";
import type { OnboardingSheetProps } from "../types";
import { aiConnectionHydrated, isAIConnectionReady, useAIConnectionStore } from "../../../stores/ai-connection-store";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import ConnectModel from "./ConnectModel";
import DropClips from "./DropClips";
import Describe from "./Describe";
import { handOffToEditorChat } from "./handoff";
import { startProjectWithClips } from "./start-project";
import type { FormatChoice } from "./clips";

export type AiStep = "connect" | "clips" | "describe";

const STEPS: ReadonlyArray<{ id: AiStep; label: string; title: string; subtitle: string }> = [
  {
    id: "connect",
    label: "Connect",
    title: "Pick the AI that will edit for you",
    subtitle: "Choose a provider and add a key, or use a model that runs on this computer.",
  },
  {
    id: "clips",
    label: "Clips",
    title: "Bring your clips",
    subtitle: "Drop the footage you want edited. The project is created for you.",
  },
  {
    id: "describe",
    label: "Describe",
    title: "Describe your video",
    subtitle: "Say what you want in plain language. Every AI turn can be undone in one step.",
  },
];

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function AiSheet({ onClose }: OnboardingSheetProps): JSX.Element {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<AiStep>(() =>
    isAIConnectionReady(useAIConnectionStore.getState()) ? "clips" : "connect",
  );
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const projectId = useRef<string | null>(null);
  const projectFormat = useRef<FormatChoice["id"] | null>(null);

  useEffect(() => {
    useOnboardingStore.getState().start("ai", "ai");
  }, []);
  useEffect(() => {
    // The remembered connection restores asynchronously at startup. If it lands after the sheet
    // opened, skip the connect step instead of asking for a key the user already saved.
    let live = true;
    void aiConnectionHydrated.then(() => {
      if (!live || !isAIConnectionReady(useAIConnectionStore.getState())) return;
      setStep((current) => (current === "connect" ? "clips" : current));
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    useOnboardingStore.getState().setStep(step);
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    // Keydown on the dialog never fires when focus is on <body>, so Tab from there would walk out of
    // the modal. Catch it at the document and pull focus back in.
    const pullBack = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const root = rootRef.current;
      if (!root || root.contains(document.activeElement)) return;
      event.preventDefault();
      headingRef.current?.focus();
    };
    document.addEventListener("keydown", pullBack);
    return () => document.removeEventListener("keydown", pullBack);
  }, []);

  const connected = useAIConnectionStore((s) => isAIConnectionReady(s));
  const rememberError = useAIConnectionStore((s) => s.rememberError);
  const meta = STEPS.find((s) => s.id === step) ?? STEPS[0];
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const close = useCallback((): void => {
    useOnboardingStore.getState().closeSheet();
    onClose();
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    // Focus that is outside the dialog (body, or an element behind it) is pulled back in.
    if (!active || !rootRef.current?.contains(active) || active === rootRef.current) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && (active === first || active === headingRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submitClips = async (files: File[], format: FormatChoice): Promise<void> => {
    setError(null);
    try {
      const result = await startProjectWithClips({
        files,
        format,
        existingProjectId: projectId.current ?? undefined,
        existingFormatId: projectFormat.current ?? undefined,
        onProgress: setProgress,
      });
      projectId.current = result.projectId;
      projectFormat.current = format.id;
      if (result.imported.length === 0) {
        setError(
          result.failed[0]
            ? `Could not import ${result.failed[0].name}: ${result.failed[0].message}`
            : "Nothing could be imported. Try other files.",
        );
        return;
      }
      if (result.failed.length > 0) {
        setProgress(`${result.failed.length} ${result.failed.length === 1 ? "file was" : "files were"} skipped.`);
      }
      setStep("describe");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the project. Try again.");
    }
  };

  const finish = (prompt: string): void => {
    useOnboardingStore.getState().markDone();
    // Not connected ("I'll connect later"): the prompt is kept as a draft in the chat composer.
    void handOffToEditorChat(prompt, { connected });
    onClose();
  };

  const goLearn = (): void => {
    const store = useOnboardingStore.getState();
    store.start("learn", "learn");
    store.showSheet("learn");
  };

  const slide = reduced ? { opacity: 0 } : { opacity: 0, y: 8 };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-sheet-title"
      data-onboarding-sheet="ai"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex flex-col bg-bg pt-11 text-fg"
    >
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-11 border-b border-border bg-bg-1" style={dragRegion} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[640px] px-6 pb-10 pt-8">
          <div className="mb-6 flex items-center justify-between">
            <ol aria-label="Progress" className="flex items-center gap-2 text-xs">
              {STEPS.map((s, i) => {
                const current = s.id === step;
                const done = i < stepIndex;
                return (
                  <li
                    key={s.id}
                    aria-current={current ? "step" : undefined}
                    className="flex items-center gap-2"
                  >
                    <span
                      className={`grid h-5 w-5 place-items-center rounded-full text-2xs font-semibold ${
                        current
                          ? "bg-accent text-accent-fg"
                          : done
                            ? "bg-accent-soft text-accent"
                            : "bg-bg-2 text-fg-3"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className={current ? "font-semibold text-fg" : "text-fg-3"}>{s.label}</span>
                    {i < STEPS.length - 1 && <span aria-hidden="true" className="h-px w-6 bg-border" />}
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              aria-label="Close"
              style={noDrag}
              onClick={close}
              className="grid h-8 w-8 place-items-center rounded-lg text-fg-3 hover:bg-bg-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X size={16} />
            </button>
          </div>

          <motion.div
            key={step}
            initial={slide}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.18, ease: "easeOut" }}
          >
            <div className="mb-6 flex items-start gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                <Sparkles size={18} aria-hidden="true" />
              </span>
              <div>
                <h2
                  id="ai-sheet-title"
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-xl font-semibold tracking-tight text-fg outline-none"
                >
                  {meta.title}
                </h2>
                <p className="mt-1 text-sm text-fg-2">{meta.subtitle}</p>
              </div>
            </div>

            {rememberError && (
              <p role="status" className="mb-4 rounded-lg border border-border bg-bg-1 px-3 py-2 text-xs text-fg-2">
                {rememberError} You can keep going; you will be asked for the key next time.
              </p>
            )}
            {step === "connect" && (
              <ConnectModel
                onContinue={() => setStep("clips")}
                onLearn={goLearn}
                onLater={() => setStep("clips")}
              />
            )}
            {step === "clips" && (
              <DropClips
                onSubmit={submitClips}
                onBack={() => setStep("connect")}
                progress={progress}
                error={error}
              />
            )}
            {step === "describe" && <Describe connected={connected} onSubmit={finish} />}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
