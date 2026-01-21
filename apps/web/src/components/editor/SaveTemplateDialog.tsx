import { useState, useCallback } from "react";
import { Upload, Cloud, HardDrive, Check, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 bg-background border-border overflow-hidden">
        <DialogHeader className="p-4 border-b border-border space-y-0">
          <DialogTitle className="text-lg font-semibold text-text-primary">
            Save as Template
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {success && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <Check size={16} className="text-green-400" />
              <span className="text-sm text-green-400">
                Template saved successfully!
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle size={16} className="text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-medium text-text-secondary">
              Template Name <span className="text-red-400">*</span>
            </Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Template"
              className="bg-background-secondary border-border text-text-primary"
              maxLength={50}
            />
            <p className="text-[10px] text-text-muted">
              {name.length}/50 characters
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-text-secondary">
              Description <span className="text-red-400">*</span>
            </Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this template is for and how to use it..."
              className="w-full px-3 py-2 text-sm bg-background-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              rows={4}
              maxLength={500}
            />
            <p className="text-[10px] text-text-muted">
              {description.length}/500 characters
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-text-secondary">
              Category
            </Label>
            <Select value={category} onValueChange={(value) => setCategory(value as TemplateCategory)}>
              <SelectTrigger className="w-full bg-background-secondary border-border text-text-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background-secondary border-border">
                {TEMPLATE_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-text-secondary">
              Tags (comma-separated)
            </Label>
            <Input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="intro, animated, youtube"
              className="bg-background-secondary border-border text-text-primary"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-text-secondary">
              Author Name
            </Label>
            <Input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Your name or username"
              className="bg-background-secondary border-border text-text-primary"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-text-secondary">
              Save Location
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSaveLocation("cloud")}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                  saveLocation === "cloud"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background-secondary text-text-secondary hover:border-primary/50"
                }`}
              >
                <Cloud size={16} />
                <span className="text-sm font-medium">Cloud</span>
              </button>
              <button
                onClick={() => setSaveLocation("local")}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                  saveLocation === "local"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background-secondary text-text-secondary hover:border-primary/50"
                }`}
              >
                <HardDrive size={16} />
                <span className="text-sm font-medium">Local</span>
              </button>
            </div>
            <p className="text-[10px] text-text-muted">
              {saveLocation === "cloud"
                ? "Saved to cloud and accessible from any device"
                : "Saved locally in your browser storage"}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || !description.trim()}
          >
            {isSaving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                Saving...
              </>
            ) : (
              <>
                <Upload size={16} />
                Save Template
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
