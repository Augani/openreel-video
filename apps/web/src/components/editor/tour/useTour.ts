import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { TOUR_STEPS, ONBOARDING_KEY } from "./tour-steps";

interface TourState {
  isActive: boolean;
  currentStep: number;
}

let tourState: TourState = {
  isActive: false,
  currentStep: 0,
};

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): TourState {
  return tourState;
}

function setTourState(updates: Partial<TourState>) {
  tourState = { ...tourState, ...updates };
  emitChange();
}

function readTourCompleted(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== null;
  } catch {
    // Storage blocked: do not nag, the tour stays reachable from Help.
    return true;
  }
}

function writeTourCompleted(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, "true");
  } catch {
    // Storage blocked or full: the tour simply may show again next launch.
  }
}

/**
 * The desktop app never auto-starts the passive tour (first-run onboarding replaces it and an
 * auto-started overlay would steal Esc/Enter from agent and e2e sessions). It stays available from
 * Help > Editor tour. The web build keeps auto-starting it for first-time visitors.
 */
export function shouldAutoStartTour(): boolean {
  if (typeof window !== "undefined" && window.openreel?.platform === "desktop") return false;
  return !readTourCompleted();
}

export function startTour() {
  setTourState({ isActive: true, currentStep: 0 });
}

export function useTour() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const step = TOUR_STEPS[state.currentStep];
  const isFirstStep = state.currentStep === 0;
  const isLastStep = state.currentStep === TOUR_STEPS.length - 1;

  const updateTargetRect = useCallback(() => {
    if (!step?.target) {
      setTargetRect(null);
      return;
    }

    const el = document.querySelector(step.target);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [step?.target]);

  useEffect(() => {
    if (!state.isActive) return;

    updateTargetRect();

    const handleResize = () => updateTargetRect();
    window.addEventListener("resize", handleResize);

    const interval = setInterval(updateTargetRect, 100);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearInterval(interval);
    };
  }, [state.isActive, state.currentStep, updateTargetRect]);

  const start = useCallback(() => {
    setTourState({ currentStep: 0, isActive: true });
  }, []);

  const next = useCallback(() => {
    if (isLastStep) {
      writeTourCompleted();
      setTourState({ isActive: false });
    } else {
      setTourState({ currentStep: state.currentStep + 1 });
    }
  }, [isLastStep, state.currentStep]);

  const prev = useCallback(() => {
    if (!isFirstStep) {
      setTourState({ currentStep: state.currentStep - 1 });
    }
  }, [isFirstStep, state.currentStep]);

  const skip = useCallback(() => {
    writeTourCompleted();
    setTourState({ isActive: false });
  }, []);

  const goToStep = useCallback((index: number) => {
    if (index >= 0 && index < TOUR_STEPS.length) {
      setTourState({ currentStep: index });
    }
  }, []);

  useEffect(() => {
    if (shouldAutoStartTour()) {
      const timer = setTimeout(() => {
        start();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [start]);

  useEffect(() => {
    if (!state.isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        skip();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        next();
      } else if (e.key === "ArrowLeft") {
        prev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.isActive, next, prev, skip]);

  return {
    isActive: state.isActive,
    currentStep: state.currentStep,
    step,
    targetRect,
    isFirstStep,
    isLastStep,
    totalSteps: TOUR_STEPS.length,
    start,
    next,
    prev,
    skip,
    goToStep,
  };
}
