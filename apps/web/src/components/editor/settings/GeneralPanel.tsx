import React, { useCallback } from "react";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY, type TtsProvider, type LlmProvider, type AggregatorProvider } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { SUPPORTED_LANGUAGES } from "../../../i18n";
import { useTranslation } from "react-i18next";

const ASPECT_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: "16:9 Landscape (1080p)", width: 1920, height: 1080 },
  { label: "9:16 Vertical (TikTok/Reels)", width: 1080, height: 1920 },
  { label: "1:1 Square", width: 1080, height: 1080 },
  { label: "4:5 Portrait", width: 1080, height: 1350 },
  { label: "4:3 Standard", width: 1440, height: 1080 },
  { label: "21:9 Cinematic", width: 2560, height: 1080 },
  { label: "4K Landscape", width: 3840, height: 2160 },
];

const BACKGROUND_SWATCHES = [
  "#000000",
  "#FFFFFF",
  "#1E1E1E",
  "#2563EB",
  "#DC2626",
  "#16A34A",
  "#F59E0B",
  "#9333EA",
  "#DB2777",
  "#0EA5E9",
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
  const backgroundFillMode = useProjectStore(
    (s) => s.project.timeline.backgroundFillMode,
  );
  const layoutBackgroundColor = useProjectStore(
    (s) => s.project.timeline.layoutBackgroundColor,
  );
  const setCanvasBackground = useProjectStore((s) => s.setCanvasBackground);

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
    { id: "piper", label: t("Piper (Free / Built-in)") },
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
      {/* Language */}
      <div className="flex items-center justify-between">
        <Text type="supporting" color="secondary" className="text-sm">
          {t("Language")}</Text>
        <Selector
          label={t("Language")}
          isLabelHidden
          size="md"
          width={180}
          value={language}
          onChange={(value) => setLanguage(value)}
          options={SUPPORTED_LANGUAGES.map(({ code, label }) => ({ label, value: code }))}
        />
      </div>

      <div className="h-px bg-border" />

      {/* Project Composition */}
      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            {t("Project Composition")}</Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            {t("Set the canvas dimensions for your project. Pick a preset for TikTok, Reels, YouTube, or enter custom values.")}</Text>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {ASPECT_PRESETS.map((preset) => {
            const isActive =
                preset.width === projectWidth && preset.height === projectHeight;
            return (
              <ClickableCard
                key={preset.label}
                label={t(preset.label)}
                onClick={() => applyDimensions(preset.width, preset.height)}
                padding={3}
                variant={isActive ? "green" : "muted"}
                className={`text-left text-xs border ${
                  isActive
                    ? "border-primary bg-primary/10 text-text-primary"
                    : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary hover:border-primary/40"
                }`}
              >
                <Text type="supporting" color="inherit" className="font-medium">
                  {t(preset.label)}
                </Text>
                <Text type="supporting" color="secondary" className="mt-0.5 text-[10px]">
                  {preset.width} × {preset.height}
                </Text>
              </ClickableCard>
            );
          })}
        </div>

        <div className="flex items-end gap-2">
          <ToolcraftNumberInputControl
            label={t("Width")}
            size="md"
            width="100%"
            min={16}
            max={7680}
            value={Number.isFinite(Number(draftWidth)) ? Number(draftWidth) : null}
            onChange={(value) => setDraftWidth(String(value))}
          />
          <ToolcraftNumberInputControl
            label={t("Height")}
            size="md"
            width="100%"
            min={16}
            max={7680}
            value={Number.isFinite(Number(draftHeight)) ? Number(draftHeight) : null}
            onChange={(value) => setDraftHeight(String(value))}
          />
          <Button
            label={t("Apply")}
            onClick={handleApplyCustom}
            variant="primary"
            size="md"
          />
        </div>

        <div className="space-y-2">
          <Text type="supporting" color="secondary" className="text-xs font-medium">
            {t("Background fill")}</Text>
          <Text type="supporting" color="secondary" className="text-[11px]">
            {t("Fills the canvas around clips that don't match the aspect ratio.")}</Text>
          <div className="flex flex-wrap items-center gap-2">
            <ClickableCard
              label={t("No background fill")}
              onClick={() => setCanvasBackground(undefined, undefined)}
              padding={2}
              variant={!backgroundFillMode ? "green" : "muted"}
              className={`border px-3 py-1.5 text-xs ${
                !backgroundFillMode
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              {t("None")}</ClickableCard>
            <ClickableCard
              label={t("Blur background fill")}
              onClick={() =>
                setCanvasBackground("blur", layoutBackgroundColor)
              }
              padding={2}
              variant={backgroundFillMode === "blur" ? "green" : "muted"}
              className={`border px-3 py-1.5 text-xs ${
                backgroundFillMode === "blur"
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              {t("Blur")}</ClickableCard>
            {BACKGROUND_SWATCHES.map((hex) => {
              const isActive =
                backgroundFillMode === "color" &&
                layoutBackgroundColor?.toLowerCase() === hex.toLowerCase();
              return (
                <ClickableCard
                  key={hex}
                  label={`Background color ${hex}`}
                  onClick={() => setCanvasBackground("color", hex)}
                  padding={0}
                  variant="transparent"
                  style={{ backgroundColor: hex }}
                  className={`h-6 w-6 rounded-full border-2 transition-transform ${
                    isActive
                      ? "border-primary scale-110"
                      : "border-border hover:scale-105"
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Auto-save */}
      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">
          {t("Auto-Save")}</Text>

        <div className="flex items-center justify-between">
          <div>
            <Text type="supporting" color="secondary" className="text-sm">
              {t("Enable auto-save")}</Text>
            <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
              {t("Automatically save your project at regular intervals")}</Text>
          </div>
          <ToolcraftSwitchControl
            ariaLabel={t("Enable auto-save")}
            checked={autoSave}
            onCheckedChange={setAutoSave}
            showLabel={false}
          />
        </div>

        {autoSave && (
          <div className="flex items-center gap-3">
            <Text type="supporting" color="secondary" className="whitespace-nowrap text-sm">
              {t("Save every")}</Text>
            <Selector
              label={t("Auto-save interval")}
              isLabelHidden
              size="md"
              width={150}
              value={String(autoSaveInterval)}
              onChange={(value) => setAutoSaveInterval(Number(value))}
              options={[
                { label: t("1 minute"), value: "1" },
                { label: t("2 minutes"), value: "2" },
                { label: t("5 minutes"), value: "5" },
                { label: t("10 minutes"), value: "10" },
                { label: t("15 minutes"), value: "15" },
                { label: t("30 minutes"), value: "30" },
              ]}
            />
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Default providers */}
      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">
          {t("Default AI Providers")}</Text>
        <Text type="supporting" color="secondary" className="text-xs">
          {t("Choose which service to use by default for AI features. Configure API keys in the \"API Keys\" tab first.")}</Text>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-sm">
              {t("Text to Speech/Voice To Speech/Sound Effects")}</Text>
            <Selector
              label={t("Text to Speech provider")}
              isLabelHidden
              size="md"
              width={180}
              value={defaultTtsProvider}
              onChange={(value) => setDefaultTtsProvider(value as TtsProvider)}
              options={ttsProviders.map((s) => ({ label: t(s.label), value: s.id }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-sm">
              {t("AI Assistant (LLM)")}</Text>
            <Selector
              label={t("AI Assistant provider")}
              isLabelHidden
              size="md"
              width={180}
              value={defaultLlmProvider}
              onChange={(value) => setDefaultLlmProvider(value as LlmProvider)}
              options={llmProviders.map((s) => ({ label: t(s.label), value: s.id }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Text type="supporting" color="secondary" className="text-sm">
                {t("AI Aggregator")}</Text>
              <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
                {t("Video/image generation, upscaling, and creative AI tools")}</Text>
            </div>
            <Selector
              label={t("AI Aggregator provider")}
              isLabelHidden
              size="md"
              width={180}
              value={defaultAggregator}
              onChange={(value) => setDefaultAggregator(value as AggregatorProvider)}
              options={aggregatorProviders.map((s) => ({ label: t(s.label), value: s.id }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
