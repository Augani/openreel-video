import React, { useState } from "react";
import { Flag, Plus, Trash2, Edit2, Check, X } from "lucide-react";
import { Input, ScrollArea } from "@openreel/ui";
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
          <Flag size={14} className="text-text-secondary" />
          <span className="text-xs font-medium text-text-primary">Markers</span>
          <span className="text-xs text-text-muted">({markers.length})</span>
        </div>
        <button
          onClick={handleAddMarker}
          className="flex items-center gap-1 px-2 py-1 bg-primary hover:bg-primary/80 text-white rounded text-xs transition-colors"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {markers.length === 0 ? (
        <div className="py-8 text-center text-text-muted text-xs">
          <Flag size={32} className="mx-auto mb-2 opacity-30" />
          <p>No markers yet</p>
          <p className="text-[10px] mt-1">Press M at playhead to add markers</p>
        </div>
      ) : (
        <ScrollArea className="max-h-96">
          <div className="space-y-1">
            {markers
            .sort((a, b) => a.time - b.time)
            .map((marker) => (
              <div
                key={marker.id}
                className="group flex items-center gap-2 p-2 rounded hover:bg-background-tertiary transition-colors"
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
                    <Input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="h-7 text-xs bg-background-secondary border-border text-text-primary"
                      placeholder="Marker label"
                    />
                    <div className="flex gap-1">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => setEditColor(color)}
                          className={`w-5 h-5 rounded border-2 transition-all ${
                            editColor === color
                              ? "border-white scale-110"
                              : "border-transparent"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={handleSaveEdit}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs transition-colors"
                      >
                        <Check size={12} />
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-background-secondary hover:bg-background-primary text-text-secondary rounded text-xs transition-colors"
                      >
                        <X size={12} />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => handleJumpTo(marker)}
                      className="flex-1 flex items-center justify-between text-left hover:text-primary transition-colors"
                    >
                      <span className="text-xs text-text-primary">
                        {marker.label}
                      </span>
                      <span className="text-[10px] font-mono text-text-muted">
                        {formatTime(marker.time)}
                      </span>
                    </button>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleStartEdit(marker)}
                        className="p-1 hover:bg-background-secondary rounded text-text-muted hover:text-primary transition-colors"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={() => removeMarker(marker.id)}
                        className="p-1 hover:bg-background-secondary rounded text-text-muted hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};

export default MarkersPanel;
