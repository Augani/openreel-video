import React, { useRef, useState, useMemo } from "react";
import { useMontageStore } from "../../stores/montage-store";
import { useProjectStore } from "../../stores/project-store";
import {
  Shuffle,
  Trash2,
  Plus,
  Settings as SettingsIcon,
  Save,
  Play,
  Film,
  Music,
  Image as ImageIcon,
  X,
  ListRestart
} from "lucide-react";
import {
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Slider,
  ScrollArea,
  IconButton,
  Label
} from "@openreel/ui";
import { v4 as uuidv4 } from "uuid";
import type { MediaItem, Action } from "@openreel/core";

const MinimalMediaThumbnail = ({
  item,
  onDelete,
}: {
  item: MediaItem;
  onDelete: () => void;
}) => {
  const Icon =
    item.type === "audio" ? Music : item.type === "image" ? ImageIcon : Film;

  return (
    <div className="relative group aspect-video bg-background-tertiary rounded-lg overflow-hidden border border-border hover:border-primary/50 transition-all">
      {item.thumbnailUrl ? (
        <img
          src={item.thumbnailUrl}
          alt={item.name}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon className="text-text-muted opacity-50" />
        </div>
      )}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-full transition-colors"
          title="Remove from montage"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 text-[9px] text-white truncate">
        {item.name}
      </div>
    </div>
  );
};

export const MontageTab = () => {
  const {
    sourceMediaIds,
    settings,
    presets,
    addSourceMedia,
    removeSourceMedia,
    clearSourceMedia,
    updateSettings,
    savePreset,
    loadPreset,
    deletePreset,
    shuffleSourceMedia,
  } = useMontageStore();

  const { project, importMedia, addTrack, executeAction } = useProjectStore();

  const [presetName, setPresetName] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter media items that are in the source list
  const sourceItems = useMemo(() => {
    return sourceMediaIds
      .map((id) => project.mediaLibrary.items.find((m) => m.id === id))
      .filter((item): item is MediaItem => !!item);
  }, [sourceMediaIds, project.mediaLibrary.items]);

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const newMediaIds: string[] = [];

      for (const file of files) {
        const result = await importMedia(file);
        if (result.success && result.actionId) {
            // Note: importMedia returns actionId which is mediaId for import action in project-store implementation
            // But checking project-store implementation:
            // return { success: true, actionId: newMediaItem.id };
            // So yes, actionId is the mediaId.
          newMediaIds.push(result.actionId);
        }
      }
      addSourceMedia(newMediaIds);
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleGenerate = async () => {
    if (sourceItems.length === 0) return;
    setIsGenerating(true);

    try {
      // 1. Create a new track for the montage
      // We can't easily clear a track without ID, so creating new one is safer
      const trackResult = await addTrack("video");
      if (!trackResult.success || !trackResult.actionId) {
        console.error("Failed to create montage track");
        setIsGenerating(false);
        return;
      }

      // project-store addTrack returns action result.
      // The track ID is not directly returned in actionId usually, but let's check.
      // In project-store.ts:
      // return result;
      // execute returns ActionResult.
      // ActionExecutor returns { success, actionId: action.id } usually.
      // Wait, actionId is the ID of the ACTION, not the created track.
      // But addTrack creates a track with a generated ID.
      // I need to find the new track.
      // addTrack adds to project state.
      // The new track will be the last video track.

      // Let's get the latest state after addTrack
      const currentProject = useProjectStore.getState().project;
      const videoTracks = currentProject.timeline.tracks.filter(t => t.type === "video");
      const newTrack = videoTracks[videoTracks.length - 1];

      if (!newTrack) {
         console.error("Failed to find new montage track");
         setIsGenerating(false);
         return;
      }

      const trackId = newTrack.id;

      // 2. Add Clips
      let currentTime = 0;

      // Process each media item
      for (const item of sourceItems) {
        const mediaDuration = item.metadata?.duration || 5;
        let clipDuration = mediaDuration;
        let inPoint = 0;

        if (settings.spliceMode === "random") {
          // Random duration between min and max
          const min = Math.min(settings.minDuration, mediaDuration);
          const max = Math.min(settings.maxDuration, mediaDuration);

          if (max > min) {
             clipDuration = Math.random() * (max - min) + min;
          } else {
             clipDuration = min;
          }

          // Random inPoint
          if (mediaDuration > clipDuration) {
            inPoint = Math.random() * (mediaDuration - clipDuration);
          }
        } else if (settings.spliceMode === "sequential") {
           // Maybe sequential logic? For now behave like Full or just a fixed chunk?
           // "Sequential" usually means playing them in order.
           // If user selected "Sequential", maybe they mean "Full"?
           // Let's treat "Sequential" as "Full" for duration but ordered (which they already are).
           // Or maybe "Sequential" means taking 2s from A, then 2s from B...
           // Let's stick to "Random" splicing vs "Full" clips.
           // If Splice Mode is "Sequential", I'll assume it means "Full Clip".
           clipDuration = mediaDuration;
           inPoint = 0;
        }

        const action: Action = {
          type: "clip/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            trackId,
            mediaId: item.id,
            startTime: currentTime,
            duration: clipDuration,
            inPoint: inPoint,
            // outPoint is calculated from inPoint + duration usually, or just inPoint + duration
            outPoint: inPoint + clipDuration,
          },
        };

        await executeAction(action);
        currentTime += clipDuration;
      }

    } catch (error) {
      console.error("Failed to generate montage", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background-secondary w-full">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-bold text-lg text-text-primary">Montage Generator</h2>
        <p className="text-xs text-text-muted mt-1">
          Auto-generate video montages from selected clips
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-6">
          {/* Source Media Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-text-secondary">Source Media ({sourceItems.length})</Label>
              <div className="flex gap-1">
                <IconButton
                  icon={Shuffle}
                  size="sm"
                  onClick={shuffleSourceMedia}
                  title="Shuffle Order"
                  disabled={sourceItems.length < 2}
                />
                <IconButton
                  icon={ListRestart}
                  size="sm"
                  onClick={clearSourceMedia}
                  title="Clear All"
                  disabled={sourceItems.length === 0}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 min-h-[100px] bg-background-tertiary/30 rounded-lg p-2 border border-border border-dashed">
               {/* Add Button */}
               <button
                onClick={() => fileInputRef.current?.click()}
                className="aspect-video flex flex-col items-center justify-center gap-1 bg-background-tertiary hover:bg-primary/10 border border-border hover:border-primary/50 rounded-lg transition-all group"
              >
                <Plus size={20} className="text-text-muted group-hover:text-primary" />
                <span className="text-[9px] text-text-muted group-hover:text-primary">Add Media</span>
              </button>

              {sourceItems.map((item) => (
                <MinimalMediaThumbnail
                  key={item.id}
                  item={item}
                  onDelete={() => removeSourceMedia(item.id)}
                />
              ))}
            </div>

            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="video/*,image/*"
                className="hidden"
                onChange={handleFileImport}
            />
          </div>

          {/* Settings Section */}
          <div className="space-y-4 pt-4 border-t border-border">
            <h3 className="text-xs font-bold text-text-primary flex items-center gap-2">
                <SettingsIcon size={12} />
                Configuration
            </h3>

            <div className="space-y-3">
                <div className="space-y-1.5">
                    <Label className="text-[10px] text-text-secondary">Splicing Mode</Label>
                    <Select
                        value={settings.spliceMode}
                        onValueChange={(val: any) => updateSettings({ spliceMode: val })}
                    >
                        <SelectTrigger className="w-full text-xs">
                            <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="random">Random Splicing</SelectItem>
                            <SelectItem value="full">Full Clips</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {settings.spliceMode === "random" && (
                    <div className="space-y-3 pt-1">
                        <div className="space-y-1.5">
                            <div className="flex justify-between text-[10px]">
                                <Label className="text-text-secondary">Min Duration</Label>
                                <span className="text-text-muted font-mono">{settings.minDuration}s</span>
                            </div>
                            <Slider
                                value={[settings.minDuration]}
                                min={0.5}
                                max={10}
                                step={0.5}
                                onValueChange={(vals) => updateSettings({ minDuration: vals[0] })}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between text-[10px]">
                                <Label className="text-text-secondary">Max Duration</Label>
                                <span className="text-text-muted font-mono">{settings.maxDuration}s</span>
                            </div>
                            <Slider
                                value={[settings.maxDuration]}
                                min={1}
                                max={20}
                                step={0.5}
                                onValueChange={(vals) => updateSettings({ maxDuration: vals[0] })}
                            />
                        </div>
                    </div>
                )}
            </div>
          </div>

          {/* Presets Section */}
          <div className="space-y-3 pt-4 border-t border-border">
             <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                    <Label className="text-[10px] text-text-secondary">Save Preset</Label>
                    <Input
                        placeholder="Preset Name"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        className="h-8 text-xs"
                    />
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={!presetName}
                    onClick={() => {
                        savePreset(presetName);
                        setPresetName("");
                    }}
                >
                    <Save size={12} />
                </Button>
             </div>

             {presets.length > 0 && (
                 <div className="space-y-1.5">
                    <Label className="text-[10px] text-text-secondary">Load Preset</Label>
                    <div className="flex flex-wrap gap-1.5">
                        {presets.map(preset => (
                            <div key={preset.id} className="flex items-center bg-background-tertiary border border-border rounded text-[10px] pl-2 pr-1 py-0.5">
                                <span
                                    className="cursor-pointer hover:text-primary mr-1"
                                    onClick={() => loadPreset(preset.id)}
                                >
                                    {preset.name}
                                </span>
                                <button
                                    onClick={() => deletePreset(preset.id)}
                                    className="p-0.5 hover:text-red-500 rounded-full"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                 </div>
             )}
          </div>
        </div>
      </ScrollArea>

      {/* Footer Action */}
      <div className="p-5 border-t border-border bg-background-secondary z-10">
        <Button
            className="w-full gap-2"
            size="lg"
            onClick={handleGenerate}
            disabled={sourceItems.length === 0 || isGenerating}
        >
            {isGenerating ? (
                <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Generating...
                </>
            ) : (
                <>
                    <Play size={16} className="fill-current" />
                    Generate Montage
                </>
            )}
        </Button>
      </div>
    </div>
  );
};
