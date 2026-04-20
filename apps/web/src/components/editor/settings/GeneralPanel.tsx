import React from "react";
import { Switch } from "@openreel/ui";
import { Label } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY, type TtsProvider, type LlmProvider, type AggregatorProvider } from "../../../stores/settings-store";
import { useI18n } from "../../../i18n";

export const GeneralPanel: React.FC = () => {
  const {
    autoSave,
    autoSaveInterval,
    language,
    defaultTtsProvider,
    defaultLlmProvider,
    defaultAggregator,
    configuredServices,
    setAutoSave,
    setAutoSaveInterval,
    setLanguage,
    setDefaultTtsProvider,
    setDefaultLlmProvider,
    setDefaultAggregator,
  } = useSettingsStore();
  const { t } = useI18n();

  const ttsProviders = [
    { id: "piper", label: t("settings.general.ai.tts.piper") },
    ...SERVICE_REGISTRY.filter(
      (s) => s.id === "elevenlabs" || configuredServices.includes(s.id),
    ),
  ];

  const llmProviders = SERVICE_REGISTRY.filter(
    (s) =>
      s.id === "openai" ||
      s.id === "anthropic" ||
      configuredServices.includes(s.id),
  );

  const aggregatorProviders = SERVICE_REGISTRY.filter(
    (s) =>
      s.id === "kie-ai" ||
      s.id === "freepik" ||
      configuredServices.includes(s.id),
  );

  return (
    <div className="space-y-6 pb-4">
      {/* Auto-save */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">
          {t("settings.general.autoSave.title")}
        </h3>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-text-secondary">
              {t("settings.general.autoSave.enable")}
            </Label>
            <p className="text-xs text-text-muted mt-0.5">
              {t("settings.general.autoSave.description")}
            </p>
          </div>
          <Switch checked={autoSave} onCheckedChange={setAutoSave} />
        </div>

        {autoSave && (
          <div className="flex items-center gap-3">
            <Label className="text-sm text-text-secondary whitespace-nowrap">
              {t("settings.general.autoSave.saveEvery")}
            </Label>
            <select
              value={autoSaveInterval}
              onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {[1, 2, 5, 10, 15, 30].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes}{" "}
                  {minutes === 1
                    ? t("settings.general.autoSave.minute")
                    : t("settings.general.autoSave.minutes")}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">
          {t("settings.general.language.title")}
        </h3>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm text-text-secondary">
              {t("settings.general.language.title")}
            </Label>
            <p className="text-xs text-text-muted mt-0.5">
              {t("settings.general.language.description")}
            </p>
          </div>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px]"
          >
            <option value="en">
              {t("settings.general.language.english")}
            </option>
            <option value="zh-CN">
              {t("settings.general.language.chineseSimplified")}
            </option>
          </select>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Default providers */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">
          {t("settings.general.ai.title")}
        </h3>
        <p className="text-xs text-text-muted">
          {t("settings.general.ai.description")}
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-text-secondary">
              {t("settings.general.ai.tts")}
            </Label>
            <select
              value={defaultTtsProvider}
              onChange={(e) => setDefaultTtsProvider(e.target.value as TtsProvider)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px]"
            >
              {ttsProviders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm text-text-secondary">
              {t("settings.general.ai.llm")}
            </Label>
            <select
              value={defaultLlmProvider}
              onChange={(e) => setDefaultLlmProvider(e.target.value as LlmProvider)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px]"
            >
              {llmProviders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-text-secondary">
                {t("settings.general.ai.aggregator")}
              </Label>
              <p className="text-xs text-text-muted mt-0.5">
                {t("settings.general.ai.aggregatorDescription")}
              </p>
            </div>
            <select
              value={defaultAggregator}
              onChange={(e) => setDefaultAggregator(e.target.value as AggregatorProvider)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px]"
            >
              {aggregatorProviders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
