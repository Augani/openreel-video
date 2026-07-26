import type { JSX } from "react";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import {
  useSettingsStore,
  type LlmProvider,
} from "../../../stores/settings-store";
import { modelsFor, defaultModelFor } from "./models";

const PROVIDERS: ReadonlyArray<{ id: LlmProvider; label: string }> = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
];

interface ProviderModelPickerProps {
  readonly disabled?: boolean;
}

export function ProviderModelPicker({
  disabled = false,
}: ProviderModelPickerProps): JSX.Element {
  const provider = useSettingsStore((s) => s.defaultLlmProvider);
  const model = useSettingsStore((s) => s.llmModel);
  const setProvider = useSettingsStore((s) => s.setDefaultLlmProvider);
  const setModel = useSettingsStore((s) => s.setLlmModel);

  const models = modelsFor(provider);
  const currentModel = models.some((m) => m.id === model)
    ? model
    : defaultModelFor(provider);

  return (
    <div className="flex items-center gap-1.5">
      <Selector
        label="LLM provider"
        isLabelHidden
        size="sm"
        width="9rem"
        value={provider}
        isDisabled={disabled}
        options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
        onChange={(value) => {
          const next = value as LlmProvider;
          setProvider(next);
          setModel(defaultModelFor(next));
        }}
      />
      <Selector
        label="LLM model"
        isLabelHidden
        size="sm"
        width="9rem"
        value={currentModel}
        isDisabled={disabled}
        options={models.map((m) => ({ value: m.id, label: m.label }))}
        onChange={(value) => setModel(value)}
      />
    </div>
  );
}
