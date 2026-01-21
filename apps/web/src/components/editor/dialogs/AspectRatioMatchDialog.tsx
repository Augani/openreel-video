import React from "react";
import { Maximize2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
} from "@openreel/ui";

interface AspectRatioMatchDialogProps {
  isOpen: boolean;
  videoWidth: number;
  videoHeight: number;
  currentWidth: number;
  currentHeight: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AspectRatioMatchDialog: React.FC<AspectRatioMatchDialogProps> = ({
  isOpen,
  videoWidth,
  videoHeight,
  currentWidth,
  currentHeight,
  onConfirm,
  onCancel,
}) => {
  const videoAspect = (videoWidth / videoHeight).toFixed(2);
  const currentAspect = (currentWidth / currentHeight).toFixed(2);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Maximize2 size={20} className="text-primary" />
            </div>
            <div>
              <DialogTitle>Match Video Dimensions?</DialogTitle>
              <DialogDescription className="mt-1">
                The video you're adding has different dimensions than your current project settings.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary">
              <div>
                <div className="text-xs text-text-tertiary mb-1">
                  Video Dimensions
                </div>
                <div className="text-sm font-medium text-text-primary">
                  {videoWidth} × {videoHeight}
                </div>
                <div className="text-xs text-text-tertiary mt-0.5">
                  Aspect Ratio: {videoAspect}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary/50 border border-border/50">
              <div>
                <div className="text-xs text-text-tertiary mb-1">
                  Current Project
                </div>
                <div className="text-sm font-medium text-text-primary">
                  {currentWidth} × {currentHeight}
                </div>
                <div className="text-xs text-text-tertiary mt-0.5">
                  Aspect Ratio: {currentAspect}
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs text-text-tertiary">
            Updating the project dimensions will provide the best editing
            experience and prevent cropping during export.
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Keep Current
          </Button>
          <Button className="flex-1" onClick={onConfirm}>
            Match Video
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
