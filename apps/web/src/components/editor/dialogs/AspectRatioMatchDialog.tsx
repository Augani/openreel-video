import React from "react";
import { Maximize2 } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const videoAspect = (videoWidth / videoHeight).toFixed(2);
  const currentAspect = (currentWidth / currentHeight).toFixed(2);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && onCancel()}
      width={448}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={t("Match Video Dimensions?")}
            subtitle={t("The video you're adding has different dimensions than your current project settings.")}
            onOpenChange={(open) => !open && onCancel()}
            startContent={<Maximize2 size={20} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
        <div className="space-y-4">
          <div className="space-y-3">
            <Card variant="muted" padding={3}>
              <div>
                <Text type="supporting" color="secondary" display="block" className="mb-1">
                  {t("Video Dimensions")}</Text>
                <Text type="label" weight="bold" display="block">
                  {videoWidth} x {videoHeight}
                </Text>
                <Text type="supporting" color="secondary" display="block" className="mt-0.5">
                  {t("Aspect Ratio: ")}{videoAspect}
                </Text>
              </div>
            </Card>

            <Card variant="default" padding={3} className="border border-border/50">
              <div>
                <Text type="supporting" color="secondary" display="block" className="mb-1">
                  {t("Current Project")}</Text>
                <Text type="label" weight="bold" display="block">
                  {currentWidth} x {currentHeight}
                </Text>
                <Text type="supporting" color="secondary" display="block" className="mt-0.5">
                  {t("Aspect Ratio: ")}{currentAspect}
                </Text>
              </div>
            </Card>
          </div>

          <Text type="supporting" color="secondary" display="block">
            {t("Match the project dimensions to this video for a clean fit, or keep the current canvas. Your video will be placed at its original size so you can resize it freely.")}</Text>
        </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex gap-3">
              <Button
                label={t("Keep Current")}
                variant="secondary"
                className="flex-1"
                onClick={onCancel}
              />
              <Button
                label={t("Match Video")}
                variant="primary"
                className="flex-1"
                onClick={onConfirm}
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
