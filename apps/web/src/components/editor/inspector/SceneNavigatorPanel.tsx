import React, { useState, useCallback, useMemo } from "react";
import {
  Film,
  ChevronLeft,
  ChevronRight,
  Play,
  Plus,
  Layers,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { getPlaybackBridge } from "../../../bridges/playback-bridge";

interface Scene {
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  color: string;
}

interface SceneNavigatorPanelProps {
  variant?: "horizontal" | "vertical" | "compact";
}

export const SceneNavigatorPanel: React.FC<SceneNavigatorPanelProps> = ({
  variant = "vertical",
}) => {
  const { project, addMarker } = useProjectStore();
  const markers = project.timeline.markers;
  const duration = project.timeline.duration;

  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);

  const scenes: Scene[] = useMemo(() => {
    if (markers.length === 0) {
      return [
        {
          id: "default",
          label: "Full Timeline",
          startTime: 0,
          endTime: duration,
          color: "#10b981",
        },
      ];
    }

    const sortedMarkers = [...markers].sort((a, b) => a.time - b.time);
    const sceneList: Scene[] = [];

    sortedMarkers.forEach((marker, index) => {
      const nextMarker = sortedMarkers[index + 1];
      const endTime = nextMarker ? nextMarker.time : duration;

      sceneList.push({
        id: marker.id,
        label: marker.label,
        startTime: marker.time,
        endTime,
        color: marker.color,
      });
    });

    if (sortedMarkers[0]?.time > 0) {
      sceneList.unshift({
        id: "intro",
        label: "Intro",
        startTime: 0,
        endTime: sortedMarkers[0].time,
        color: "#10b981",
      });
    }

    return sceneList;
  }, [markers, duration]);

  const currentScene = scenes[currentSceneIndex] || scenes[0];

  const handleSceneClick = useCallback(
    (index: number) => {
      setCurrentSceneIndex(index);
      const scene = scenes[index];
      if (scene) {
        const bridge = getPlaybackBridge();
        bridge.scrubTo(scene.startTime);
      }
    },
    [scenes],
  );

  const handlePrevious = useCallback(() => {
    const prevIndex = Math.max(0, currentSceneIndex - 1);
    handleSceneClick(prevIndex);
  }, [currentSceneIndex, handleSceneClick]);

  const handleNext = useCallback(() => {
    const nextIndex = Math.min(scenes.length - 1, currentSceneIndex + 1);
    handleSceneClick(nextIndex);
  }, [currentSceneIndex, scenes.length, handleSceneClick]);

  const handleAddScene = useCallback(() => {
    const bridge = getPlaybackBridge();
    const currentTime = bridge.getCurrentTime();
    addMarker(currentTime, `Scene ${markers.length + 1}`, "#10b981");
  }, [addMarker, markers.length]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getSceneDuration = (scene: Scene): number => {
    return scene.endTime - scene.startTime;
  };

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2">
        <IconButton
          label="Previous scene"
          icon={<ChevronLeft size={16} className="text-fg-2" />}
          variant="ghost"
          size="sm"
          onClick={handlePrevious}
          isDisabled={currentSceneIndex === 0}
          className="p-1.5 rounded hover:bg-bg-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        />

        <div className="flex items-center gap-1.5 px-2 py-1 bg-bg-2 rounded">
          <Film size={14} className="text-primary" />
          <span className="text-[11px] font-medium text-fg">
            {currentScene?.label || "Scene"}
          </span>
          <span className="text-[10px] text-fg-3">
            {currentSceneIndex + 1}/{scenes.length}
          </span>
        </div>

        <IconButton
          label="Next scene"
          icon={<ChevronRight size={16} className="text-fg-2" />}
          variant="ghost"
          size="sm"
          onClick={handleNext}
          isDisabled={currentSceneIndex === scenes.length - 1}
          className="p-1.5 rounded hover:bg-bg-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        />
      </div>
    );
  }

  if (variant === "horizontal") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film size={14} className="text-primary" />
            <span className="text-[11px] font-medium text-fg">
              Scenes
            </span>
            <span className="text-[10px] text-fg-3">
              ({scenes.length})
            </span>
          </div>
          <Button
            label="Add scene"
            variant="primary"
            icon={<Plus size={10} />}
            onClick={handleAddScene}
            className="flex items-center gap-1 px-2 py-1 bg-primary hover:bg-primary/80 text-white rounded text-[10px] font-medium transition-colors"
          >
            Add
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <IconButton
            label="Previous scene"
            icon={<ChevronLeft size={14} />}
            variant="ghost"
            size="sm"
            onClick={handlePrevious}
            isDisabled={currentSceneIndex === 0}
            className="p-1.5 rounded hover:bg-bg-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          />

          <div className="flex-1 flex items-center gap-1 overflow-x-auto">
            {scenes.map((scene, index) => {
              const isActive = index === currentSceneIndex;
              return (
                <SelectableCard
                  key={scene.id}
                  label={scene.label}
                  isSelected={isActive}
                  onChange={() => handleSceneClick(index)}
                  onClick={() => handleSceneClick(index)}
                  padding={1}
                  variant={isActive ? "green" : "muted"}
                  className={`group relative flex items-center gap-1 px-2 py-1 rounded transition-all ${
                    isActive
                      ? "bg-primary text-white"
                      : "bg-bg-2 hover:bg-bg-1 text-fg-2 hover:text-fg"
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: scene.color }}
                  />
                  <span className="text-[10px] font-medium whitespace-nowrap">
                    {index + 1}
                  </span>
                </SelectableCard>
              );
            })}
          </div>

          <IconButton
            label="Next scene"
            icon={<ChevronRight size={14} />}
            variant="ghost"
            size="sm"
            onClick={handleNext}
            isDisabled={currentSceneIndex === scenes.length - 1}
            className="p-1.5 rounded hover:bg-bg-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-2 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 rounded-lg border border-emerald-500/30">
        <Layers size={16} className="text-emerald-500" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-fg">
            Scene Navigator
          </span>
          <Text type="supporting" color="secondary" className="text-[9px] text-fg-3">
            Navigate between sections
          </Text>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film size={14} className="text-fg-2" />
          <span className="text-[11px] font-medium text-fg">
            Scenes
          </span>
          <span className="text-[10px] text-fg-3 bg-bg-2 px-1.5 py-0.5 rounded">
            {scenes.length}
          </span>
        </div>
        <Button
          label="Add Scene"
          variant="primary"
          icon={<Plus size={10} />}
          onClick={handleAddScene}
          className="flex items-center gap-1 px-2 py-1 bg-primary hover:bg-primary/80 text-white rounded text-[10px] font-medium transition-colors"
        >
          Add Scene
        </Button>
      </div>

      <div className="space-y-1 max-h-64 overflow-y-auto">
        {scenes.map((scene, index) => {
          const isActive = index === currentSceneIndex;
          const sceneDuration = getSceneDuration(scene);

          return (
            <SelectableCard
              key={scene.id}
              label={scene.label}
              isSelected={isActive}
              onChange={() => handleSceneClick(index)}
              onClick={() => handleSceneClick(index)}
              padding={2}
              variant={isActive ? "green" : "muted"}
              className={`w-full flex items-start gap-2 p-2 rounded transition-colors text-left ${
                isActive
                  ? "bg-primary/10 border border-primary/30"
                  : "hover:bg-bg-2 border border-transparent"
              }`}
            >
              <div
                className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] font-medium ${
                  isActive
                    ? "bg-primary text-white"
                    : "bg-bg-2 text-fg-3"
                }`}
              >
                {index + 1}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: scene.color }}
                  />
                  <span
                    className={`text-[11px] truncate ${isActive ? "text-fg font-medium" : "text-fg-2"}`}
                  >
                    {scene.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px] text-fg-3">
                    {formatTime(scene.startTime)} - {formatTime(scene.endTime)}
                  </span>
                  <span className="text-[9px] text-fg-3">•</span>
                  <span className="text-[9px] text-fg-3">
                    {sceneDuration.toFixed(1)}s
                  </span>
                </div>
              </div>

              {isActive && (
                <Play
                  size={12}
                  className="text-primary flex-shrink-0 mt-1"
                  fill="currentColor"
                />
              )}
            </SelectableCard>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Button
          label="Previous scene"
          variant="ghost"
          icon={<ChevronLeft size={12} />}
          onClick={handlePrevious}
          isDisabled={currentSceneIndex === 0}
          className="flex items-center gap-1 text-[10px] text-fg-3 hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Previous
        </Button>
        <span className="text-[9px] text-fg-3">
          Scene {currentSceneIndex + 1} of {scenes.length}
        </span>
        <Button
          label="Next scene"
          variant="ghost"
          onClick={handleNext}
          isDisabled={currentSceneIndex === scenes.length - 1}
          className="flex items-center gap-1 text-[10px] text-fg-3 hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next
          <ChevronRight size={12} />
        </Button>
      </div>
    </div>
  );
};

export default SceneNavigatorPanel;
