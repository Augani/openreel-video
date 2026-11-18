import React, { useCallback, useMemo, useState } from "react";
import { Button, cn } from "@openreel/ui";
import { Card } from "@openreel/ui";



import { InspectorToggle } from "./shell/InspectorControls";
import { PathTypeGlyph } from "./motion-glyphs";
import { Route, Trash2, Plus, Eye, EyeOff } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useEngineStore } from "../../../stores/engine-store";
import {
  getGSAPEngine,
  generateDefaultControlPoints,
  type GSAPMotionPathPoint,
} from "@openreel/core";

interface MotionPathSectionProps {
  clipId: string;
}

export const MotionPathSection: React.FC<MotionPathSectionProps> = ({
  clipId,
}) => {
  const { getClip, project } = useProjectStore();
  const { motionPathMode, motionPathClipId, setMotionPathMode } = useUIStore();
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const [forceUpdate, setForceUpdate] = useState(0);

  const clip = useMemo(() => {
    const timelineClip = getClip(clipId);
    if (timelineClip) return timelineClip;

    const graphicsEngine = getGraphicsEngine();
    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) return svgClip;

    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) return shapeClip;

    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) return stickerClip;

    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) return textClip;

    return undefined;
  }, [clipId, getClip, getGraphicsEngine, getTitleEngine, project.modifiedAt]);

  const gsapEngine = useMemo(() => getGSAPEngine(), []);

  const motionPath = useMemo(() => {
    return gsapEngine.getMotionPath(clipId);
  }, [clipId, gsapEngine, forceUpdate]);

  const isEditing = motionPathMode && motionPathClipId === clipId;

  const handleEnableToggle = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        const existingPath = gsapEngine.getMotionPath(clipId);
        if (!existingPath) {
          const defaultPoints: GSAPMotionPathPoint[] = [
            { x: 0, y: 0, time: 0 },
            { x: 100, y: 0, time: 1 },
          ];
          gsapEngine.setMotionPath(clipId, {
            enabled: true,
            pathType: "bezier",
            points: generateDefaultControlPoints(defaultPoints),
            showPath: true,
            autoOrient: false,
            alignOrigin: [0.5, 0.5],
          });
        } else {
          gsapEngine.setMotionPath(clipId, { ...existingPath, enabled: true });
        }
      } else {
        const existingPath = gsapEngine.getMotionPath(clipId);
        if (existingPath) {
          gsapEngine.setMotionPath(clipId, { ...existingPath, enabled: false });
        }
      }
      setForceUpdate((v) => v + 1);
    },
    [clipId, gsapEngine]
  );

  const handleShowPathToggle = useCallback(
    (show: boolean) => {
      const path = gsapEngine.getMotionPath(clipId);
      if (path) {
        gsapEngine.setMotionPath(clipId, { ...path, showPath: show });
        setForceUpdate((v) => v + 1);
      }
    },
    [clipId, gsapEngine]
  );

  const handleAutoOrientToggle = useCallback(
    (autoOrient: boolean) => {
      const path = gsapEngine.getMotionPath(clipId);
      if (path) {
        gsapEngine.setMotionPath(clipId, { ...path, autoOrient });
        setForceUpdate((v) => v + 1);
      }
    },
    [clipId, gsapEngine]
  );

  const handlePathTypeChange = useCallback(
    (pathType: "linear" | "bezier" | "catmull-rom") => {
      const path = gsapEngine.getMotionPath(clipId);
      if (path) {
        gsapEngine.setMotionPath(clipId, { ...path, pathType });
        setForceUpdate((v) => v + 1);
      }
    },
    [clipId, gsapEngine]
  );

  const handleEditMode = useCallback(() => {
    if (isEditing) {
      setMotionPathMode(false);
    } else {
      setMotionPathMode(true, clipId);
    }
  }, [isEditing, clipId, setMotionPathMode]);

  const handleAddPoint = useCallback(() => {
    const path = gsapEngine.getMotionPath(clipId);
    if (!path) return;

    const lastPoint = path.points[path.points.length - 1];
    const newPoint: GSAPMotionPathPoint = {
      x: lastPoint.x + 50,
      y: lastPoint.y,
      time: Math.min(1, lastPoint.time + 0.2),
    };

    gsapEngine.addGSAPMotionPathPoint(clipId, newPoint);
    setForceUpdate((v) => v + 1);
  }, [clipId, gsapEngine]);

  const handleClearPath = useCallback(() => {
    gsapEngine.removeMotionPath(clipId);
    setMotionPathMode(false);
    setForceUpdate((v) => v + 1);
  }, [clipId, gsapEngine, setMotionPathMode]);

  if (!clip) {
    return (
      <span className="text-fg-2 font-normal py-8 text-center text-xs">
        No clip selected
      </span>
    );
  }

  const isEnabled = motionPath?.enabled ?? false;
  const showPath = motionPath?.showPath ?? true;
  const autoOrient = motionPath?.autoOrient ?? false;
  const pathType = motionPath?.pathType ?? "bezier";
  const pointCount = motionPath?.points.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Route size={14} className="text-primary" />
          <span className="text-fg text-xs font-medium">
            Motion Path
          </span>
        </div>
        <InspectorToggle
          ariaLabel="Enable motion path"
          checked={isEnabled}
          onChange={handleEnableToggle}
        />
      </div>

      {isEnabled && (
        <>
          <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-fg-2 font-normal text-[10px]">
                Show Path
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon-sm" onClick={() => handleShowPathToggle(!showPath)} type="button" aria-label={showPath ? "Hide path" : "Show path"} title={showPath ? "Hide path" : "Show path"} className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 w-7", (showPath ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"), `p-1.5 rounded transition-colors ${
                    showPath
                      ? "bg-primary/20 text-primary"
                      : "bg-bg-elev text-fg-3"
                  }`)}>
                  {showPath ? <Eye size={12} /> : <EyeOff size={12} />}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-fg-2 font-normal text-[10px]">
                Auto Orient
              </span>
              <InspectorToggle
                ariaLabel="Auto Orient"
                checked={autoOrient}
                onChange={handleAutoOrientToggle}
              />
            </div>

            <div className="space-y-1">
              <span className="text-fg-2 font-normal text-[10px]">
                Path Type
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(["linear", "bezier", "catmull-rom"] as const).map((type) => (
                  <Button variant="ghost" key={type} onClick={() => handlePathTypeChange(type)} type="button" aria-label={`Set path type to ${type}`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", "border-border bg-bg-1 hover:bg-bg-2", "p-3", `py-1.5 px-1.5 rounded text-[9px] text-center capitalize transition-colors ${
                      pathType === type
                        ? "bg-primary text-white"
                        : "bg-bg-elev border border-border text-fg-2 hover:text-fg"
                    }`)}>
                    <PathTypeGlyph type={type} className="mx-auto mb-1 !h-7 !w-full" />
                    {type === "catmull-rom" ? "Smooth" : type}
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-fg-2 font-normal text-[10px]">
                Path Points
              </span>
              <span className="text-fg text-sm font-medium">
                {pointCount} points
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={handleAddPoint} type="button" aria-label="Add point" title="Add point" className="inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 p-1.5 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors">
                {<Plus size={12} />}
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={handleClearPath} type="button" aria-label="Clear path" title="Clear path" className="inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 border border-border hover:text-fg p-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                {<Trash2 size={12} />}
              </Button>
            </div>
          </Card>

          <Button onClick={handleEditMode} type="button" aria-label={(isEditing ? "Exit Edit Mode" : "Edit Path on Canvas").trim() || undefined} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (isEditing ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"), `w-full ${
              isEditing
                ? "bg-primary text-white"
                : "bg-bg-2 text-fg border border-border hover:bg-bg-elev"
            }`)}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Route size={14} />}</span>
            <span className="truncate">{isEditing ? "Exit Edit Mode" : "Edit Path on Canvas"}</span>
          </Button>

          {isEditing && (
            <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 border border-primary/30 bg-primary/10">
              <span className="font-normal text-[9px] text-primary">
                <span className="text-[12px] leading-5 font-medium text-primary">
                  Editing:
                </span>{" "}
                Click on the path
                to add points. Drag points to move them. Right-click to remove.
                Drag handles to adjust curves.
              </span>
            </Card>
          )}

          <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 border border-border bg-bg-2/50">
            <span className="text-fg-2 font-normal text-[9px]">
              <span className="text-[12px] leading-5 font-medium text-fg-2">
                Tip:
              </span>{" "}
              Motion paths animate the clip's position along a curved path over
              time. Use bezier handles for smooth curves.
            </span>
          </Card>
        </>
      )}
    </div>
  );
};

