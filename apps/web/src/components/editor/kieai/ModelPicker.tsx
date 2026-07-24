import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ChevronRight } from "@/icons/lucide-compat";
import { IMAGE_MODELS, type ImageModelId } from "../../../services/kieai/image-generation";

interface ModelInfo {
  id: ImageModelId;
  name: string;
  description: string;
  badge?: string;
}

const MODELS: ModelInfo[] = [
  {
    id: IMAGE_MODELS.SEEDREAM,
    name: "Seedream 5 Lite",
    description: "High-quality image-to-image with aspect ratio and quality control. Up to 4K output.",
    badge: "4K",
  },
  {
    id: IMAGE_MODELS.Z_IMAGE,
    name: "Z-Image",
    description: "Text-to-image generation. Source image is used as inspiration only.",
    badge: "Text→Image",
  },
  {
    id: IMAGE_MODELS.NANO_BANANA2,
    name: "Nano Banana 2",
    description: "Versatile generation with wide aspect ratio support and flexible resolution.",
    badge: "Versatile",
  },
  {
    id: IMAGE_MODELS.FLUX2,
    name: "Flux 2 Pro",
    description: "Professional image-to-image with up to 8 reference images and 2K output.",
    badge: "Pro",
  },
  {
    id: IMAGE_MODELS.GROK,
    name: "Grok Imagine",
    description: "Style and composition transfer with optional prompt guidance.",
    badge: "Style",
  },
  {
    id: IMAGE_MODELS.QWEN,
    name: "Qwen",
    description: "Fine-grained control over image transformation strength and quality.",
    badge: "Control",
  },
];

interface Props {
  onSelect: (model: ImageModelId) => void;
}

export function ModelPicker({ onSelect }: Props) {
  return (
    <div className="space-y-3">
      <Text type="supporting" color="secondary" className="text-xs text-text-muted">Select a model to generate a new image from your source.</Text>
      <div className="grid grid-cols-1 gap-2">
        {MODELS.map((m) => (
          <Button
            key={m.id}
            label={m.name}
            variant="ghost"
            size="lg"
            onClick={() => onSelect(m.id)}
            className="flex items-start gap-3 rounded-lg border border-border bg-background-elevated p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{m.name}</span>
                {m.badge && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/15 text-primary">
                    {m.badge}
                  </span>
                )}
              </div>
              <Text type="supporting" color="secondary" className="mt-0.5 text-xs text-text-muted leading-relaxed">{m.description}</Text>
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" />
          </Button>
        ))}
      </div>
    </div>
  );
}
