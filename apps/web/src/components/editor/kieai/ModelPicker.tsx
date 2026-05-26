import i18n from "../../../i18n";
import { IMAGE_MODELS, type ImageModelId } from "../../../services/kieai/image-generation";

const MODELS = [
  {
    id: IMAGE_MODELS.SEEDREAM,
    nameKey: "modelPicker.seedreamName",
    descKey: "modelPicker.seedreamDesc",
    badgeKey: "modelPicker.seedreamBadge",
  },
  {
    id: IMAGE_MODELS.Z_IMAGE,
    nameKey: "modelPicker.zImageName",
    descKey: "modelPicker.zImageDesc",
    badgeKey: "modelPicker.zImageBadge",
  },
  {
    id: IMAGE_MODELS.NANO_BANANA2,
    nameKey: "modelPicker.nanoBananaName",
    descKey: "modelPicker.nanoBananaDesc",
    badgeKey: "modelPicker.nanoBananaBadge",
  },
  {
    id: IMAGE_MODELS.FLUX2,
    nameKey: "modelPicker.flux2Name",
    descKey: "modelPicker.flux2Desc",
    badgeKey: "modelPicker.flux2Badge",
  },
  {
    id: IMAGE_MODELS.GROK,
    nameKey: "modelPicker.grokName",
    descKey: "modelPicker.styleTransfer",
    badgeKey: "modelPicker.grokBadge",
  },
  {
    id: IMAGE_MODELS.QWEN,
    nameKey: "modelPicker.qwenName",
    descKey: "modelPicker.qwenDesc",
    badgeKey: "modelPicker.qwenBadge",
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
                <span className="text-sm font-medium text-text-primary">{i18n.t(m.nameKey)}</span>
                {m.badgeKey && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/15 text-primary">
                    {i18n.t(m.badgeKey)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-muted leading-relaxed">{i18n.t(m.descKey)}</p>
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
