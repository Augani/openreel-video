import { memo, lazy, Suspense, useState, createContext, useContext, ReactNode, JSX } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import { useUIStore } from '../../../stores/ui-store';
import { TransformSection } from './TransformSection';
import { AlignmentSection } from './AlignmentSection';
import { AppearanceSection } from './AppearanceSection';
import { EffectsSection } from './EffectsSection';
import { ArtboardSection } from './ArtboardSection';
import { PenSettingsSection } from './PenSettingsSection';
import { ColorHarmonySection } from './ColorHarmonySection';
import { ChevronRight, Sliders, Palette, Wand2, Sparkles, Image as ImageIcon, Layers } from 'lucide-react';
import { ScrollArea } from '@openreel/ui';
import type { Layer, ImageLayer, TextLayer, ShapeLayer } from '../../../types/project';
import type { Tool } from '../../../stores/ui-store';

const TOOL_FOCUSED_TOOLS = new Set<Tool>([
  'pen', 'brush', 'eraser', 'gradient', 'paint-bucket',
  'dodge', 'burn', 'sponge', 'blur', 'sharpen', 'smudge',
  'clone-stamp', 'healing-brush', 'spot-healing', 'liquify',
  'marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-polygon', 'magic-wand',
  'free-transform', 'warp', 'perspective', 'crop'
]);

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
const SelectiveColorSection = lazy(() => import('./SelectiveColorSection').then(m => ({ default: m.SelectiveColorSection })));
const BlackWhiteSection = lazy(() => import('./BlackWhiteSection').then(m => ({ default: m.BlackWhiteSection })));
const PhotoFilterSection = lazy(() => import('./PhotoFilterSection').then(m => ({ default: m.PhotoFilterSection })));
const ChannelMixerSection = lazy(() => import('./ChannelMixerSection').then(m => ({ default: m.ChannelMixerSection })));
const GradientMapSection = lazy(() => import('./GradientMapSection').then(m => ({ default: m.GradientMapSection })));
const PosterizeSection = lazy(() => import('./PosterizeSection').then(m => ({ default: m.PosterizeSection })));
const ThresholdSection = lazy(() => import('./ThresholdSection').then(m => ({ default: m.ThresholdSection })));
const MaskSection = lazy(() => import('./MaskSection').then(m => ({ default: m.MaskSection })));
const SelectionToolsPanel = lazy(() => import('./SelectionToolsPanel').then(m => ({ default: m.SelectionToolsPanel })));
const EraserToolPanel = lazy(() => import('./EraserToolPanel').then(m => ({ default: m.EraserToolPanel })));
const DodgeBurnToolPanel = lazy(() => import('./DodgeBurnToolPanel').then(m => ({ default: m.DodgeBurnToolPanel })));
const CloneStampToolPanel = lazy(() => import('./CloneStampToolPanel').then(m => ({ default: m.CloneStampToolPanel })));
const HealingBrushToolPanel = lazy(() => import('./HealingBrushToolPanel').then(m => ({ default: m.HealingBrushToolPanel })));
const SpotHealingToolPanel = lazy(() => import('./SpotHealingToolPanel').then(m => ({ default: m.SpotHealingToolPanel })));
const SpongeToolPanel = lazy(() => import('./SpongeToolPanel').then(m => ({ default: m.SpongeToolPanel })));
const LiquifyToolPanel = lazy(() => import('./LiquifyToolPanel').then(m => ({ default: m.LiquifyToolPanel })));
const TransformToolPanel = lazy(() => import('./TransformToolPanel').then(m => ({ default: m.TransformToolPanel })));
const BrushToolPanel = lazy(() => import('./BrushToolPanel').then(m => ({ default: m.BrushToolPanel })));
const BlurSharpenToolPanel = lazy(() => import('./BlurSharpenToolPanel').then(m => ({ default: m.BlurSharpenToolPanel })));
const SmudgeToolPanel = lazy(() => import('./SmudgeToolPanel').then(m => ({ default: m.SmudgeToolPanel })));
const GradientToolPanel = lazy(() => import('./GradientToolPanel').then(m => ({ default: m.GradientToolPanel })));
const PaintBucketToolPanel = lazy(() => import('./PaintBucketToolPanel').then(m => ({ default: m.PaintBucketToolPanel })));

function SectionLoader() {
  return (
    <div className="px-4 py-3">
      <div className="h-4 w-24 animate-pulse bg-muted/40 rounded mb-3" />
      <div className="space-y-2">
        <div className="h-8 animate-pulse bg-muted/30 rounded" />
        <div className="h-8 animate-pulse bg-muted/30 rounded" />
      </div>
    </div>
  );
}

type AccordionContextType = {
  openItems: string[];
  toggle: (id: string) => void;
};

const AccordionContext = createContext<AccordionContextType | null>(null);

interface AccordionProps {
  children: ReactNode;
  defaultOpen?: string[];
}

function Accordion({ children, defaultOpen = [] }: AccordionProps) {
  const [openItems, setOpenItems] = useState<string[]>(defaultOpen);

  const toggle = (id: string) => {
    setOpenItems(prev =>
      prev.includes(id)
        ? prev.filter(item => item !== id)
        : [...prev, id]
    );
  };

  return (
    <AccordionContext.Provider value={{ openItems, toggle }}>
      <div className="divide-y divide-border">{children}</div>
    </AccordionContext.Provider>
  );
}

interface AccordionItemProps {
  id: string;
  icon?: React.ElementType;
  title: string;
  children: ReactNode;
  badge?: number;
}

function AccordionItem({ id, icon: Icon, title, children, badge }: AccordionItemProps) {
  const context = useContext(AccordionContext);
  if (!context) return null;

  const { openItems, toggle } = context;
  const isOpen = openItems.includes(id);

  return (
    <div>
      <button
        onClick={() => toggle(id)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <ChevronRight
          size={14}
          className={`text-muted-foreground shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
        />
        {Icon && <Icon size={16} className="text-muted-foreground shrink-0" />}
        <span className="text-sm font-medium text-foreground flex-1">{title}</span>
        {badge !== undefined && badge > 0 && (
          <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

function renderToolPanel(tool: Tool, imageLayer?: ImageLayer): JSX.Element | null {
  const SELECTION_TOOLS = ['marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-polygon', 'magic-wand'];
  const TRANSFORM_TOOLS = ['free-transform', 'warp', 'perspective'];

  if (SELECTION_TOOLS.includes(tool)) {
    return (
      <Suspense fallback={<SectionLoader />}>
        <SelectionToolsPanel />
      </Suspense>
    );
  }

  if (TRANSFORM_TOOLS.includes(tool)) {
    return (
      <Suspense fallback={<SectionLoader />}>
        <TransformToolPanel />
      </Suspense>
    );
  }

  switch (tool) {
    case 'pen':
      return <PenSettingsSection />;
    case 'brush':
      return (
        <Suspense fallback={<SectionLoader />}>
          <BrushToolPanel />
        </Suspense>
      );
    case 'eraser':
      return (
        <Suspense fallback={<SectionLoader />}>
          <EraserToolPanel />
        </Suspense>
      );
    case 'gradient':
      return (
        <Suspense fallback={<SectionLoader />}>
          <GradientToolPanel />
        </Suspense>
      );
    case 'dodge':
    case 'burn':
      return (
        <Suspense fallback={<SectionLoader />}>
          <DodgeBurnToolPanel />
        </Suspense>
      );
    case 'sponge':
      return (
        <Suspense fallback={<SectionLoader />}>
          <SpongeToolPanel />
        </Suspense>
      );
    case 'blur':
    case 'sharpen':
      return (
        <Suspense fallback={<SectionLoader />}>
          <BlurSharpenToolPanel />
        </Suspense>
      );
    case 'smudge':
      return (
        <Suspense fallback={<SectionLoader />}>
          <SmudgeToolPanel />
        </Suspense>
      );
    case 'clone-stamp':
      return (
        <Suspense fallback={<SectionLoader />}>
          <CloneStampToolPanel />
        </Suspense>
      );
    case 'healing-brush':
      return (
        <Suspense fallback={<SectionLoader />}>
          <HealingBrushToolPanel />
        </Suspense>
      );
    case 'spot-healing':
      return (
        <Suspense fallback={<SectionLoader />}>
          <SpotHealingToolPanel />
        </Suspense>
      );
    case 'liquify':
      return (
        <Suspense fallback={<SectionLoader />}>
          <LiquifyToolPanel />
        </Suspense>
      );
    case 'paint-bucket':
      return (
        <Suspense fallback={<SectionLoader />}>
          <PaintBucketToolPanel />
        </Suspense>
      );
    case 'crop':
      if (imageLayer) {
        return (
          <Suspense fallback={<SectionLoader />}>
            <CropSection layer={imageLayer} />
          </Suspense>
        );
      }
      return null;
    default:
      return null;
  }
}

function InspectorContent() {
  const { project, selectedLayerIds, selectedArtboardId } = useProjectStore();
  const { activeTool } = useUIStore();

  const selectedLayers = selectedLayerIds
    .map((id) => project?.layers[id])
    .filter((layer): layer is Layer => layer !== undefined);

  const singleLayer = selectedLayers.length === 1 ? selectedLayers[0] : null;
  const imageLayer = singleLayer?.type === 'image' ? (singleLayer as ImageLayer) : undefined;

  if (TOOL_FOCUSED_TOOLS.has(activeTool)) {
    const toolPanel = renderToolPanel(activeTool, imageLayer);
    if (toolPanel) {
      return (
        <ScrollArea className="h-full">
          <div className="p-4">
            {toolPanel}
          </div>
        </ScrollArea>
      );
    }
  }

  if (selectedLayers.length > 1) {
    return (
      <ScrollArea className="h-full">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Layers size={16} className="text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {selectedLayers.length} layers
              </h3>
              <p className="text-xs text-muted-foreground">Multiple selection</p>
            </div>
          </div>
          <AlignmentSection layers={selectedLayers} />
        </div>
      </ScrollArea>
    );
  }

  if (!singleLayer) {
    const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);
    if (artboard) {
      return (
        <ScrollArea className="h-full">
          <div className="p-4">
            <h3 className="text-sm font-semibold text-foreground mb-4">Artboard</h3>
            <ArtboardSection artboard={artboard} />
          </div>
        </ScrollArea>
      );
    }

    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted/50 flex items-center justify-center">
            <Layers size={20} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            Select a layer to view<br />and edit its properties
          </p>
        </div>
      </div>
    );
  }

  const getLayerIcon = () => {
    switch (singleLayer.type) {
      case 'image': return ImageIcon;
      case 'text': return () => <span className="text-sm font-bold">T</span>;
      case 'shape': return () => <span className="text-sm">◆</span>;
      default: return Layers;
    }
  };

  const LayerIcon = getLayerIcon();

  return (
    <ScrollArea className="h-full">
      <div className="pb-8">
        <div className="px-4 py-4 border-b border-border bg-card/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
              <LayerIcon size={18} className="text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {singleLayer.name}
              </h3>
              <p className="text-xs text-muted-foreground capitalize">{singleLayer.type} layer</p>
            </div>
          </div>
        </div>

        <Accordion defaultOpen={['transform', 'appearance', 'quick-filters', 'basic-adjustments']}>
          <AccordionItem id="transform" icon={Sliders} title="Transform & Position">
            <div className="px-4 space-y-4">
              <TransformSection layer={singleLayer} />
              <div className="pt-2">
                <AlignmentSection layers={[singleLayer]} />
              </div>
            </div>
          </AccordionItem>

          <AccordionItem id="appearance" icon={Palette} title="Appearance">
            <div className="px-4">
              <AppearanceSection layer={singleLayer} />
            </div>
          </AccordionItem>

          <AccordionItem id="effects" icon={Sparkles} title="Effects">
            <EffectsSection layer={singleLayer} />
          </AccordionItem>

          {singleLayer.type === 'image' && (
            <Suspense fallback={<SectionLoader />}>
              <AccordionItem id="image-controls" icon={ImageIcon} title="Image Controls">
                <div className="px-4 space-y-4">
                  <ImageControlsSection layer={singleLayer as ImageLayer} />
                  <CropSection layer={singleLayer as ImageLayer} />
                  <BackgroundRemovalSection layer={singleLayer as ImageLayer} />
                </div>
              </AccordionItem>

              <AccordionItem id="quick-filters" icon={Wand2} title="Quick Filters">
                <FilterPresetsSection layer={singleLayer as ImageLayer} />
              </AccordionItem>

              <AccordionItem id="basic-adjustments" icon={Sliders} title="Basic Adjustments">
                <ImageAdjustmentsSection layer={singleLayer as ImageLayer} />
              </AccordionItem>

              <AccordionItem id="tonal" icon={Sliders} title="Tonal Adjustments">
                <div className="space-y-0">
                  <LevelsSection layer={singleLayer} />
                  <CurvesSection layer={singleLayer} />
                  <PosterizeSection layer={singleLayer} />
                  <ThresholdSection layer={singleLayer} />
                </div>
              </AccordionItem>

              <AccordionItem id="color" icon={Palette} title="Color Adjustments">
                <div className="space-y-0">
                  <ColorBalanceSection layer={singleLayer} />
                  <SelectiveColorSection layer={singleLayer} />
                  <PhotoFilterSection layer={singleLayer} />
                  <ChannelMixerSection layer={singleLayer} />
                  <GradientMapSection layer={singleLayer} />
                  <BlackWhiteSection layer={singleLayer} />
                </div>
              </AccordionItem>

              <AccordionItem id="mask" icon={Layers} title="Mask">
                <MaskSection layer={singleLayer} />
              </AccordionItem>
            </Suspense>
          )}

          {singleLayer.type === 'text' && (
            <Suspense fallback={<SectionLoader />}>
              <AccordionItem id="text-settings" title="Text Settings">
                <div className="px-4">
                  <TextSection layer={singleLayer as TextLayer} />
                </div>
              </AccordionItem>
              <AccordionItem id="color-harmony" icon={Palette} title="Color Harmony">
                <div className="px-4">
                  <ColorHarmonySection
                    baseColor={(singleLayer as TextLayer).style.color}
                    onColorSelect={(color) => {
                      useProjectStore.getState().updateLayer<TextLayer>(singleLayer.id, {
                        style: { ...(singleLayer as TextLayer).style, color },
                      });
                    }}
                  />
                </div>
              </AccordionItem>
            </Suspense>
          )}

          {singleLayer.type === 'shape' && (
            <Suspense fallback={<SectionLoader />}>
              <AccordionItem id="shape-settings" title="Shape Settings">
                <div className="px-4">
                  <ShapeSection layer={singleLayer as ShapeLayer} />
                </div>
              </AccordionItem>
              {(singleLayer as ShapeLayer).shapeStyle.fill && (
                <AccordionItem id="color-harmony" icon={Palette} title="Color Harmony">
                  <div className="px-4">
                    <ColorHarmonySection
                      baseColor={(singleLayer as ShapeLayer).shapeStyle.fill!}
                      onColorSelect={(color) => {
                        useProjectStore.getState().updateLayer<ShapeLayer>(singleLayer.id, {
                          shapeStyle: { ...(singleLayer as ShapeLayer).shapeStyle, fill: color },
                        });
                      }}
                    />
                  </div>
                </AccordionItem>
              )}
            </Suspense>
          )}
        </Accordion>
      </div>
    </ScrollArea>
  );
}

export const Inspector = memo(InspectorContent);
