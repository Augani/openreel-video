import { useState } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import type { ShapeLayer, ShapeStyle, Gradient, FillType, StrokeDashType, NoiseFill } from '../../../types/project';
import { DEFAULT_NOISE_FILL } from '../../../types/project';
import { Slider } from '@openreel/ui';
import { GradientPicker } from '../../ui/GradientPicker';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@openreel/ui';
import { ChevronDown, Link, Unlink } from 'lucide-react';

const DASH_PATTERNS: { value: StrokeDashType; label: string; preview: string }[] = [
  { value: 'solid', label: 'Solid', preview: '━━━━━━' },
  { value: 'dashed', label: 'Dashed', preview: '─ ─ ─ ─' },
  { value: 'dotted', label: 'Dotted', preview: '· · · · ·' },
  { value: 'dash-dot', label: 'Dash-Dot', preview: '─ · ─ ·' },
  { value: 'long-dash', label: 'Long Dash', preview: '── ── ──' },
];

interface Props {
  layer: ShapeLayer;
}

export function ShapeSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [isFillOpen, setIsFillOpen] = useState(true);
  const [isStrokeOpen, setIsStrokeOpen] = useState(false);

  const handleStyleChange = (updates: Partial<ShapeStyle>) => {
    updateLayer<ShapeLayer>(layer.id, {
      shapeStyle: { ...layer.shapeStyle, ...updates },
    });
  };

  const handleFillTypeChange = (fillType: FillType) => {
    if (fillType === 'gradient' && !layer.shapeStyle.gradient) {
      handleStyleChange({
        fillType,
        gradient: {
          type: 'linear',
          angle: 90,
          stops: [
            { offset: 0, color: layer.shapeStyle.fill ?? '#3b82f6' },
            { offset: 1, color: '#8b5cf6' },
          ],
        },
      });
    } else if (fillType === 'noise' && !layer.shapeStyle.noise) {
      handleStyleChange({
        fillType,
        noise: {
          ...DEFAULT_NOISE_FILL,
          baseColor: layer.shapeStyle.fill ?? DEFAULT_NOISE_FILL.baseColor,
        },
      });
    } else {
      handleStyleChange({ fillType });
    }
  };

  const handleNoiseChange = (updates: Partial<NoiseFill>) => {
    handleStyleChange({
      noise: { ...(layer.shapeStyle.noise ?? DEFAULT_NOISE_FILL), ...updates },
    });
  };

  const handleGradientChange = (gradient: Gradient) => {
    handleStyleChange({ gradient });
  };

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Shape
      </h4>

      <Collapsible open={isFillOpen} onOpenChange={setIsFillOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
            <span className="text-xs font-medium">Fill</span>
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded border border-input"
                style={{
                  backgroundColor: layer.shapeStyle.fillType === 'solid' ? (layer.shapeStyle.fill ?? 'transparent') : undefined,
                  background: layer.shapeStyle.fillType === 'gradient' && layer.shapeStyle.gradient
                    ? layer.shapeStyle.gradient.type === 'linear'
                      ? `linear-gradient(${layer.shapeStyle.gradient.angle}deg, ${layer.shapeStyle.gradient.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')})`
                      : `radial-gradient(circle, ${layer.shapeStyle.gradient.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')})`
                    : undefined,
                }}
              />
              <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isFillOpen ? 'rotate-180' : ''}`} />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-3 space-y-3 bg-background/50 rounded-b-lg border border-t-0 border-border">
            <div className="grid grid-cols-3 gap-1">
              <button
                onClick={() => handleFillTypeChange('solid')}
                className={`px-2 py-1.5 text-xs rounded-md transition-colors ${
                  layer.shapeStyle.fillType === 'solid'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-accent'
                }`}
              >
                Solid
              </button>
              <button
                onClick={() => handleFillTypeChange('gradient')}
                className={`px-2 py-1.5 text-xs rounded-md transition-colors ${
                  layer.shapeStyle.fillType === 'gradient'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-accent'
                }`}
              >
                Gradient
              </button>
              <button
                onClick={() => handleFillTypeChange('noise')}
                className={`px-2 py-1.5 text-xs rounded-md transition-colors ${
                  layer.shapeStyle.fillType === 'noise'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-accent'
                }`}
              >
                Noise
              </button>
            </div>

            {layer.shapeStyle.fillType === 'solid' && (
              <div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleStyleChange({ fill: layer.shapeStyle.fill ? null : '#3b82f6' })}
                    className={`w-8 h-8 rounded border border-input flex items-center justify-center ${
                      layer.shapeStyle.fill ? '' : 'bg-background'
                    }`}
                    style={{ backgroundColor: layer.shapeStyle.fill ?? undefined }}
                    title={layer.shapeStyle.fill ? 'Remove fill' : 'Add fill'}
                  >
                    {!layer.shapeStyle.fill && (
                      <span className="text-xs text-muted-foreground">∅</span>
                    )}
                  </button>
                  {layer.shapeStyle.fill && (
                    <>
                      <input
                        type="color"
                        value={layer.shapeStyle.fill}
                        onChange={(e) => handleStyleChange({ fill: e.target.value })}
                        className="w-8 h-8 rounded border border-input cursor-pointer"
                      />
                      <input
                        type="text"
                        value={layer.shapeStyle.fill}
                        onChange={(e) => handleStyleChange({ fill: e.target.value })}
                        className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                      />
                    </>
                  )}
                </div>
              </div>
            )}

            {layer.shapeStyle.fillType === 'gradient' && (
              <GradientPicker
                value={layer.shapeStyle.gradient}
                onChange={handleGradientChange}
              />
            )}

            {layer.shapeStyle.fillType === 'noise' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1.5">Base Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={layer.shapeStyle.noise?.baseColor ?? DEFAULT_NOISE_FILL.baseColor}
                      onChange={(e) => handleNoiseChange({ baseColor: e.target.value })}
                      className="w-8 h-8 rounded border border-input cursor-pointer"
                    />
                    <input
                      type="text"
                      value={layer.shapeStyle.noise?.baseColor ?? DEFAULT_NOISE_FILL.baseColor}
                      onChange={(e) => handleNoiseChange({ baseColor: e.target.value })}
                      className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1.5">Noise Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={layer.shapeStyle.noise?.noiseColor ?? DEFAULT_NOISE_FILL.noiseColor}
                      onChange={(e) => handleNoiseChange({ noiseColor: e.target.value })}
                      className="w-8 h-8 rounded border border-input cursor-pointer"
                    />
                    <input
                      type="text"
                      value={layer.shapeStyle.noise?.noiseColor ?? DEFAULT_NOISE_FILL.noiseColor}
                      onChange={(e) => handleNoiseChange({ noiseColor: e.target.value })}
                      className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-muted-foreground">Density</label>
                    <span className="text-[10px] text-muted-foreground">{Math.round((layer.shapeStyle.noise?.density ?? 0.5) * 100)}%</span>
                  </div>
                  <Slider
                    value={[(layer.shapeStyle.noise?.density ?? 0.5) * 100]}
                    onValueChange={([density]) => handleNoiseChange({ density: density / 100 })}
                    min={5}
                    max={100}
                    step={1}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-muted-foreground">Grain Size</label>
                    <span className="text-[10px] text-muted-foreground">{layer.shapeStyle.noise?.size ?? 2}px</span>
                  </div>
                  <Slider
                    value={[layer.shapeStyle.noise?.size ?? 2]}
                    onValueChange={([size]) => handleNoiseChange({ size })}
                    min={1}
                    max={10}
                    step={1}
                  />
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-muted-foreground">Opacity</label>
                <span className="text-[10px] text-muted-foreground">{Math.round(layer.shapeStyle.fillOpacity * 100)}%</span>
              </div>
              <Slider
                value={[layer.shapeStyle.fillOpacity * 100]}
                onValueChange={([opacity]) => handleStyleChange({ fillOpacity: opacity / 100 })}
                min={0}
                max={100}
                step={1}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={isStrokeOpen} onOpenChange={setIsStrokeOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
            <span className="text-xs font-medium">Stroke</span>
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded border-2"
                style={{ borderColor: layer.shapeStyle.stroke ?? '#71717a' }}
              />
              <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isStrokeOpen ? 'rotate-180' : ''}`} />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-3 space-y-3 bg-background/50 rounded-b-lg border border-t-0 border-border">
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleStyleChange({ stroke: layer.shapeStyle.stroke ? null : '#000000' })}
                className={`w-8 h-8 rounded border-2 flex items-center justify-center ${
                  layer.shapeStyle.stroke ? '' : 'border-input bg-background'
                }`}
                style={{ borderColor: layer.shapeStyle.stroke ?? undefined }}
                title={layer.shapeStyle.stroke ? 'Remove stroke' : 'Add stroke'}
              >
                {!layer.shapeStyle.stroke && (
                  <span className="text-xs text-muted-foreground">∅</span>
                )}
              </button>
              {layer.shapeStyle.stroke && (
                <>
                  <input
                    type="color"
                    value={layer.shapeStyle.stroke}
                    onChange={(e) => handleStyleChange({ stroke: e.target.value })}
                    className="w-8 h-8 rounded border border-input cursor-pointer"
                  />
                  <input
                    type="text"
                    value={layer.shapeStyle.stroke}
                    onChange={(e) => handleStyleChange({ stroke: e.target.value })}
                    className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                </>
              )}
            </div>

            {layer.shapeStyle.stroke && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-muted-foreground">Width</label>
                    <span className="text-[10px] text-muted-foreground">{layer.shapeStyle.strokeWidth}px</span>
                  </div>
                  <Slider
                    value={[layer.shapeStyle.strokeWidth]}
                    onValueChange={([width]) => handleStyleChange({ strokeWidth: width })}
                    min={1}
                    max={20}
                    step={1}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-muted-foreground">Opacity</label>
                    <span className="text-[10px] text-muted-foreground">{Math.round(layer.shapeStyle.strokeOpacity * 100)}%</span>
                  </div>
                  <Slider
                    value={[layer.shapeStyle.strokeOpacity * 100]}
                    onValueChange={([opacity]) => handleStyleChange({ strokeOpacity: opacity / 100 })}
                    min={0}
                    max={100}
                    step={1}
                  />
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground mb-1.5 block">Dash Pattern</label>
                  <div className="grid grid-cols-1 gap-1">
                    {DASH_PATTERNS.map((pattern) => (
                      <button
                        key={pattern.value}
                        onClick={() => handleStyleChange({ strokeDash: pattern.value })}
                        className={`flex items-center justify-between px-2 py-1.5 text-xs rounded-md transition-colors ${
                          (layer.shapeStyle.strokeDash ?? 'solid') === pattern.value
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-secondary-foreground hover:bg-accent'
                        }`}
                      >
                        <span>{pattern.label}</span>
                        <span className="font-mono text-[10px] opacity-70">{pattern.preview}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {layer.shapeType === 'rectangle' && (
        <div className="p-3 space-y-3 bg-secondary/50 rounded-lg">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium">Corner Radius</label>
            <button
              onClick={() => {
                const currentRadius = layer.shapeStyle.cornerRadius ?? 0;
                const defaultCorners = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
                handleStyleChange({
                  individualCorners: !layer.shapeStyle.individualCorners,
                  corners: layer.shapeStyle.individualCorners
                    ? (layer.shapeStyle.corners ?? defaultCorners)
                    : {
                        topLeft: currentRadius,
                        topRight: currentRadius,
                        bottomRight: currentRadius,
                        bottomLeft: currentRadius,
                      },
                });
              }}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md transition-colors ${
                layer.shapeStyle.individualCorners
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent'
              }`}
              title={layer.shapeStyle.individualCorners ? 'Link corners' : 'Unlink corners'}
            >
              {layer.shapeStyle.individualCorners ? <Unlink size={12} /> : <Link size={12} />}
              {layer.shapeStyle.individualCorners ? 'Individual' : 'Uniform'}
            </button>
          </div>

          {!layer.shapeStyle.individualCorners ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-muted-foreground">All Corners</label>
                <span className="text-[10px] text-muted-foreground">{layer.shapeStyle.cornerRadius}px</span>
              </div>
              <Slider
                value={[layer.shapeStyle.cornerRadius]}
                onValueChange={([radius]) => handleStyleChange({ cornerRadius: radius })}
                min={0}
                max={100}
                step={1}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-muted-foreground">Top Left</label>
                  <span className="text-[10px] text-muted-foreground">{layer.shapeStyle.corners?.topLeft ?? 0}px</span>
                </div>
                <Slider
                  value={[layer.shapeStyle.corners?.topLeft ?? 0]}
                  onValueChange={([radius]) =>
                    handleStyleChange({
                      corners: { ...(layer.shapeStyle.corners ?? { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }), topLeft: radius },
                    })
                  }
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-muted-foreground">Top Right</label>
                  <span className="text-[10px] text-muted-foreground">{layer.shapeStyle.corners?.topRight ?? 0}px</span>
                </div>
                <Slider
                  value={[layer.shapeStyle.corners?.topRight ?? 0]}
                  onValueChange={([radius]) =>
                    handleStyleChange({
                      corners: { ...(layer.shapeStyle.corners ?? { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }), topRight: radius },
                    })
                  }
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-muted-foreground">Bottom Left</label>
                  <span className="text-[10px] text-muted-foreground">{layer.shapeStyle.corners?.bottomLeft ?? 0}px</span>
                </div>
                <Slider
                  value={[layer.shapeStyle.corners?.bottomLeft ?? 0]}
                  onValueChange={([radius]) =>
                    handleStyleChange({
                      corners: { ...(layer.shapeStyle.corners ?? { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }), bottomLeft: radius },
                    })
                  }
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-muted-foreground">Bottom Right</label>
                  <span className="text-[10px] text-muted-foreground">{layer.shapeStyle.corners?.bottomRight ?? 0}px</span>
                </div>
                <Slider
                  value={[layer.shapeStyle.corners?.bottomRight ?? 0]}
                  onValueChange={([radius]) =>
                    handleStyleChange({
                      corners: { ...(layer.shapeStyle.corners ?? { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }), bottomRight: radius },
                    })
                  }
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {layer.shapeType === 'polygon' && (
        <div className="p-3 space-y-2 bg-secondary/50 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-muted-foreground">Sides</label>
            <span className="text-[10px] text-muted-foreground">{layer.sides ?? 6}</span>
          </div>
          <Slider
            value={[layer.sides ?? 6]}
            onValueChange={([sides]) => updateLayer<ShapeLayer>(layer.id, { sides })}
            min={3}
            max={12}
            step={1}
          />
        </div>
      )}

      {layer.shapeType === 'star' && (
        <div className="p-3 space-y-3 bg-secondary/50 rounded-lg">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-muted-foreground">Points</label>
              <span className="text-[10px] text-muted-foreground">{layer.sides ?? 5}</span>
            </div>
            <Slider
              value={[layer.sides ?? 5]}
              onValueChange={([sides]) => updateLayer<ShapeLayer>(layer.id, { sides })}
              min={3}
              max={20}
              step={1}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-muted-foreground">Inner Radius</label>
              <span className="text-[10px] text-muted-foreground">{Math.round((layer.innerRadius ?? 0.4) * 100)}%</span>
            </div>
            <Slider
              value={[Math.round((layer.innerRadius ?? 0.4) * 100)]}
              onValueChange={([ratio]) => updateLayer<ShapeLayer>(layer.id, { innerRadius: ratio / 100 })}
              min={10}
              max={90}
              step={1}
            />
          </div>
        </div>
      )}
    </div>
  );
}
