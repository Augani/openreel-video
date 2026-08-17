import type { JSX } from "react";
import { useEffect, useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftEmptyState as EmptyState } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftSpinner as Spinner } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useProjectStore } from "../../../../stores/project-store";
import { useUIStore } from "../../../../stores/ui-store";
import { loadMediaBlob } from "../../../../services/media-storage";
import { submitSelectedClipJob } from "../../../../services/gpu-clip-submit";
import { SelectionCanvas } from "../photo-tools/SelectionCanvas";
import type { BBox } from "../photo-tools/object-removal-params";
import { useTranslation } from "react-i18next";

function captureFrame(blob: Blob, time: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    const cleanup = (): void => URL.revokeObjectURL(url);

    video.addEventListener("error", () => {
      cleanup();
      reject(new Error("Could not decode this video in the browser"));
    });

    video.addEventListener(
      "loadeddata",
      () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const seekTo = Math.min(Math.max(0, time), Math.max(0, duration - 0.05));
        video.addEventListener(
          "seeked",
          () => {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext("2d");
              if (!ctx || canvas.width === 0) {
                cleanup();
                reject(new Error("Could not read a video frame"));
                return;
              }
              ctx.drawImage(video, 0, 0);
              const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
              cleanup();
              resolve(dataUrl);
            } catch (e) {
              cleanup();
              reject(e instanceof Error ? e : new Error("Frame capture failed"));
            }
          },
          { once: true },
        );
        video.currentTime = seekTo;
      },
      { once: true },
    );
  });
}

interface ObjectTrackingEditorProps {
  onClose: () => void;
}

export function ObjectTrackingEditor({ onClose }: ObjectTrackingEditorProps): JSX.Element {
  const { t } = useTranslation();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bbox, setBBox] = useState<BBox | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const selected = useUIStore.getState().getSelectedClipIds();
        if (selected.length !== 1) throw new Error("Select a single video clip first");
        const clip = useProjectStore.getState().getClip(selected[0]);
        const mediaId = clip?.mediaId;
        if (!mediaId) throw new Error("Select a video clip first");
        const item = useProjectStore.getState().getMediaItem(mediaId);
        let blob = item?.blob ?? null;
        if (!blob) blob = await loadMediaBlob(mediaId);
        if (!blob) throw new Error("Could not load the video");
        const url = await captureFrame(blob, clip?.inPoint ?? 0);
        if (!cancelled) setImageUrl(url);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (): Promise<void> => {
    setError(null);
    if (!bbox || bbox.w <= 0 || bbox.h <= 0) {
      setError("Draw a box around the object to track");
      return;
    }
    setBusy(true);
    try {
      await submitSelectedClipJob({
        kind: "object_tracking",
        params: { initialBox: { x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h } },
        suggestedName: "Object tracking",
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      width={672}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={t("Object Tracking")}
            subtitle={t("Draw a box around the object to track across the clip.")}
            onOpenChange={(open) => !open && onClose()}
          />
        }
        content={
          <LayoutContent>
            {loadError ? (
              <Card variant="red" padding={4}>
                <Text type="supporting" className="text-red-300">
                  {loadError}
                </Text>
              </Card>
            ) : !imageUrl ? (
              <EmptyState
                title={t("Loading frame...")}
                icon={<Spinner size="md" />}
                isCompact
              />
            ) : (
              <div className="space-y-3">
                <SelectionCanvas
                  imageUrl={imageUrl}
                  tool="box"
                  bbox={bbox}
                  points={[]}
                  onBBoxChange={setBBox}
                  onPointsChange={() => {}}
                />
                <Text type="supporting" color="secondary" display="block" className="text-[11px]">
                  {t("Afterward, attach text or graphics to it in the Motion Tracking panel.")}</Text>
                {error && (
                  <Card variant="red" padding={2}>
                    <Text type="supporting" className="text-red-200">
                      {error}
                    </Text>
                  </Card>
                )}
              </div>
            )}
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex justify-end gap-2">
              <Button
                label={t("Cancel")}
                variant="ghost"
                onClick={onClose}
                isDisabled={busy}
              />
              <Button
                label={busy ? t("Submitting...") : t("Track")}
                variant="primary"
                onClick={() => void submit()}
                isDisabled={busy || !!loadError || !imageUrl}
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
