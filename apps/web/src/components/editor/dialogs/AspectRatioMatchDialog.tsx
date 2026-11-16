import React from "react";
import { Maximize2, X } from "@/icons/lucide-compat";
import {
  Button, Card, Checkbox, Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@openreel/ui";

interface AspectRatioMatchDialogProps {
  isOpen: boolean;
  videoWidth: number;
  videoHeight: number;
  currentWidth: number;
  currentHeight: number;
  /** The sequence has text, shape, SVG or template graphics that can follow the new frame. */
  hasGraphics?: boolean;
  scaleGraphics?: boolean;
  onScaleGraphicsChange?: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AspectRatioMatchDialog: React.FC<AspectRatioMatchDialogProps> = ({
  isOpen,
  videoWidth,
  videoHeight,
  currentWidth,
  currentHeight,
  hasGraphics = false,
  scaleGraphics = true,
  onScaleGraphicsChange,
  onConfirm,
  onCancel,
}) => {
  const videoAspect = (videoWidth / videoHeight).toFixed(2);
  const currentAspect = (currentWidth / currentHeight).toFixed(2);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent hideCloseButton className="flex max-h-[90vh] w-[calc(100vw-32px)] max-w-[448px] flex-col gap-0 overflow-hidden border-border bg-bg-1 p-0 text-fg shadow-xl">
        <DialogHeader className="flex-row items-start gap-3 space-y-0 border-b border-border px-5 py-4 text-left">
          <Maximize2 size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[15px] font-semibold leading-5 text-fg">Match Video Dimensions?</DialogTitle>
            <DialogDescription className="mt-1 text-[12px] leading-4 text-fg-muted">The video you're adding has different dimensions than your current project settings.</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close dialog" className="h-7 w-7 shrink-0 rounded-[7px] text-fg-muted hover:bg-bg-2 hover:text-fg [&_svg]:size-[15px]">
              <X size={15} aria-hidden />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="space-y-4">
            <div className="space-y-3">
              <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3">
                <span className="text-[12px] leading-5 text-fg-2 font-normal block mb-1">Video Dimensions</span>
                <span className="text-[12px] leading-4 text-fg-2 font-bold block">{videoWidth} x {videoHeight}</span>
                <span className="text-[12px] leading-5 text-fg-2 font-normal block mt-0.5">Aspect Ratio: {videoAspect}</span>
              </Card>
              <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-1 text-fg p-3 border border-border/50">
                <span className="text-[12px] leading-5 text-fg-2 font-normal block mb-1">Current Project</span>
                <span className="text-[12px] leading-4 text-fg-2 font-bold block">{currentWidth} x {currentHeight}</span>
                <span className="text-[12px] leading-5 text-fg-2 font-normal block mt-0.5">Aspect Ratio: {currentAspect}</span>
              </Card>
            </div>
            <p className="text-[12px] leading-5 text-fg-2 font-normal">
              Match the project dimensions to this video for a clean fit, or keep
              the current canvas. Your video will be placed at its original size
              so you can resize it freely.
            </p>
            {hasGraphics && onScaleGraphicsChange && (
              <label className="flex cursor-pointer items-start gap-2 rounded-[7px] bg-bg-2 p-3 text-[12px] leading-4 text-fg-2">
                <Checkbox
                  checked={scaleGraphics}
                  aria-label="Scale graphics to new frame size"
                  onCheckedChange={(value) => onScaleGraphicsChange(value === true)}
                  className="mt-px"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-fg">Scale graphics to new frame size</span>
                  <span className="mt-0.5 block text-fg-muted">Titles, text, shapes and templates keep their proportion to the frame. Match Video and the scaling are one undo step.</span>
                </span>
              </label>
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0 items-center justify-end border-t border-border bg-bg-1 px-5 py-4">
          <div className="flex gap-3">
            <Button onClick={onCancel} type="button" variant="outline" className="h-8 min-w-0 flex-1 rounded-[7px] border-border bg-bg-2 px-3 text-[12px] font-semibold text-fg-2 hover:bg-bg-3 hover:text-fg">Keep Current</Button>
            <Button onClick={onConfirm} type="button" className="h-8 min-w-0 flex-1 rounded-[7px] bg-accent px-3 text-[12px] font-semibold text-accent-fg hover:bg-accent/90">Match Video</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
