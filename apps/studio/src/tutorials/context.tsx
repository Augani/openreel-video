import { createContext, useContext, useState, type ReactNode } from "react";

interface ActiveTutorial {
  tutorialId: string;
  step: number;
}

interface TutorialCtx {
  active: ActiveTutorial | null;
  start: (tutorialId: string) => void;
  setStep: (step: number) => void;
  exit: () => void;
}

const Ctx = createContext<TutorialCtx | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveTutorial | null>(null);
  const value: TutorialCtx = {
    active,
    start: (tutorialId) => setActive({ tutorialId, step: 0 }),
    setStep: (step) => setActive((a) => (a ? { ...a, step } : a)),
    exit: () => setActive(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTutorial(): TutorialCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTutorial must be used within TutorialProvider");
  return ctx;
}
