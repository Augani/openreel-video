import { Badge, Button } from "@openreel/ui";

import { ChevronRight } from "@/icons/lucide-compat";
import {
  IMAGE_MODELS,
  type ImageModelId,
} from "../../../services/kieai/image-generation";

interface ModelInfo {
  id: ImageModelId;
  name: string;
  description: string;
  badge?: string;
}

export const IMAGE_MODEL_OPTIONS: ModelInfo[] = [
  {
    id: IMAGE_MODELS.SEEDREAM,
    name: "Seedream 5 Lite",
    description:
      "High-quality image-to-image with aspect ratio and quality control. Up to 4K output.",
    badge: "4K",
  },
  {
    id: IMAGE_MODELS.Z_IMAGE,
    name: "Z-Image",
    description: "Text-to-image generation from your prompt.",
    badge: "Text→Image",
  },
  {
    id: IMAGE_MODELS.NANO_BANANA2,
    name: "Nano Banana 2",
    description:
      "Versatile generation with wide aspect ratio support and flexible resolution.",
    badge: "Versatile",
  },
  {
    id: IMAGE_MODELS.FLUX2,
    name: "Flux 2 Pro",
    description:
      "Professional image-to-image with up to 8 reference images and 2K output.",
    badge: "Pro",
  },
  {
    id: IMAGE_MODELS.GROK,
    name: "Grok Imagine",
    description:
      "Style and composition transfer with optional prompt guidance.",
    badge: "Style",
  },
  {
    id: IMAGE_MODELS.QWEN,
    name: "Qwen",
    description:
      "Fine-grained control over image transformation strength and quality.",
    badge: "Control",
  },
];

interface Props {
  onSelect: (model: ImageModelId) => void;
}

export function ModelPicker({ onSelect }: Props) {
  return (
    <div className="space-y-3">
      <span className="text-[12px] leading-5 text-fg-2">
        Select a model to generate a new image from your source.
      </span>
      <div className="grid grid-cols-1 gap-2">
        {IMAGE_MODEL_OPTIONS.map((m) => (
          <Button
            key={m.id}
            onClick={() => onSelect(m.id)}
            type="button"
            aria-label={m.name.trim() || undefined}
            className="flex h-auto w-full min-w-0 items-start justify-start gap-3 whitespace-normal rounded-[7px] border border-border bg-bg-2 p-3 text-left text-fg hover:border-accent hover:bg-selected"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-fg">
                  {m.name}
                </span>
                {m.badge && (
                  <Badge
                    variant="secondary"
                    className="rounded bg-selected px-1.5 py-0.5 text-[10px] font-medium text-accent"
                  >
                    {m.badge}
                  </Badge>
                )}
              </div>
              <span className="mt-1 block text-[12px] font-normal leading-5 text-fg-2">
                {m.description}
              </span>
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-fg-3" />
          </Button>
        ))}
      </div>
    </div>
  );
}
