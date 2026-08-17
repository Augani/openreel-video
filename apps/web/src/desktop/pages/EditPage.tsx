import type { JSX } from "react";
import type React from "react";
import { lazy, Suspense } from "react";
import { ToolcraftText as Text } from "@openreel/ui";

import { AssetsPanel } from "../../components/editor/AssetsPanel";
import { InspectorPanel } from "../../components/editor/InspectorPanel";
import { PanelErrorBoundary } from "../../components/ErrorBoundary";
import { Icon } from "@/icons/Icon";
import { useResizable } from "../editor/useResizable";
import { useTranslation } from "react-i18next";

const Preview = lazy(() =>
  import("../../components/editor/Preview").then((m) => ({ default: m.Preview })),
);
const Timeline = lazy(() =>
  import("../../components/editor/Timeline").then((m) => ({ default: m.Timeline })),
);

function PanelLoading(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid h-full place-items-center">
      <Text type="supporting" color="secondary" className="text-xs">
        {t("Loading…")}</Text>
    </div>
  );
}

function DockRegion({
  label,
  name,
  area,
  icon,
  className,
  children,
}: {
  label: string;
  name: string;
  area: string;
  icon: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden ${className ?? "bg-bg-1"}`}
      style={{ gridArea: area }}
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-bg-1 px-3 text-[11px] font-medium uppercase tracking-wide text-fg-2">
        <Icon name={icon} size={12} className="text-fg-muted" />
        <Text type="supporting" color="secondary" weight="medium" className="text-[11px] uppercase tracking-wide">
          {label}
        </Text>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <PanelErrorBoundary name={name}>{children}</PanelErrorBoundary>
      </div>
    </div>
  );
}

function ColumnHandle({
  edge,
  onPointerDown,
}: {
  edge: "left" | "right";
  onPointerDown(e: React.PointerEvent): void;
}): JSX.Element {
  const position = edge === "left" ? "left-0" : "right-0";
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className={`absolute top-0 ${position} z-10 h-full w-1.5 cursor-col-resize bg-border transition-colors hover:bg-accent/40`}
    />
  );
}

function RowHandle({
  onPointerDown,
}: {
  onPointerDown(e: React.PointerEvent): void;
}): JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={onPointerDown}
      className="absolute left-0 top-0 z-10 h-1.5 w-full cursor-row-resize bg-border transition-colors hover:bg-accent/40"
    />
  );
}

export function EditPage(): JSX.Element {
  const { t } = useTranslation();
  const mediaW = useResizable({
    initial: 320,
    min: 220,
    max: 520,
    axis: "x",
    direction: 1,
    storageKey: "openreel-desktop-media-w",
  });
  const inspectorW = useResizable({
    initial: 340,
    min: 260,
    max: 560,
    axis: "x",
    direction: -1,
    storageKey: "openreel-desktop-inspector-w",
  });
  const timelineH = useResizable({
    initial: 320,
    min: 160,
    max: 640,
    axis: "y",
    direction: -1,
    storageKey: "openreel-desktop-timeline-h",
  });

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `${mediaW.value}px 1fr ${inspectorW.value}px`,
    gridTemplateRows: `1fr ${timelineH.value}px`,
    gridTemplateAreas: "'media stage inspector' 'timeline timeline timeline'",
  };

  return (
    <div className="grid h-full min-h-0 w-full gap-px overflow-hidden bg-border" style={gridStyle}>
      <DockRegion label={t("Media")} name="Media" area="media" icon="photo.on.rectangle">
        <AssetsPanel />
        <ColumnHandle edge="right" onPointerDown={mediaW.onHandlePointerDown} />
      </DockRegion>

      <DockRegion label={t("Viewer")} name="Viewer" area="stage" icon="play.fill" className="bg-stage-bg">
        <Suspense fallback={<PanelLoading />}>
          <Preview />
        </Suspense>
      </DockRegion>

      <DockRegion label={t("Inspector")} name="Inspector" area="inspector" icon="slider.horizontal.3">
        <InspectorPanel />
        <ColumnHandle edge="left" onPointerDown={inspectorW.onHandlePointerDown} />
      </DockRegion>

      <DockRegion label={t("Timeline")} name="Timeline" area="timeline" icon="rectangle.split.3x1" className="bg-tl-bg">
        <Suspense fallback={<PanelLoading />}>
          <Timeline />
        </Suspense>
        <RowHandle onPointerDown={timelineH.onHandlePointerDown} />
      </DockRegion>
    </div>
  );
}

export default EditPage;
