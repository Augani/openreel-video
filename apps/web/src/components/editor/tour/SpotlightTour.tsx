import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TourPopover } from "./TourPopover";
import { useTour } from "./useTour";

export const SpotlightTour: React.FC = () => {
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
  } = useTour();

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

  return (
    <AnimatePresence mode="wait">
      <div key="tour-overlay" className="fixed inset-0 z-[100] pointer-events-none">
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
              className="fixed pointer-events-none border-2 border-primary rounded-lg"
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
                  "0 0 0 4px rgba(34, 197, 94, 0.2), 0 0 20px rgba(34, 197, 94, 0.3)",
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

        <TourPopover
          step={step}
          targetRect={targetRect}
          currentStep={currentStep}
          totalSteps={totalSteps}
          isFirstStep={isFirstStep}
          isLastStep={isLastStep}
          onNext={next}
          onPrev={prev}
          onSkip={skip}
          onGoToStep={goToStep}
        />
      </div>
    </AnimatePresence>
  );
};

export { useTour } from "./useTour";
