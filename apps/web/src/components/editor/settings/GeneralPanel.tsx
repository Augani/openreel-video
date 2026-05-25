import React, { useCallback } from "react";
import { Switch } from "@openreel/ui";
import { Label } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY, type TtsProvider, type LlmProvider, type AggregatorProvider } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTranslation } from "react-i18next";
import i18n from "../../../i18n";
import { SUPPORTED_LANGUAGES } from "../../../i18n";

const ASPECT_PRESETS = [
  { label: i18n.t("settings.asp16x9"), width: 1920, height: 1080 },
  { label: i18n.t("settings.asp9x16"), width: 1080, height: 1920 },
  { label: i18n.t("settings.asp1x1"), width: 1080, height: 1080 },
  { label: i18n.t("settings.asp4x5"), width: 1080, height: 1350 },
  { label: i18n.t("settings.asp4x3"), width: 1440, height: 1080 },
  { label: i18n.t("settings.asp21x9"), width: 2560, height: 1080 },
  { label: i18n.t("settings.asp4k"), width: 3840, height: 2160 },
];

export const GeneralPanel: React.FC = () => {
  const { t } = useTranslation();
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

  const projectWidth = useProjectStore((s) => s.project.settings.width);
  const projectHeight = useProjectStore((s) => s.project.settings.height);
  const updateProjectSettings = useProjectStore((s) => s.updateSettings);

  const [draftWidth, setDraftWidth] = React.useState(String(projectWidth));
  const [draftHeight, setDraftHeight] = React.useState(String(projectHeight));

  React.useEffect(() => {
    setDraftWidth(String(projectWidth));
    setDraftHeight(String(projectHeight));
  }, [projectWidth, projectHeight]);

  const applyDimensions = useCallback(
    async (width: number, height: number) => {
      const w = Math.max(16, Math.min(7680, Math.round(width)));
      const h = Math.max(16, Math.min(7680, Math.round(height)));
      await updateProjectSettings({ width: w, height: h });
    },
    [updateProjectSettings],
  );

  const handleApplyCustom = useCallback(() => {
    const w = Number(draftWidth);
    const h = Number(draftHeight);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      applyDimensions(w, h);
    }
  }, [draftWidth, draftHeight, applyDimensions]);

  const ttsProviders = [
    { id: "piper", label: "Piper (Free / Built-in)" },
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
      {/* Project Composition */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-text-primary">
            {t("settings.projectComposition")}
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            {t("settings.projectCompDesc")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {ASPECT_PRESETS.map((preset) => {
            const isActive =
              preset.width === projectWidth && preset.height === projectHeight;
            return (
              <button
                key={preset.label}
                onClick={() => applyDimensions(preset.width, preset.height)}
                className={`text-left px-3 py-2 rounded-md text-xs transition-colors border ${
                  isActive
                    ? "border-primary bg-primary/10 text-text-primary"
                    : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary hover:border-primary/40"
                }`}
              >
                <div className="font-medium">{preset.label}</div>
                <div className="text-text-muted text-[10px] mt-0.5">
                  {preset.width} × {preset.height}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs text-text-secondary">{t("settings.width")}</Label>
            <input
              type="number"
              min={16}
              max={7680}
              value={draftWidth}
              onChange={(e) => setDraftWidth(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex-1">
            <Label className="text-xs text-text-secondary">{t("settings.height")}</Label>
            <input
              type="number"
              min={16}
              max={7680}
              value={draftHeight}
              onChange={(e) => setDraftHeight(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <button
            onClick={handleApplyCustom}
            className="h-9 px-3 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            {t("settings.apply")}
          </button>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Auto-save */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">{t("settings.autoSave")}</h3>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-text-secondary">{t("settings.enableAutoSave")}</Label>
            <p className="text-xs text-text-muted mt-0.5">
              {t("settings.autoSaveDesc")}
            </p>
          </div>
          <Switch checked={autoSave} onCheckedChange={setAutoSave} />
        </div>

        {autoSave && (
          <div className="flex items-center gap-3">
            <Label className="text-sm text-text-secondary whitespace-nowrap">
              {t("settings.saveEvery")}
            </Label>
            <select
              value={autoSaveInterval}
              onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value={1}>{t("settings.1minute")}</option>
              <option value={2}>{t("settings.2minutes")}</option>
              <option value={5}>{t("settings.5minutes")}</option>
              <option value={10}>{t("settings.10minutes")}</option>
              <option value={15}>{t("settings.15minutes")}</option>
              <option value={30}>{t("settings.30minutes")}</option>
            </select>
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Language */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-text-primary">
            {t("settings.language")}
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            {t("settings.languageDesc")}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-sm text-text-secondary">
            {t("settings.displayLanguage")}
          </Label>
          <select
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              import("../../../i18n").then(({ default: i18n }) => {
                i18n.changeLanguage(e.target.value);
              });
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px]"
          >
            {Object.entries(SUPPORTED_LANGUAGES).map(([code, info]) => (
              <option key={code} value={code}>
                {info.nativeLabel}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Default providers */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">
          {t("settings.defaultAIProviders")}
        </h3>
        <p className="text-xs text-text-muted">
          {t("settings.aiProvidersDesc")}
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-text-secondary">
              {t("settings.ttsProvider")}
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
              {t("settings.llmProvider")}
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
              {t("settings.aggregatorProvider")}
            </Label>
            <p className="text-xs text-text-muted mt-0.5">
              {t("settings.aggregatorDesc")}
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
