import React, { useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronLeft,
  Play,
  Scissors,
  Layers,
  Wand2,
  Download,
  HelpCircle,
} from "lucide-react";
import { Dialog, DialogContent } from "@openreel/ui";

interface OnboardingOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  tips: string[];
  highlight?: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to OpenReel",
    description:
      "A professional video editor right in your browser. Let's take a quick tour of the key features.",
    icon: <Wand2 size={32} className="text-primary" />,
    tips: [
      "No installation required - everything runs in your browser",
      "Your projects are saved locally and never leave your device",
      "Works offline once loaded",
    ],
  },
  {
    id: "import",
    title: "Import Media",
    description:
      "Drag and drop files into the Assets Panel or click the import button to add your media.",
    icon: <Layers size={32} className="text-blue-400" />,
    tips: [
      "Supports video, audio, and image files",
      "Drag files directly onto the timeline to add them",
      "Use the library to organize your assets",
    ],
    highlight: "assets",
  },
  {
    id: "timeline",
    title: "Timeline Editing",
    description:
      "The timeline is where you arrange and edit your clips. Drag clips to move them, drag edges to trim.",
    icon: <Scissors size={32} className="text-green-400" />,
    tips: [
      "Press S to split a clip at the playhead",
      "Press Space to play/pause",
      "Use [ and ] to jump between clip edges",
      "Hold Shift and drag to ripple edit",
    ],
    highlight: "timeline",
  },
  {
    id: "playback",
    title: "Preview & Playback",
    description:
      "The preview panel shows your video in real-time. Use keyboard shortcuts for precise navigation.",
    icon: <Play size={32} className="text-purple-400" />,
    tips: [
      "Arrow keys for frame-by-frame navigation",
      "Home/End to jump to start/end",
      "Press ? to see all keyboard shortcuts",
    ],
    highlight: "preview",
  },
  {
    id: "effects",
    title: "Effects & Color",
    description:
      "Select a clip and use the Inspector to add effects, adjust color grading, and apply filters.",
    icon: <Wand2 size={32} className="text-yellow-400" />,
    tips: [
      "Use the Color Grading panel for professional color correction",
      "Add transitions between clips by dragging them",
      "Keyframe any property for animations",
    ],
    highlight: "inspector",
  },
  {
    id: "export",
    title: "Export Your Video",
    description:
      "When you're done, export your project with presets for YouTube, TikTok, and more.",
    icon: <Download size={32} className="text-red-400" />,
    tips: [
      "Choose from platform-specific presets",
      "Custom export settings for full control",
      "Export audio-only or image sequences",
    ],
  },
];

const ONBOARDING_KEY = "openreel-onboarding-complete";

export const OnboardingOverlay: React.FC<OnboardingOverlayProps> = ({
  isOpen,
  onClose,
  onComplete,
}) => {
  const [currentStep, setCurrentStep] = useState(0);

  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
  const isFirstStep = currentStep === 0;

  const handleNext = () => {
    if (isLastStep) {
      localStorage.setItem(ONBOARDING_KEY, "true");
      onComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && handleSkip()}>
      <DialogContent className="max-w-lg p-0 gap-0 bg-background-secondary border-border overflow-hidden">
        <div className="relative p-8 text-center">

          <div className="flex justify-center mb-6">{step.icon}</div>

          <h2 className="text-2xl font-bold text-text-primary mb-3">
            {step.title}
          </h2>

          <p className="text-text-secondary mb-6">{step.description}</p>

          <div className="text-left bg-background-tertiary rounded-lg p-4 mb-6">
            <ul className="space-y-2">
              {step.tips.map((tip, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2 text-sm text-text-secondary"
                >
                  <span className="text-primary mt-0.5">•</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-center gap-2 mb-6">
            {ONBOARDING_STEPS.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentStep(index)}
                className={`w-2 h-2 rounded-full transition-colors ${
                  index === currentStep ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border bg-background-tertiary">
          <button
            onClick={handlePrev}
            disabled={isFirstStep}
            className="flex items-center gap-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} />
            Back
          </button>

          <button
            onClick={handleSkip}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            Skip Tour
          </button>

          <button
            onClick={handleNext}
            className="flex items-center gap-1 px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/80 transition-colors"
          >
            {isLastStep ? "Get Started" : "Next"}
            {!isLastStep && <ChevronRight size={16} />}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export function useOnboarding(): {
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  isFirstVisit: boolean;
} {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(ONBOARDING_KEY);
    if (!completed) {
      setIsFirstVisit(true);
      setShowOnboarding(true);
    }
  }, []);

  return { showOnboarding, setShowOnboarding, isFirstVisit };
}

export function HelpButton({
  onClick,
}: {
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="p-2 rounded-lg hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
      title="Help & Tour"
    >
      <HelpCircle size={18} />
    </button>
  );
}

export default OnboardingOverlay;
