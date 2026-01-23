import { useProjectStore } from '../../../stores/project-store';
import type { Layer, Shadow, InnerShadow, Stroke, Glow } from '../../../types/project';
import { Slider } from '@openreel/ui';
import { ChevronDown, Droplets, Pencil, Sparkles, CircleDot } from 'lucide-react';
import { useState } from 'react';

interface Props {
  layer: Layer;
}

type EffectSection = 'shadow' | 'innerShadow' | 'stroke' | 'glow' | null;

interface EffectHeaderProps {
  icon: React.ElementType;
  label: string;
  enabled: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onEnabledChange: (enabled: boolean) => void;
}

function EffectHeader({ icon: Icon, label, enabled, isOpen, onToggle, onEnabledChange }: EffectHeaderProps) {
  return (
    <div className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 flex-1 text-left"
      >
        <Icon size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium">{label}</span>
      </button>
      <div className="flex items-center gap-2">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-8 h-4 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4" />
        </label>
        <button onClick={onToggle} className="p-0.5">
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}

export function EffectsSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [openSection, setOpenSection] = useState<EffectSection>('shadow');

  const handleShadowChange = (updates: Partial<Shadow>) => {
    updateLayer(layer.id, {
      shadow: { ...layer.shadow, ...updates },
    });
  };

  const handleInnerShadowChange = (updates: Partial<InnerShadow>) => {
    updateLayer(layer.id, {
      innerShadow: { ...(layer.innerShadow ?? { enabled: false, color: 'rgba(0, 0, 0, 0.5)', blur: 10, offsetX: 2, offsetY: 2 }), ...updates },
    });
  };

  const handleStrokeChange = (updates: Partial<Stroke>) => {
    updateLayer(layer.id, {
      stroke: { ...layer.stroke, ...updates },
    });
  };

  const handleGlowChange = (updates: Partial<Glow>) => {
    updateLayer(layer.id, {
      glow: { ...layer.glow, ...updates },
    });
  };

  const toggleSection = (section: EffectSection) => {
    setOpenSection(openSection === section ? null : section);
  };

  return (
    <div className="px-4 space-y-2">

      <div>
        <EffectHeader
          icon={Droplets}
          label="Drop Shadow"
          enabled={layer.shadow.enabled}
          isOpen={openSection === 'shadow'}
          onToggle={() => toggleSection('shadow')}
          onEnabledChange={(enabled) => handleShadowChange({ enabled })}
        />
        {openSection === 'shadow' && (
          <div className="p-3 space-y-3 bg-background/50 rounded-b-lg border border-t-0 border-border">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1.5">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={layer.shadow.color.startsWith('rgba') ? '#000000' : layer.shadow.color}
                  onChange={(e) => handleShadowChange({ color: e.target.value })}
                  className="w-8 h-8 rounded border border-input cursor-pointer"
                  disabled={!layer.shadow.enabled}
                />
                <input
                  type="text"
                  value={layer.shadow.color}
                  onChange={(e) => handleShadowChange({ color: e.target.value })}
                  className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono disabled:opacity-50"
                  disabled={!layer.shadow.enabled}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-muted-foreground">Blur</label>
                <span className="text-[10px] text-muted-foreground">{layer.shadow.blur}px</span>
              </div>
              <Slider
                value={[layer.shadow.blur]}
                onValueChange={([blur]) => handleShadowChange({ blur })}
                min={0}
                max={100}
                step={1}
                disabled={!layer.shadow.enabled}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] text-muted-foreground">Offset X</label>
                  <span className="text-[10px] text-muted-foreground">{layer.shadow.offsetX}px</span>
                </div>
                <Slider
                  value={[layer.shadow.offsetX]}
                  onValueChange={([offsetX]) => handleShadowChange({ offsetX })}
                  min={-50}
                  max={50}
                  step={1}
                  disabled={!layer.shadow.enabled}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] text-muted-foreground">Offset Y</label>
                  <span className="text-[10px] text-muted-foreground">{layer.shadow.offsetY}px</span>
                </div>
                <Slider
                  value={[layer.shadow.offsetY]}
                  onValueChange={([offsetY]) => handleShadowChange({ offsetY })}
                  min={-50}
                  max={50}
                  step={1}
                  disabled={!layer.shadow.enabled}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <EffectHeader
          icon={CircleDot}
          label="Inner Shadow"
          enabled={layer.innerShadow?.enabled ?? false}
          isOpen={openSection === 'innerShadow'}
          onToggle={() => toggleSection('innerShadow')}
          onEnabledChange={(enabled) => handleInnerShadowChange({ enabled })}
        />
        {openSection === 'innerShadow' && (
          <div className="p-3 space-y-3 bg-background/50 rounded-b-lg border border-t-0 border-border">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1.5">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={(layer.innerShadow?.color ?? 'rgba(0, 0, 0, 0.5)').startsWith('rgba') ? '#000000' : layer.innerShadow?.color ?? '#000000'}
                  onChange={(e) => handleInnerShadowChange({ color: e.target.value })}
                  className="w-8 h-8 rounded border border-input cursor-pointer"
                  disabled={!layer.innerShadow?.enabled}
                />
                <input
                  type="text"
                  value={layer.innerShadow?.color ?? 'rgba(0, 0, 0, 0.5)'}
                  onChange={(e) => handleInnerShadowChange({ color: e.target.value })}
                  className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono disabled:opacity-50"
                  disabled={!layer.innerShadow?.enabled}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-muted-foreground">Blur</label>
                <span className="text-[10px] text-muted-foreground">{layer.innerShadow?.blur ?? 10}px</span>
              </div>
              <Slider
                value={[layer.innerShadow?.blur ?? 10]}
                onValueChange={([blur]) => handleInnerShadowChange({ blur })}
                min={0}
                max={50}
                step={1}
                disabled={!layer.innerShadow?.enabled}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] text-muted-foreground">Offset X</label>
                  <span className="text-[10px] text-muted-foreground">{layer.innerShadow?.offsetX ?? 2}px</span>
                </div>
                <Slider
                  value={[layer.innerShadow?.offsetX ?? 2]}
                  onValueChange={([offsetX]) => handleInnerShadowChange({ offsetX })}
                  min={-30}
                  max={30}
                  step={1}
                  disabled={!layer.innerShadow?.enabled}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] text-muted-foreground">Offset Y</label>
                  <span className="text-[10px] text-muted-foreground">{layer.innerShadow?.offsetY ?? 2}px</span>
                </div>
                <Slider
                  value={[layer.innerShadow?.offsetY ?? 2]}
                  onValueChange={([offsetY]) => handleInnerShadowChange({ offsetY })}
                  min={-30}
                  max={30}
                  step={1}
                  disabled={!layer.innerShadow?.enabled}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <EffectHeader
          icon={Pencil}
          label="Stroke"
          enabled={layer.stroke.enabled}
          isOpen={openSection === 'stroke'}
          onToggle={() => toggleSection('stroke')}
          onEnabledChange={(enabled) => handleStrokeChange({ enabled })}
        />
        {openSection === 'stroke' && (
          <div className="p-3 space-y-3 bg-background/50 rounded-b-lg border border-t-0 border-border">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1.5">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={layer.stroke.color}
                  onChange={(e) => handleStrokeChange({ color: e.target.value })}
                  className="w-8 h-8 rounded border border-input cursor-pointer"
                  disabled={!layer.stroke.enabled}
                />
                <input
                  type="text"
                  value={layer.stroke.color}
                  onChange={(e) => handleStrokeChange({ color: e.target.value })}
                  className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono disabled:opacity-50"
                  disabled={!layer.stroke.enabled}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-muted-foreground">Width</label>
                <span className="text-[10px] text-muted-foreground">{layer.stroke.width}px</span>
              </div>
              <Slider
                value={[layer.stroke.width]}
                onValueChange={([width]) => handleStrokeChange({ width })}
                min={1}
                max={20}
                step={1}
                disabled={!layer.stroke.enabled}
              />
            </div>

            <div>
              <label className="block text-[10px] text-muted-foreground mb-1.5">Style</label>
              <div className="grid grid-cols-3 gap-1">
                {(['solid', 'dashed', 'dotted'] as const).map((style) => (
                  <button
                    key={style}
                    onClick={() => handleStrokeChange({ style })}
                    disabled={!layer.stroke.enabled}
                    className={`px-2 py-1.5 text-[10px] rounded capitalize transition-colors ${
                      layer.stroke.style === style
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-accent disabled:opacity-50'
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <EffectHeader
          icon={Sparkles}
          label="Outer Glow"
          enabled={layer.glow.enabled}
          isOpen={openSection === 'glow'}
          onToggle={() => toggleSection('glow')}
          onEnabledChange={(enabled) => handleGlowChange({ enabled })}
        />
        {openSection === 'glow' && (
          <div className="p-3 space-y-3 bg-background/50 rounded-b-lg border border-t-0 border-border">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1.5">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={layer.glow.color}
                  onChange={(e) => handleGlowChange({ color: e.target.value })}
                  className="w-8 h-8 rounded border border-input cursor-pointer"
                  disabled={!layer.glow.enabled}
                />
                <input
                  type="text"
                  value={layer.glow.color}
                  onChange={(e) => handleGlowChange({ color: e.target.value })}
                  className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono disabled:opacity-50"
                  disabled={!layer.glow.enabled}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-muted-foreground">Blur</label>
                <span className="text-[10px] text-muted-foreground">{layer.glow.blur}px</span>
              </div>
              <Slider
                value={[layer.glow.blur]}
                onValueChange={([blur]) => handleGlowChange({ blur })}
                min={0}
                max={100}
                step={1}
                disabled={!layer.glow.enabled}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-muted-foreground">Intensity</label>
                <span className="text-[10px] text-muted-foreground">{Math.round(layer.glow.intensity * 100)}%</span>
              </div>
              <Slider
                value={[layer.glow.intensity]}
                onValueChange={([intensity]) => handleGlowChange({ intensity })}
                min={0}
                max={2}
                step={0.1}
                disabled={!layer.glow.enabled}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
