import type { JSX } from "react";
import { useEffect, useState } from "react";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftSliderControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../../../stores/project-store";
import { useUIStore } from "../../../../stores/ui-store";
import { loadMediaBlob } from "../../../../services/media-storage";
import { submitSelectedClipJob } from "../../../../services/gpu-clip-submit";
import { SelectionCanvas } from "./SelectionCanvas";
import {
  buildObjectRemovalParams,
  type ObjectMode,
  type MaskTool,
  type BBox,
  type NormPoint,
} from "./object-removal-params";
import { useTranslation } from "react-i18next";

interface PhotoToolsEditorProps {
  onClose: () => void;
}

export function PhotoToolsEditor({ onClose }: PhotoToolsEditorProps): JSX.Element {
  const { t } = useTranslation();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<ObjectMode>("erase");
  const [tool, setTool] = useState<MaskTool>("box");
  const [bbox, setBBox] = useState<BBox | null>(null);
  const [points, setPoints] = useState<NormPoint[]>([]);
  const [prompt, setPrompt] = useState("");
  const [expand, setExpand] = useState(0.25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const selected = useUIStore.getState().getSelectedClipIds();
        if (selected.length !== 1) throw new Error("Select a single photo clip first");
        const clip = useProjectStore.getState().getClip(selected[0]);
        const mediaId = clip?.mediaId;
        if (!mediaId) throw new Error("Select a photo clip first");
        const item = useProjectStore.getState().getMediaItem(mediaId);
        let blob = item?.blob ?? null;
        if (!blob) blob = await loadMediaBlob(mediaId);
        if (!blob) throw new Error("Could not load the photo");
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  const clearSelection = (): void => {
    setBBox(null);
    setPoints([]);
  };

  const submit = async (): Promise<void> => {
    setError(null);
    const result = buildObjectRemovalParams({ mode, tool, bbox, points, prompt, expand, expandSides: null });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBusy(true);
    try {
      await submitSelectedClipJob({
        kind: "object_removal",
        params: result.params,
        suggestedName: `Object ${mode} result`,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const needsMask = mode === "erase" || mode === "replace";

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} width={672} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t("Object Removal")}
            onOpenChange={(open) => !open && onClose()}
          />
        }
        content={
          <LayoutContent className="space-y-4">
        <ToolcraftSegmentedControl<ObjectMode>
          ariaLabel={t("Object removal mode")}
          value={mode}
          onChange={(value) => {
            setMode(value);
            setError(null);
          }}
          options={[
            { value: "erase", label: t("Erase") },
            { value: "replace", label: t("Replace") },
            { value: "outpaint", label: t("Expand") },
          ]}
        />

        <Text type="supporting" color="secondary" display="block" className="text-[11px]">
          {mode === "erase"
            ? "Removes the object and fills the background in automatically - no prompt needed."
            : mode === "replace"
              ? "Generates new content inside the box from the description you type below."
              : "Extends the photo outward, generating new surroundings."}
        </Text>

        {loadError ? (
          <Text type="supporting" display="block" className="py-8 text-center text-red-300">
            {loadError}
          </Text>
        ) : !imageUrl ? (
          <Text type="supporting" color="secondary" display="block" className="py-8 text-center">
            {t("Loading photo...")}</Text>
        ) : (
          <div className="space-y-3">
            {needsMask ? (
              <>
                <div className="flex items-center justify-between">
                  <ToolcraftSegmentedControl<MaskTool>
                    ariaLabel={t("Mask tool")}
                    className="w-48"
                    value={tool}
                    onChange={(value) => {
                      setTool(value);
                      clearSelection();
                    }}
                    options={[
                      { value: "box", label: t("Box") },
                      { value: "points", label: t("Points") },
                    ]}
                  />
                  <Button label={t("Clear")} variant="ghost" size="sm" onClick={clearSelection} />
                </div>
                <SelectionCanvas
                  imageUrl={imageUrl}
                  tool={tool}
                  bbox={bbox}
                  points={points}
                  onBBoxChange={setBBox}
                  onPointsChange={setPoints}
                />
                <Text type="supporting" color="secondary" display="block" className="text-[11px]">
                  {tool === "box"
                    ? "Drag a box around the object to remove."
                    : "Tap each part of the object to remove."}
                </Text>
              </>
            ) : (
              <>
                <div className="flex justify-center">
                  <div
                    className="relative rounded border border-dashed border-primary/40 bg-primary/5"
                    style={{ padding: `${expand * 100}%` }}
                  >
                    <img src={imageUrl} alt={t("Selected photo")} className="block max-h-[46vh] max-w-full rounded" />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <Text type="supporting" color="secondary" className="text-[11px]">
                      {t("Expand each side")}</Text>
                    <Text type="supporting" color="secondary" className="text-[11px]">
                      {Math.round(expand * 100)}%
                    </Text>
                  </div>
                  <ToolcraftSliderControl
                    label={t("Expand each side")}
                    isLabelHidden
                    value={expand}
                    onChange={(nextExpand: number) => setExpand(nextExpand)}
                    min={0.05}
                    max={0.5}
                    step={0.05}
                    valueDisplay="none"
                  />
                </div>
              </>
            )}

            {(mode === "replace" || mode === "outpaint") && (
              <ToolcraftTextInputControl
                label={mode === "replace" ? t("Replacement prompt") : t("Expansion prompt")}
                isLabelHidden
                value={prompt}
                onChange={setPrompt}
                placeholder={
                  mode === "replace"
                    ? t("Describe what to put there")
                    : t("Optional: describe the extended scene")
                }
                width="100%"
              />
            )}

            {error && (
              <Card variant="muted" padding={2} className="border border-red-500/30 bg-red-500/10">
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
                label={busy ? t("Submitting...") : t("Apply")}
                variant="primary"
                onClick={() => void submit()}
                isDisabled={busy || !imageUrl || Boolean(loadError)}
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
