import React from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@openreel/ui";
import { Label } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY, type TtsProvider, type LlmProvider, type AggregatorProvider } from "../../../stores/settings-store";

export const GeneralPanel: React.FC = () => {
  const { t } = useTranslation();
  const {
    autoSave,
    autoSaveInterval,
    defaultTtsProvider,
    defaultLlmProvider,
    defaultAggregator,
    configuredServices,
    setAutoSave,
    setAutoSaveInterval,
    setDefaultTtsProvider,
    setDefaultLlmProvider,
    setDefaultAggregator,
  } = useSettingsStore();

  const ttsProviders = [
    { id: "piper", label: t("settings:general.piperBuiltIn") },
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
        <h3 className="text-sm font-medium text-text-primary">{t("settings:general.autoSaveTitle")}</h3>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-text-secondary">{t("settings:general.enableAutoSave")}</Label>
            <p className="text-xs text-text-muted mt-0.5">
              {t("settings:general.autoSaveDescription")}
            </p>
          </div>
          <Switch checked={autoSave} onCheckedChange={setAutoSave} />
        </div>

        {autoSave && (
          <div className="flex items-center gap-3">
            <Label className="text-sm text-text-secondary whitespace-nowrap">
              {t("settings:general.saveEvery")}
            </Label>
            <select
              value={autoSaveInterval}
              onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value={1}>{t("settings:general.intervals.oneMinute")}</option>
              <option value={2}>{t("settings:general.intervals.twoMinutes")}</option>
              <option value={5}>{t("settings:general.intervals.fiveMinutes")}</option>
              <option value={10}>{t("settings:general.intervals.tenMinutes")}</option>
              <option value={15}>{t("settings:general.intervals.fifteenMinutes")}</option>
              <option value={30}>{t("settings:general.intervals.thirtyMinutes")}</option>
            </select>
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Default providers */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">
          {t("settings:general.defaultProvidersTitle")}
        </h3>
        <p className="text-xs text-text-muted">
          {t("settings:general.defaultProvidersDescription")}
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-text-secondary">
              {t("settings:general.ttsProvider")}
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
              {t("settings:general.llmProvider")}
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
                {t("settings:general.aggregator")}
              </Label>
              <p className="text-xs text-text-muted mt-0.5">
                {t("settings:general.aggregatorDescription")}
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
