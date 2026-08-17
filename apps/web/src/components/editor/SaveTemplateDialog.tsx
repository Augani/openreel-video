import { useState, useCallback } from "react";
import { Upload, Cloud, HardDrive, Check, AlertCircle } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useEngineStore } from "../../stores/engine-store";
import {
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
  type TemplatePlaceholder,
  type Template,
  type ShapeClip,
  type SVGClip,
  type StickerClip,
} from "@openreel/core";
import { templateCloudService } from "../../services/template-cloud-service";
import { useTranslation } from "react-i18next";

interface TemplateWithGraphics extends Template {
  timeline: Template["timeline"] & {
    graphics?: {
      shapes: ShapeClip[];
      svgs: SVGClip[];
      stickers: StickerClip[];
    };
  };
}

interface SaveTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SaveTemplateDialog: React.FC<SaveTemplateDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t: tr } = useTranslation();
  const { project } = useProjectStore();
  const getTemplateEngine = useEngineStore((state) => state.getTemplateEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("custom");
  const [tags, setTags] = useState("");
  const [author, setAuthor] = useState("");
  const [saveLocation, setSaveLocation] = useState<"local" | "cloud">("cloud");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError("Template name is required");
      return;
    }

    if (!description.trim()) {
      setError("Description is required");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const templateEngine = await getTemplateEngine();
      const graphicsEngine = getGraphicsEngine();

      await templateEngine.initialize();

      const tagArray = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const placeholders: TemplatePlaceholder[] = [];

      const template = templateEngine.createFromProject(project, {
        name: name.trim(),
        description: description.trim(),
        category,
        placeholders,
        tags: tagArray,
      });

      const templateWithMeta = {
        ...template,
        author: author.trim() || "Anonymous",
      };

      if (graphicsEngine) {
        const shapes = graphicsEngine.getAllShapeClips();
        const svgs = graphicsEngine.getAllSVGClips();
        const stickers = graphicsEngine.getAllStickerClips();

        if (shapes.length > 0 || svgs.length > 0 || stickers.length > 0) {
          (templateWithMeta as TemplateWithGraphics).timeline.graphics = {
            shapes,
            svgs,
            stickers,
          };
        }
      }

      if (saveLocation === "cloud") {
        const result =
          await templateCloudService.uploadTemplate(templateWithMeta);
        if (!result.success) {
          throw new Error(result.error || "Failed to upload to cloud");
        }
      } else {
        await templateEngine.saveTemplate(templateWithMeta);
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setName("");
        setDescription("");
        setTags("");
        setAuthor("");
        setCategory("custom");
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setIsSaving(false);
    }
  }, [
    name,
    description,
    category,
    tags,
    author,
    saveLocation,
    project,
    getTemplateEngine,
    getGraphicsEngine,
    onClose,
  ]);

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      width={512}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={tr("Save as Template")}
            onOpenChange={(open) => !open && onClose()}
          />
        }
        content={
          <LayoutContent className="max-h-[70vh] overflow-y-auto">
        <div className="space-y-4">
          {success && (
            <Card variant="green" padding={3} className="flex items-center gap-2 border border-green-500/30">
              <Check size={16} className="text-green-400" aria-hidden />
              <Text type="supporting" className="text-green-400">
                {tr("Template saved successfully!")}</Text>
            </Card>
          )}

          {error && (
            <Card variant="red" padding={3} className="flex items-center gap-2 border border-red-500/30">
              <AlertCircle size={16} className="text-red-400" aria-hidden />
              <Text type="supporting" className="text-red-400">{error}</Text>
            </Card>
          )}

          <ToolcraftTextInputControl
            label={tr("Template Name")}
            isRequired
            type="text"
            value={name}
            onChange={(nextName) => setName(nextName.slice(0, 50))}
            placeholder={tr("My Awesome Template")}
            width="100%"
          />
          <Text type="supporting" color="secondary" display="block" className="text-[10px]">
            {name.length}{tr("/50 characters")}</Text>

          <ToolcraftTextAreaControl
            label={tr("Description")}
            isRequired
            value={description}
            onChange={setDescription}
            placeholder={tr("Describe what this template is for and how to use it...")}
            rows={4}
            maxLength={500}
            width="100%"
          />

          <Selector
            label={tr("Category")}
            value={category}
            onChange={(nextCategory) => setCategory(nextCategory as TemplateCategory)}
            options={TEMPLATE_CATEGORIES.map((cat) => ({
              value: cat.id,
              label: tr(cat.name),
            }))}
            width="100%"
          />

          <ToolcraftTextInputControl
            label={tr("Tags (comma-separated)")}
            type="text"
            value={tags}
            onChange={setTags}
            placeholder={tr("intro, animated, youtube")}
            width="100%"
          />

          <ToolcraftTextInputControl
            label={tr("Author Name")}
            type="text"
            value={author}
            onChange={setAuthor}
            placeholder={tr("Your name or username")}
            width="100%"
          />

          <div className="space-y-2">
            <Text type="supporting" color="secondary" weight="bold" display="block">
              {tr("Save Location")}</Text>
            <div className="grid grid-cols-2 gap-2">
              <SelectableCard
                label={tr("Cloud")}
                isSelected={saveLocation === "cloud"}
                onChange={() => setSaveLocation("cloud")}
                padding={3}
                variant={saveLocation === "cloud" ? "green" : "default"}
              >
                <div className="flex items-center justify-center gap-2">
                  <Cloud size={16} aria-hidden />
                  <Text type="label" weight="bold">{tr("Cloud")}</Text>
                </div>
              </SelectableCard>
              <SelectableCard
                label={tr("Local")}
                isSelected={saveLocation === "local"}
                onChange={() => setSaveLocation("local")}
                padding={3}
                variant={saveLocation === "local" ? "green" : "default"}
              >
                <div className="flex items-center justify-center gap-2">
                  <HardDrive size={16} aria-hidden />
                  <Text type="label" weight="bold">{tr("Local")}</Text>
                </div>
              </SelectableCard>
            </div>
            <Text type="supporting" color="secondary" display="block" className="text-[10px]">
              {saveLocation === "cloud"
                ? "Saved to cloud and accessible from any device"
                : "Saved locally in your browser storage"}
            </Text>
          </div>
        </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex items-center justify-end gap-2">
              <Button
                label={tr("Cancel")}
                variant="ghost"
                onClick={onClose}
                isDisabled={isSaving}
              />
              <Button
                label={isSaving ? tr("Saving...") : tr("Save Template")}
                onClick={handleSave}
                isDisabled={isSaving || !name.trim() || !description.trim()}
                isLoading={isSaving}
                variant="primary"
                icon={!isSaving ? <Upload size={16} aria-hidden /> : undefined}
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
