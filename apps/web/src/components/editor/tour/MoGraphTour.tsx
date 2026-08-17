import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMoGraphTour } from "./useMoGraphTour";
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  Lightbulb,
} from "@/icons/lucide-compat";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useTranslation } from "react-i18next";

export const MoGraphTour: React.FC = () => {
  const { t } = useTranslation();
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
              className="fixed pointer-events-none border-2 border-accent rounded-lg"
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
                  "0 0 0 4px var(--accent-soft), 0 0 22px var(--accent-glow)",
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
          className="fixed pointer-events-auto bg-background-secondary border border-accent rounded-xl shadow-2xl overflow-hidden"
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 10 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          style={{
            ...popoverStyle,
            width: 380,
          }}
        >
          <div className="bg-gradient-to-r from-accent to-accent-strong px-4 py-3 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Sparkles size={16} className="text-white" />
            </div>
            <div className="flex-1">
              <Text type="label" weight="semibold" className="text-white text-sm">{t(step.title)}</Text>
              <Text type="supporting" className="text-white/60 text-[10px]">
                {t("Motion Graphics Tour • Step ")}{currentStep + 1} of {totalSteps}
              </Text>
            </div>
            <IconButton
              label={t("Skip tour")}
              icon={<X size={16} />}
              variant="ghost"
              size="sm"
              onClick={skip}
              className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            />
          </div>

          <div className="p-4">
            <Text type="supporting" color="secondary" className="text-text-secondary text-sm leading-relaxed mb-4">
              {t(step.description)}
            </Text>

            {step.tips && step.tips.length > 0 && (
              <div className="bg-accent-soft rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb size={14} className="text-accent" />
                  <span className="text-accent text-xs font-medium">{t("Pro Tips")}</span>
                </div>
                <ul className="space-y-1.5">
                  {step.tips.map((tip, i) => (
                    <li
                      key={i}
                      className="text-text-muted text-xs flex items-start gap-2"
                    >
                      <span className="text-accent mt-0.5">•</span>
                      <span>{t(tip)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2 mb-4">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to step ${i + 1}`}
                  onClick={() => goToStep(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === currentStep
                      ? "w-6 bg-accent"
                      : "w-1.5 bg-border hover:bg-accent/50"
                  }`}
                />
              ))}
            </div>

            <div className="grid grid-cols-[88px_1fr_108px] items-center gap-3">
              <button
                type="button"
                aria-label={t("Back")}
                onClick={prev}
                disabled={isFirstStep}
                className="inline-flex h-9 min-w-[88px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-background-tertiary px-3 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft size={14} className="shrink-0" aria-hidden />
                <span>{t("Back")}</span>
              </button>
              <button
                type="button"
                aria-label={t("Skip tour")}
                onClick={skip}
                className="mx-auto inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg px-3 text-xs font-medium text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-secondary"
              >
                {t("Skip Tour")}</button>
              <button
                type="button"
                aria-label={isLastStep ? t("Get Started") : t("Next")}
                onClick={next}
                className="inline-flex h-9 min-w-[108px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-4 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{isLastStep ? t("Get Started") : t("Next")}</span>
                {!isLastStep && <ChevronRight size={14} className="shrink-0" aria-hidden />}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export { useMoGraphTour, startMoGraphTour, stopMoGraphTour } from "./useMoGraphTour";
