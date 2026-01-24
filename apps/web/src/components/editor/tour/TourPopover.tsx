import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { TourStep } from "./tour-steps";

interface TourPopoverProps {
  step: TourStep;
  targetRect: DOMRect | null;
  currentStep: number;
  totalSteps: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onGoToStep: (index: number) => void;
}

const POPOVER_WIDTH = 320;
const POPOVER_MARGIN = 16;
const ARROW_SIZE = 8;

export const TourPopover: React.FC<TourPopoverProps> = ({
  step,
  targetRect,
  currentStep,
  totalSteps,
  isFirstStep,
  isLastStep,
  onNext,
  onPrev,
  onSkip,
  onGoToStep,
}) => {
  const { position: computedPosition, arrowPosition } = useMemo(() => {
    if (!targetRect || step.position === "center") {
      return { position: { x: 0, y: 0 }, arrowPosition: null };
    }

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let x = 0;
    let y = 0;
    let arrow: "top" | "bottom" | "left" | "right" | null = null;

    const padding = 12;
    const rect = {
      left: targetRect.left - padding,
      top: targetRect.top - padding,
      right: targetRect.right + padding,
      bottom: targetRect.bottom + padding,
      width: targetRect.width + padding * 2,
      height: targetRect.height + padding * 2,
    };

    switch (step.position) {
      case "right":
        x = rect.right + POPOVER_MARGIN;
        y = rect.top + rect.height / 2 - 100;
        arrow = "left";
        break;
      case "left":
        x = rect.left - POPOVER_WIDTH - POPOVER_MARGIN;
        y = rect.top + rect.height / 2 - 100;
        arrow = "right";
        break;
      case "top":
        x = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
        y = rect.top - 200 - POPOVER_MARGIN;
        arrow = "bottom";
        break;
      case "bottom":
        x = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
        y = rect.bottom + POPOVER_MARGIN;
        arrow = "top";
        break;
    }

    x = Math.max(POPOVER_MARGIN, Math.min(x, viewport.width - POPOVER_WIDTH - POPOVER_MARGIN));
    y = Math.max(POPOVER_MARGIN, Math.min(y, viewport.height - 250));

    return { position: { x, y }, arrowPosition: arrow };
  }, [targetRect, step.position]);

  const isCentered = step.position === "center" || !targetRect;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`fixed z-[102] ${isCentered ? "inset-0 flex items-center justify-center pointer-events-none" : ""}`}
      style={
        isCentered
          ? undefined
          : {
              left: computedPosition.x,
              top: computedPosition.y,
              width: POPOVER_WIDTH,
            }
      }
    >
      <div
        className="relative bg-background-secondary border border-border rounded-xl shadow-2xl pointer-events-auto"
        style={{ width: isCentered ? POPOVER_WIDTH : "100%" }}
      >
        {arrowPosition && !isCentered && (
          <div
            className="absolute w-0 h-0"
            style={{
              ...(arrowPosition === "left" && {
                left: -ARROW_SIZE,
                top: "50%",
                transform: "translateY(-50%)",
                borderTop: `${ARROW_SIZE}px solid transparent`,
                borderBottom: `${ARROW_SIZE}px solid transparent`,
                borderRight: `${ARROW_SIZE}px solid var(--border)`,
              }),
              ...(arrowPosition === "right" && {
                right: -ARROW_SIZE,
                top: "50%",
                transform: "translateY(-50%)",
                borderTop: `${ARROW_SIZE}px solid transparent`,
                borderBottom: `${ARROW_SIZE}px solid transparent`,
                borderLeft: `${ARROW_SIZE}px solid var(--border)`,
              }),
              ...(arrowPosition === "top" && {
                top: -ARROW_SIZE,
                left: "50%",
                transform: "translateX(-50%)",
                borderLeft: `${ARROW_SIZE}px solid transparent`,
                borderRight: `${ARROW_SIZE}px solid transparent`,
                borderBottom: `${ARROW_SIZE}px solid var(--border)`,
              }),
              ...(arrowPosition === "bottom" && {
                bottom: -ARROW_SIZE,
                left: "50%",
                transform: "translateX(-50%)",
                borderLeft: `${ARROW_SIZE}px solid transparent`,
                borderRight: `${ARROW_SIZE}px solid transparent`,
                borderTop: `${ARROW_SIZE}px solid var(--border)`,
              }),
            }}
          />
        )}

        <button
          onClick={onSkip}
          className="absolute top-3 right-3 p-1 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
        >
          <X size={14} />
        </button>

        <div className="p-6">
          <motion.h2
            key={`title-${currentStep}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg font-bold text-text-primary mb-2"
          >
            {step.title}
          </motion.h2>

          <motion.p
            key={`desc-${currentStep}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-sm text-text-secondary mb-4"
          >
            {step.description}
          </motion.p>

          {step.tips && step.tips.length > 0 && (
            <motion.div
              key={`tips-${currentStep}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-background-tertiary rounded-lg p-3 mb-4"
            >
              <ul className="space-y-1.5">
                {step.tips.map((tip, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2 text-xs text-text-secondary"
                  >
                    <span className="text-primary mt-0.5">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}

          <div className="flex items-center justify-center gap-1.5 mb-4">
            {Array.from({ length: totalSteps }).map((_, index) => (
              <button
                key={index}
                onClick={() => onGoToStep(index)}
                className={`w-2 h-2 rounded-full transition-all ${
                  index === currentStep
                    ? "bg-primary scale-110"
                    : "bg-border hover:bg-text-muted"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-background-tertiary rounded-b-xl">
          <button
            onClick={onPrev}
            disabled={isFirstStep}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} />
            Back
          </button>

          <button
            onClick={onSkip}
            className="px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            Skip Tour
          </button>

          <button
            onClick={onNext}
            className="flex items-center gap-1 px-4 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/80 transition-colors"
          >
            {isLastStep ? "Get Started" : "Next"}
            {!isLastStep && <ChevronRight size={14} />}
          </button>
        </div>
      </div>
    </motion.div>
  );
};
