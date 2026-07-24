import React, { useState } from "react";
import { Flag, Plus, Trash2, Edit2, Check, X } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { getPlaybackBridge } from "../../../bridges/playback-bridge";
import type { Marker } from "@openreel/core";

export const MarkersPanel: React.FC = () => {
  const { project, addMarker, removeMarker, updateMarker } = useProjectStore();
  const markers = project.timeline.markers;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("");

  const handleAddMarker = () => {
    const bridge = getPlaybackBridge();
    const currentTime = bridge.getCurrentTime();
    addMarker(currentTime, `Marker ${markers.length + 1}`, "#3b82f6");
  };

  const handleJumpTo = (marker: Marker) => {
    const bridge = getPlaybackBridge();
    bridge.scrubTo(marker.time);
  };

  const handleStartEdit = (marker: Marker) => {
    setEditingId(marker.id);
    setEditLabel(marker.label);
    setEditColor(marker.color);
  };

  const handleSaveEdit = () => {
    if (editingId) {
      updateMarker(editingId, { label: editLabel, color: editColor });
      setEditingId(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditLabel("");
    setEditColor("");
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const frames = Math.floor((time % 1) * 30);
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
  };

  const PRESET_COLORS = [
    "#3b82f6", // blue
    "#10b981", // green
    "#f59e0b", // amber
    "#ef4444", // red
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#6366f1", // indigo
    "#14b8a6", // teal
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flag size={14} className="text-fg-2" aria-hidden />
          <Text type="body" color="primary" weight="bold" className="text-xs">
            Markers
          </Text>
          <Text type="supporting" color="secondary" className="text-xs">
            ({markers.length})
          </Text>
        </div>
        <Button
          label="Add"
          icon={<Plus size={12} aria-hidden />}
          variant="primary"
          size="sm"
          onClick={handleAddMarker}
        />
      </div>

      {markers.length === 0 ? (
        <div className="py-8 text-center text-fg-3 text-xs">
          <Flag size={32} className="mx-auto mb-2 opacity-30" aria-hidden />
          <Text type="supporting" color="secondary" className="block">
            No markers yet
          </Text>
          <Text type="supporting" color="secondary" className="text-[10px] mt-1 block">
            Press M at playhead to add markers
          </Text>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto pr-1">
          <div className="space-y-1">
            {markers
            .sort((a, b) => a.time - b.time)
            .map((marker) => (
              <Card
                key={marker.id}
                variant="transparent"
                padding={2}
                className="group flex items-center gap-2 transition-colors"
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor:
                      editingId === marker.id ? editColor : marker.color,
                  }}
                />

                {editingId === marker.id ? (
                  <div className="flex-1 space-y-2">
                    <ToolcraftTextInputControl
                      label="Marker label"
                      isLabelHidden
                      size="sm"
                      width="100%"
                      value={editLabel}
                      onChange={setEditLabel}
                      placeholder="Marker label"
                    />
                    <div className="flex gap-1">
                      {PRESET_COLORS.map((color) => (
                        <ClickableCard
                          key={color}
                          label={`Use marker color ${color}`}
                          onClick={() => setEditColor(color)}
                          padding={0}
                          width={20}
                          height={20}
                          className={`rounded border-2 transition-all ${
                            editColor === color ? "border-white scale-110" : "border-transparent"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        label="Save"
                        icon={<Check size={12} aria-hidden />}
                        variant="primary"
                        size="sm"
                        onClick={handleSaveEdit}
                        className="flex-1"
                      />
                      <Button
                        label="Cancel"
                        icon={<X size={12} aria-hidden />}
                        variant="secondary"
                        size="sm"
                        onClick={handleCancelEdit}
                        className="flex-1"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <ClickableCard
                      label={`Jump to ${marker.label}`}
                      onClick={() => handleJumpTo(marker)}
                      padding={0}
                      variant="transparent"
                      className="flex-1"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Text type="supporting" color="primary" className="text-xs">
                          {marker.label}
                        </Text>
                        <Text
                          type="supporting"
                          color="secondary"
                          className="text-[10px] font-mono"
                        >
                          {formatTime(marker.time)}
                        </Text>
                      </div>
                    </ClickableCard>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <IconButton
                        label={`Edit ${marker.label}`}
                        icon={<Edit2 size={12} aria-hidden />}
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartEdit(marker)}
                        className="text-fg-3 hover:text-primary"
                      />
                      <IconButton
                        label={`Remove ${marker.label}`}
                        icon={<Trash2 size={12} aria-hidden />}
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMarker(marker.id)}
                        className="text-fg-3 hover:text-red-500"
                      />
                    </div>
                  </>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MarkersPanel;
