import { useState, useCallback } from "react";
import {
  Smartphone,
  Monitor,
  Square,
  ChevronRight,
  Check,
  Info,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import {
  SOCIAL_MEDIA_PRESETS,
  SOCIAL_MEDIA_CATEGORY_INFO,
  createProjectSettingsFromPreset,
  type SocialMediaCategory,
} from "@openreel/core";

interface StartFromScratchProps {
  onProjectCreated?: () => void;
}

interface PresetGroup {
  platform: string;
  presets: SocialMediaCategory[];
}

const PRESET_GROUPS: PresetGroup[] = [
  {
    platform: "Vertical (9:16)",
    presets: [
      "tiktok",
      "instagram-reels",
      "instagram-stories",
      "youtube-shorts",
    ],
  },
  {
    platform: "Square (1:1)",
    presets: ["instagram-post", "facebook"],
  },
  {
    platform: "Horizontal (16:9)",
    presets: ["youtube-video", "twitter", "linkedin"],
  },
  {
    platform: "Other",
    presets: ["pinterest", "custom"],
  },
];

const PRESET_ICONS: Record<string, React.ElementType> = {
  "Vertical (9:16)": Smartphone,
  "Square (1:1)": Square,
  "Horizontal (16:9)": Monitor,
  Other: Square,
};

export const StartFromScratch: React.FC<StartFromScratchProps> = ({
  onProjectCreated,
}) => {
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const updateSettings = useProjectStore((state) => state.updateSettings);
  const { track } = useAnalytics();
  const [selectedPreset, setSelectedPreset] =
    useState<SocialMediaCategory>("youtube-video");
  const [projectName, setProjectName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const preset = SOCIAL_MEDIA_PRESETS[selectedPreset];
  const info = SOCIAL_MEDIA_CATEGORY_INFO.find((c) => c.id === selectedPreset);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);

    const settings = createProjectSettingsFromPreset(preset);
    createNewProject(projectName.trim() || `${info?.name || "New"} Project`);
    await updateSettings(settings);

    track(AnalyticsEvents.PROJECT_CREATED, {
      preset: selectedPreset,
      width: preset.width,
      height: preset.height,
      frameRate: preset.frameRate || 30,
      source: "start_from_scratch",
    });

    setTimeout(() => {
      setIsCreating(false);
      onProjectCreated?.();
    }, 100);
  }, [
    createNewProject,
    updateSettings,
    preset,
    projectName,
    info,
    onProjectCreated,
    track,
    selectedPreset,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Text type="label" color="primary" weight="medium" className="text-sm text-text-primary mb-2 block">
          Project Name
        </Text>
        <ToolcraftTextInputControl
          label="Project Name"
          isLabelHidden
          value={projectName}
          onChange={setProjectName}
          placeholder="My Awesome Video"
          className="max-w-md bg-background-tertiary border-border text-text-primary"
        />
      </div>

      <div>
        <Text type="label" color="primary" weight="medium" className="text-sm text-text-primary mb-4">
          Select Format
        </Text>

        <div className="grid md:grid-cols-2 gap-6">
          {PRESET_GROUPS.map((group) => {
            const GroupIcon = PRESET_ICONS[group.platform] || Square;

            return (
              <div key={group.platform} className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-text-muted font-medium">
                  <GroupIcon size={14} />
                  <span>{group.platform}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {group.presets.map((presetId) => {
                    const presetInfo = SOCIAL_MEDIA_CATEGORY_INFO.find(
                      (c) => c.id === presetId,
                    );
                    const presetData = SOCIAL_MEDIA_PRESETS[presetId];
                    const isSelected = selectedPreset === presetId;

                    return (
                      <SelectableCard
                        key={presetId}
                        label={presetInfo?.name || presetId}
                        isSelected={isSelected}
                        onChange={() => setSelectedPreset(presetId)}
                        onClick={() => setSelectedPreset(presetId)}
                        variant={isSelected ? "green" : "muted"}
                        padding={3}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 text-left ${
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border bg-background hover:border-border-hover hover:bg-background-tertiary"
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected
                              ? "border-primary bg-primary"
                              : "border-border"
                          }`}
                        >
                          {isSelected && (
                            <Check size={12} className="text-black" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <Text type="supporting" color="primary" weight="medium" className="text-xs text-text-primary truncate">
                            {presetInfo?.name || presetId}
                          </Text>
                          <Text type="supporting" color="secondary" className="text-[10px] text-text-muted">
                            {presetData.width}×{presetData.height}
                          </Text>
                        </div>
                      </SelectableCard>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 bg-background-tertiary rounded-xl border border-border">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <div>
          <Text type="supporting" color="primary" weight="medium" className="text-sm text-text-primary">
            {info?.name || selectedPreset} Format
          </Text>
          <Text type="supporting" color="secondary" className="text-xs text-text-muted mt-1">
            {preset.width}×{preset.height}px • {preset.frameRate || 30}fps
            {preset.maxDuration && ` • Max ${preset.maxDuration}s`}
            {preset.recommendedDuration &&
              ` • Recommended ${preset.recommendedDuration}s`}
          </Text>
          {preset.safeZone && (
            <Text type="supporting" color="secondary" className="text-xs text-text-muted mt-0.5">
              Safe zone: {preset.safeZone.top}px top, {preset.safeZone.bottom}px
              bottom
            </Text>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button
          label={isCreating ? "Creating..." : "Create Project"}
          icon={isCreating ? (
            <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <ChevronRight size={16} aria-hidden />
          )}
          variant="primary"
          onClick={handleCreate}
          isDisabled={isCreating}
          className="shadow-glow"
        />
      </div>
    </div>
  );
};

export default StartFromScratch;
