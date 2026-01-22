import { memo, lazy, Suspense } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import { useUIStore } from '../../../stores/ui-store';
import { TransformSection } from './TransformSection';
import { AlignmentSection } from './AlignmentSection';
import { AppearanceSection } from './AppearanceSection';
import { EffectsSection } from './EffectsSection';
import { ArtboardSection } from './ArtboardSection';
import { PenSettingsSection } from './PenSettingsSection';
import { ColorHarmonySection } from './ColorHarmonySection';
import type { Layer, ImageLayer, TextLayer, ShapeLayer } from '../../../types/project';

const ImageAdjustmentsSection = lazy(() => import('./ImageAdjustmentsSection').then(m => ({ default: m.ImageAdjustmentsSection })));
const FilterPresetsSection = lazy(() => import('./FilterPresetsSection').then(m => ({ default: m.FilterPresetsSection })));
const CropSection = lazy(() => import('./CropSection').then(m => ({ default: m.CropSection })));
const ImageControlsSection = lazy(() => import('./ImageControlsSection').then(m => ({ default: m.ImageControlsSection })));
const BackgroundRemovalSection = lazy(() => import('./BackgroundRemovalSection').then(m => ({ default: m.BackgroundRemovalSection })));
const TextSection = lazy(() => import('./TextSection').then(m => ({ default: m.TextSection })));
const ShapeSection = lazy(() => import('./ShapeSection').then(m => ({ default: m.ShapeSection })));
const LevelsSection = lazy(() => import('./LevelsSection').then(m => ({ default: m.LevelsSection })));
const CurvesSection = lazy(() => import('./CurvesSection').then(m => ({ default: m.CurvesSection })));
const ColorBalanceSection = lazy(() => import('./ColorBalanceSection').then(m => ({ default: m.ColorBalanceSection })));
const MaskSection = lazy(() => import('./MaskSection').then(m => ({ default: m.MaskSection })));
const SelectionToolsPanel = lazy(() => import('./SelectionToolsPanel').then(m => ({ default: m.SelectionToolsPanel })));
const EraserToolPanel = lazy(() => import('./EraserToolPanel').then(m => ({ default: m.EraserToolPanel })));
const DodgeBurnToolPanel = lazy(() => import('./DodgeBurnToolPanel').then(m => ({ default: m.DodgeBurnToolPanel })));

function SectionLoader() {
  return <div className="h-8 animate-pulse bg-muted/30 rounded" />;
}

function InspectorContent() {
  const { project, selectedLayerIds, selectedArtboardId } = useProjectStore();
  const { activeTool } = useUIStore();

  const selectedLayers = selectedLayerIds
    .map((id) => project?.layers[id])
    .filter((layer): layer is Layer => layer !== undefined);

  const singleLayer = selectedLayers.length === 1 ? selectedLayers[0] : null;

  const isSelectionTool = [
    'marquee-rect',
    'marquee-ellipse',
    'lasso',
    'lasso-polygon',
    'magic-wand',
  ].includes(activeTool);

  if (selectedLayers.length === 0) {
    if (activeTool === 'pen') {
      return (
        <div className="p-4">
          <PenSettingsSection />
        </div>
      );
    }

    if (isSelectionTool) {
      return (
        <div className="p-4">
          <Suspense fallback={<SectionLoader />}>
            <SelectionToolsPanel />
          </Suspense>
        </div>
      );
    }

    if (activeTool === 'eraser') {
      return (
        <div className="p-4">
          <Suspense fallback={<SectionLoader />}>
            <EraserToolPanel />
          </Suspense>
        </div>
      );
    }

    if (activeTool === 'dodge' || activeTool === 'burn') {
      return (
        <div className="p-4">
          <Suspense fallback={<SectionLoader />}>
            <DodgeBurnToolPanel />
          </Suspense>
        </div>
      );
    }

    const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);
    if (artboard) {
      return (
        <div className="p-4">
          <h3 className="text-sm font-medium text-foreground mb-4">Artboard</h3>
          <ArtboardSection artboard={artboard} />
        </div>
      );
    }

    return (
      <div className="p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Select a layer to edit its properties
        </p>
      </div>
    );
  }

  if (selectedLayers.length > 1) {
    return (
      <div className="p-4 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">
            {selectedLayers.length} layers selected
          </h3>
        </div>
        <AlignmentSection layers={selectedLayers} />
      </div>
    );
  }

  if (!singleLayer) return null;

  return (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="text-sm font-medium text-foreground mb-1 truncate">
          {singleLayer.name}
        </h3>
        <p className="text-xs text-muted-foreground capitalize">{singleLayer.type} layer</p>
      </div>

      <TransformSection layer={singleLayer} />

      <AlignmentSection layers={[singleLayer]} />

      <AppearanceSection layer={singleLayer} />

      <EffectsSection layer={singleLayer} />

      {singleLayer.type === 'image' && (
        <Suspense fallback={<SectionLoader />}>
          <ImageControlsSection layer={singleLayer as ImageLayer} />
          <CropSection layer={singleLayer as ImageLayer} />
          <BackgroundRemovalSection layer={singleLayer as ImageLayer} />
          <FilterPresetsSection layer={singleLayer as ImageLayer} />
          <ImageAdjustmentsSection layer={singleLayer as ImageLayer} />
          <LevelsSection layer={singleLayer} />
          <CurvesSection layer={singleLayer} />
          <ColorBalanceSection layer={singleLayer} />
        </Suspense>
      )}

      <Suspense fallback={<SectionLoader />}>
        <MaskSection layer={singleLayer} />
      </Suspense>

      {singleLayer.type === 'text' && (
        <Suspense fallback={<SectionLoader />}>
          <TextSection layer={singleLayer as TextLayer} />
          <ColorHarmonySection
            baseColor={(singleLayer as TextLayer).style.color}
            onColorSelect={(color) => {
              useProjectStore.getState().updateLayer<TextLayer>(singleLayer.id, {
                style: { ...(singleLayer as TextLayer).style, color },
              });
            }}
          />
        </Suspense>
      )}

      {singleLayer.type === 'shape' && (
        <Suspense fallback={<SectionLoader />}>
          <ShapeSection layer={singleLayer as ShapeLayer} />
          {(singleLayer as ShapeLayer).shapeStyle.fill && (
            <ColorHarmonySection
              baseColor={(singleLayer as ShapeLayer).shapeStyle.fill!}
              onColorSelect={(color) => {
                useProjectStore.getState().updateLayer<ShapeLayer>(singleLayer.id, {
                  shapeStyle: { ...(singleLayer as ShapeLayer).shapeStyle, fill: color },
                });
              }}
            />
          )}
        </Suspense>
      )}
    </div>
  );
}

export const Inspector = memo(InspectorContent);
