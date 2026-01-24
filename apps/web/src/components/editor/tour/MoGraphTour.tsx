import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMoGraphTour } from "./useMoGraphTour";
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  Lightbulb,
} from "lucide-react";

export const MoGraphTour: React.FC = () => {
  const {
    isActive,
    currentStep,
    step,
    targetRect,
    isFirstStep,
    isLastStep,
    totalSteps,
    next,
    prev,
    skip,
    goToStep,
  } = useMoGraphTour();

  if (!isActive || !step) {
    return null;
  }

  const padding = 12;
  const hasTarget = !!targetRect;

  const spotlightRect = hasTarget
    ? {
        left: targetRect.left - padding,
        top: targetRect.top - padding,
        width: targetRect.width + padding * 2,
        height: targetRect.height + padding * 2,
      }
    : null;

  const getPopoverPosition = () => {
    if (!hasTarget || !spotlightRect) {
      return {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const popoverWidth = 380;
    const gap = 16;

    switch (step.position) {
      case "right":
        return {
          left: spotlightRect.left + spotlightRect.width + gap,
          top: spotlightRect.top + spotlightRect.height / 2,
          transform: "translateY(-50%)",
          maxWidth: window.innerWidth - spotlightRect.left - spotlightRect.width - gap - 20,
        };
      case "left":
        return {
          left: spotlightRect.left - gap,
          top: spotlightRect.top + spotlightRect.height / 2,
          transform: "translate(-100%, -50%)",
          maxWidth: spotlightRect.left - gap - 20,
        };
      case "top":
        return {
          left: spotlightRect.left + spotlightRect.width / 2,
          top: spotlightRect.top - gap,
          transform: "translate(-50%, -100%)",
          maxWidth: popoverWidth,
        };
      case "bottom":
        return {
          left: spotlightRect.left + spotlightRect.width / 2,
          top: spotlightRect.top + spotlightRect.height + gap,
          transform: "translateX(-50%)",
          maxWidth: popoverWidth,
        };
      default:
        return {
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          maxWidth: popoverWidth,
        };
    }
  };

  const popoverStyle = getPopoverPosition();

  return (
    <AnimatePresence mode="wait">
      <div key="mograph-tour-overlay" className="fixed inset-0 z-[100] pointer-events-none">
        {hasTarget && spotlightRect ? (
          <>
            <motion.div
              key={`top-${currentStep}`}
              className="fixed left-0 right-0 top-0 bg-black/80 pointer-events-auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, height: spotlightRect.top }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={skip}
            />
            <motion.div
              key={`bottom-${currentStep}`}
              className="fixed left-0 right-0 bottom-0 bg-black/80 pointer-events-auto"
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                height: window.innerHeight - spotlightRect.top - spotlightRect.height,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={skip}
            />
            <motion.div
              key={`left-${currentStep}`}
              className="fixed left-0 bg-black/80 pointer-events-auto"
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                top: spotlightRect.top,
                width: spotlightRect.left,
                height: spotlightRect.height,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={skip}
            />
            <motion.div
              key={`right-${currentStep}`}
              className="fixed right-0 bg-black/80 pointer-events-auto"
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                top: spotlightRect.top,
                width: window.innerWidth - spotlightRect.left - spotlightRect.width,
                height: spotlightRect.height,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={skip}
            />
            <motion.div
              key={`ring-${currentStep}`}
              className="fixed pointer-events-none border-2 border-purple-500 rounded-lg"
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{
                opacity: 1,
                scale: 1,
                left: spotlightRect.left,
                top: spotlightRect.top,
                width: spotlightRect.width,
                height: spotlightRect.height,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              style={{
                boxShadow:
                  "0 0 0 4px rgba(168, 85, 247, 0.2), 0 0 20px rgba(168, 85, 247, 0.3)",
              }}
            />
          </>
        ) : (
          <motion.div
            key="full-overlay"
            className="fixed inset-0 bg-black/80 pointer-events-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={skip}
          />
        )}

        <motion.div
          key={`popover-${currentStep}`}
          className="fixed pointer-events-auto bg-background-secondary border border-purple-500/30 rounded-xl shadow-2xl overflow-hidden"
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 10 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          style={{
            ...popoverStyle,
            width: 380,
          }}
        >
          <div className="bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-3 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Sparkles size={16} className="text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold text-sm">{step.title}</h3>
              <p className="text-white/60 text-[10px]">
                Motion Graphics Tour • Step {currentStep + 1} of {totalSteps}
              </p>
            </div>
            <button
              onClick={skip}
              className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-4">
            <p className="text-text-secondary text-sm leading-relaxed mb-4">
              {step.description}
            </p>

            {step.tips && step.tips.length > 0 && (
              <div className="bg-purple-500/10 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb size={14} className="text-purple-400" />
                  <span className="text-purple-400 text-xs font-medium">Pro Tips</span>
                </div>
                <ul className="space-y-1.5">
                  {step.tips.map((tip, i) => (
                    <li
                      key={i}
                      className="text-text-muted text-xs flex items-start gap-2"
                    >
                      <span className="text-purple-400 mt-0.5">•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2 mb-4">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => goToStep(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === currentStep
                      ? "w-6 bg-purple-500"
                      : "w-1.5 bg-border hover:bg-purple-500/50"
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={prev}
                disabled={isFirstStep}
                className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg bg-background-tertiary text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} />
                Back
              </button>
              <div className="flex-1" />
              <button
                onClick={skip}
                className="px-3 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Skip Tour
              </button>
              <button
                onClick={next}
                className="flex items-center gap-1 px-4 py-2 text-xs rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium hover:from-purple-500 hover:to-pink-500 transition-all"
              >
                {isLastStep ? "Get Started" : "Next"}
                {!isLastStep && <ChevronRight size={14} />}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export { useMoGraphTour, startMoGraphTour, stopMoGraphTour } from "./useMoGraphTour";
