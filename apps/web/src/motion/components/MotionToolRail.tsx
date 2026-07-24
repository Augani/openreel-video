import type { JSX } from "react";
import { useState } from "react";
import {
  Baseline,
  Box,
  Circle,
  Crosshair,
  Hand,
  Layers,
  MousePointer2,
  Move,
  PenTool,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePlus,
  Type,
  ZoomIn,
  type LucideIcon,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import {
  createMotionLayerOfType,
  type CreatableMotionLayerType,
} from "../motion-layer-factory";
import { useMotionStore, type MotionToolId } from "../stores/motion-store";
import { Button, IconButton } from "./primitives";

interface ToolDef {
  id: MotionToolId;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

const TOOL_GROUPS: ReadonlyArray<ReadonlyArray<ToolDef>> = [
  [
    { id: "select", icon: MousePointer2, label: "Selection", shortcut: "V" },
    { id: "hand", icon: Hand, label: "Hand", shortcut: "H" },
    { id: "zoom", icon: ZoomIn, label: "Zoom", shortcut: "Z" },
  ],
  [
    { id: "move", icon: Move, label: "Move" },
    { id: "rotate", icon: RotateCw, label: "Rotate" },
    { id: "anchor", icon: Crosshair, label: "Anchor Point" },
  ],
  [
    { id: "rectangle", icon: Square, label: "Rectangle", shortcut: "Q" },
    { id: "ellipse", icon: Circle, label: "Ellipse" },
    { id: "pen", icon: PenTool, label: "Pen", shortcut: "G" },
    { id: "text", icon: Type, label: "Type", shortcut: "⌘T" },
    { id: "character", icon: Baseline, label: "Character" },
  ],
];

const ADD_MENU: ReadonlyArray<{
  type: CreatableMotionLayerType;
  icon: LucideIcon;
  label: string;
}> = [
  { type: "text", icon: Type, label: "Text layer" },
  { type: "shape", icon: Square, label: "Shape layer" },
  { type: "scene3d", icon: Box, label: "3D scene" },
  { type: "particle", icon: Sparkles, label: "Particle layer" },
  { type: "adjustment", icon: SlidersHorizontal, label: "Adjustment layer" },
  { type: "group", icon: Layers, label: "Group layer" },
  { type: "null", icon: Crosshair, label: "Null controller" },
];

export function MotionToolRail(): JSX.Element {
  const activeTool = useMotionStore((state) => state.activeTool);
  const setActiveTool = useMotionStore((state) => state.setActiveTool);
  const activeCompositionId = useMotionStore((state) => state.activeCompositionId);
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const composition = useProjectStore((state) =>
    (state.project.motionCompositions ?? []).find(
      (item) => item.id === activeCompositionId,
    ),
  );
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const [addOpen, setAddOpen] = useState(false);

  const addLayer = (type: CreatableMotionLayerType) => {
    if (!composition) return;
    const layer = createMotionLayerOfType(composition, type);
    void upsertMotionComposition({
      ...composition,
      layers: [...composition.layers, layer],
      modifiedAt: Date.now(),
    });
    selectLayer(layer.id);
    if (type === "text") setRightTab("properties");
    setAddOpen(false);
  };

  return (
    <nav
      aria-label="Motion tools"
      className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-bg-1 py-3.5"
    >
      {TOOL_GROUPS.map((group, groupIndex) => (
        <div key={groupIndex} className="flex flex-col items-center gap-1">
          {group.map((tool) => (
            <ToolButton
              key={tool.id}
              tool={tool}
              active={activeTool === tool.id}
              onClick={() => {
                setActiveTool(tool.id);
                if (tool.id === "character") setRightTab("properties");
              }}
            />
          ))}
          {groupIndex < TOOL_GROUPS.length - 1 ? (
            <span className="my-1 h-px w-6 bg-border" />
          ) : null}
        </div>
      ))}
      <div className="relative mt-auto flex flex-col items-center gap-1">
        <span className="mb-1 h-px w-6 bg-border" />
        <IconButton
          label="Add layer"
          icon={SquarePlus}
          iconSize={17}
          size="md"
          active={addOpen}
          variant="ghost"
          aria-expanded={addOpen}
          isDisabled={!composition}
          onClick={() => setAddOpen((value) => !value)}
        />
        {addOpen ? (
          <>
            <div
              aria-hidden="true"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setAddOpen(false)}
            />
            <div className="absolute bottom-0 left-[calc(100%+6px)] z-50 w-48 overflow-hidden rounded-lg border border-border bg-bg-elev p-1.5 shadow-lg">
              {ADD_MENU.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.type}
                    label={item.label}
                    variant="ghost"
                    size="sm"
                    icon={Icon}
                    onClick={() => addLayer(item.type)}
                    className="w-full justify-start"
                  />
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}

function ToolButton({
  tool,
  active,
  onClick,
}: {
  tool: ToolDef;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const Icon = tool.icon;
  const tip = tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label;
  return (
    <IconButton
      label={tip}
      icon={Icon}
      iconSize={17}
      size="md"
      active={active}
      variant="ghost"
      aria-pressed={active}
      onClick={onClick}
    />
  );
}
