import i18n from "../../../i18n";
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
    name: i18n.t("modelPicker.seedreamName"),
    description: i18n.t("modelPicker.seedreamDesc"),
    badge: i18n.t("modelPicker.seedreamBadge"),
  },
  {
    id: IMAGE_MODELS.Z_IMAGE,
    name: i18n.t("modelPicker.zImageName"),
    description: i18n.t("modelPicker.zImageDesc"),
    badge: i18n.t("modelPicker.zImageBadge"),
  },
  {
    id: IMAGE_MODELS.NANO_BANANA2,
    name: i18n.t("modelPicker.nanoBananaName"),
    description: i18n.t("modelPicker.nanoBananaDesc"),
    badge: i18n.t("modelPicker.nanoBananaBadge"),
  },
  {
    id: IMAGE_MODELS.FLUX2,
    name: i18n.t("modelPicker.flux2Name"),
    description: i18n.t("modelPicker.flux2Desc"),
    badge: i18n.t("modelPicker.flux2Badge"),
  },
  {
    id: IMAGE_MODELS.GROK,
    name: i18n.t("modelPicker.grokName"),
    description: i18n.t("modelPicker.styleTransfer"),
    badge: i18n.t("modelPicker.grokBadge"),
  },
  {
    id: IMAGE_MODELS.QWEN,
    name: i18n.t("modelPicker.qwenName"),
    description: i18n.t("modelPicker.qwenDesc"),
    badge: i18n.t("modelPicker.qwenBadge"),
  },
];

interface Props {
  onSelect: (model: ImageModelId) => void;
}

export function ModelPicker({ onSelect }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">{i18n.t("modelPicker.selectModelHint")}</p>
      <div className="grid grid-cols-1 gap-2">
        {MODELS.map((m) => (
          <button
            key={m.id}
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
              <p className="mt-0.5 text-xs text-text-muted leading-relaxed">{m.description}</p>
            </div>
            <svg
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
