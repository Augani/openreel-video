import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { MOGRAPH_TOUR_STEPS, MOGRAPH_TOUR_KEY } from "./mograph-tour-steps";

interface MoGraphTourState {
  isActive: boolean;
  currentStep: number;
}

let tourState: MoGraphTourState = {
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

function getSnapshot(): MoGraphTourState {
  return tourState;
}

function setTourState(updates: Partial<MoGraphTourState>) {
  tourState = { ...tourState, ...updates };
  emitChange();
}

export function startMoGraphTour() {
  setTourState({ isActive: true, currentStep: 0 });
}

export function stopMoGraphTour() {
  setTourState({ isActive: false });
}

export function isMoGraphTourCompleted(): boolean {
  return localStorage.getItem(MOGRAPH_TOUR_KEY) === "true";
}

export function useMoGraphTour() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const step = MOGRAPH_TOUR_STEPS[state.currentStep];
  const isFirstStep = state.currentStep === 0;
  const isLastStep = state.currentStep === MOGRAPH_TOUR_STEPS.length - 1;

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
      localStorage.setItem(MOGRAPH_TOUR_KEY, "true");
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
    localStorage.setItem(MOGRAPH_TOUR_KEY, "true");
    setTourState({ isActive: false });
  }, []);

  const goToStep = useCallback((index: number) => {
    if (index >= 0 && index < MOGRAPH_TOUR_STEPS.length) {
      setTourState({ currentStep: index });
    }
  }, []);

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
    totalSteps: MOGRAPH_TOUR_STEPS.length,
    start,
    next,
    prev,
    skip,
    goToStep,
  };
}
