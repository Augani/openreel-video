import { useProjectStore } from '../../../stores/project-store';
import type { TextLayer, TextStyle, TextFillType, Gradient } from '../../../types/project';
import { AlignLeft, AlignCenter, AlignRight, Bold, Italic, Underline, CaseUpper, CaseLower, CaseSensitive, Strikethrough, Type } from 'lucide-react';
import { FontPicker } from '../../ui/FontPicker';
import { GradientPicker } from '../../ui/GradientPicker';
import { Slider, Switch } from '@openreel/ui';

interface Props {
  layer: TextLayer;
}

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 128];

interface TextPreset {
  id: string;
  name: string;
  style: Partial<TextStyle>;
}

const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'heading-1',
    name: 'Heading 1',
    style: { fontSize: 72, fontWeight: 700, lineHeight: 1.1 },
  },
  {
    id: 'heading-2',
    name: 'Heading 2',
    style: { fontSize: 48, fontWeight: 700, lineHeight: 1.2 },
  },
  {
    id: 'heading-3',
    name: 'Heading 3',
    style: { fontSize: 36, fontWeight: 600, lineHeight: 1.2 },
  },
  {
    id: 'subheading',
    name: 'Subheading',
    style: { fontSize: 24, fontWeight: 500, lineHeight: 1.3 },
  },
  {
    id: 'body',
    name: 'Body',
    style: { fontSize: 16, fontWeight: 400, lineHeight: 1.5 },
  },
  {
    id: 'body-large',
    name: 'Body Large',
    style: { fontSize: 18, fontWeight: 400, lineHeight: 1.6 },
  },
  {
    id: 'caption',
    name: 'Caption',
    style: { fontSize: 12, fontWeight: 400, lineHeight: 1.4, color: '#a3a3a3' },
  },
  {
    id: 'quote',
    name: 'Quote',
    style: { fontSize: 24, fontWeight: 400, fontStyle: 'italic' as const, lineHeight: 1.5 },
  },
];

export function TextSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();

  const handleContentChange = (content: string) => {
    updateLayer<TextLayer>(layer.id, { content });
  };

  const handleStyleChange = (updates: Partial<TextStyle>) => {
    updateLayer<TextLayer>(layer.id, {
      style: { ...layer.style, ...updates },
    });
  };

  const toggleBold = () => {
    handleStyleChange({
      fontWeight: layer.style.fontWeight >= 700 ? 400 : 700,
    });
  };

  const toggleItalic = () => {
    handleStyleChange({
      fontStyle: layer.style.fontStyle === 'italic' ? 'normal' : 'italic',
    });
  };

  const toggleUnderline = () => {
    handleStyleChange({
      textDecoration: layer.style.textDecoration === 'underline' ? 'none' : 'underline',
    });
  };

  const toggleStrikethrough = () => {
    handleStyleChange({
      textDecoration: layer.style.textDecoration === 'line-through' ? 'none' : 'line-through',
    });
  };

  const transformToUppercase = () => {
    handleContentChange(layer.content.toUpperCase());
  };

  const transformToLowercase = () => {
    handleContentChange(layer.content.toLowerCase());
  };

  const transformToCapitalize = () => {
    const capitalized = layer.content
      .toLowerCase()
      .replace(/(?:^|\s)\S/g, (char) => char.toUpperCase());
    handleContentChange(capitalized);
  };

  const applyPreset = (preset: TextPreset) => {
    handleStyleChange(preset.style);
  };

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Text
      </h4>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <Type size={14} className="text-muted-foreground" />
          <label className="text-[10px] text-muted-foreground">Text Presets</label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TEXT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset)}
              className="px-2.5 py-1.5 text-[10px] rounded-md bg-secondary text-secondary-foreground hover:bg-accent transition-colors"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[10px] text-muted-foreground mb-1">Content</label>
        <textarea
          value={layer.content}
          onChange={(e) => handleContentChange(e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary min-h-[60px] resize-none"
          rows={3}
        />
      </div>

      <div>
        <label className="block text-[10px] text-muted-foreground mb-1">Font</label>
        <FontPicker
          value={layer.style.fontFamily}
          onChange={(fontFamily) => handleStyleChange({ fontFamily })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Size</label>
          <select
            value={layer.style.fontSize}
            onChange={(e) => handleStyleChange({ fontSize: Number(e.target.value) })}
            className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Weight</label>
          <select
            value={layer.style.fontWeight}
            onChange={(e) => handleStyleChange({ fontWeight: Number(e.target.value) })}
            className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value={300}>Light</option>
            <option value={400}>Regular</option>
            <option value={500}>Medium</option>
            <option value={600}>Semibold</option>
            <option value={700}>Bold</option>
          </select>
        </div>
      </div>

      <div className="flex gap-1">
        <button
          onClick={toggleBold}
          className={`p-2 rounded-md transition-colors ${
            layer.style.fontWeight >= 700
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
          title="Bold"
        >
          <Bold size={14} />
        </button>
        <button
          onClick={toggleItalic}
          className={`p-2 rounded-md transition-colors ${
            layer.style.fontStyle === 'italic'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
          title="Italic"
        >
          <Italic size={14} />
        </button>
        <button
          onClick={toggleUnderline}
          className={`p-2 rounded-md transition-colors ${
            layer.style.textDecoration === 'underline'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
          title="Underline"
        >
          <Underline size={14} />
        </button>
        <button
          onClick={toggleStrikethrough}
          className={`p-2 rounded-md transition-colors ${
            layer.style.textDecoration === 'line-through'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
          title="Strikethrough"
        >
          <Strikethrough size={14} />
        </button>

        <div className="w-px bg-border mx-1" />

        <button
          onClick={() => handleStyleChange({ textAlign: 'left' })}
          className={`p-2 rounded-md transition-colors ${
            layer.style.textAlign === 'left'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
          title="Align Left"
        >
          <AlignLeft size={14} />
        </button>
        <button
          onClick={() => handleStyleChange({ textAlign: 'center' })}
          className={`p-2 rounded-md transition-colors ${
            layer.style.textAlign === 'center'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
          title="Align Center"
        >
          <AlignCenter size={14} />
        </button>
        <button
          onClick={() => handleStyleChange({ textAlign: 'right' })}
          className={`p-2 rounded-md transition-colors ${
            layer.style.textAlign === 'right'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
          title="Align Right"
        >
          <AlignRight size={14} />
        </button>

        <div className="w-px bg-border mx-1" />

        <button
          onClick={transformToUppercase}
          className="p-2 rounded-md transition-colors bg-secondary text-secondary-foreground hover:bg-accent"
          title="UPPERCASE"
        >
          <CaseUpper size={14} />
        </button>
        <button
          onClick={transformToLowercase}
          className="p-2 rounded-md transition-colors bg-secondary text-secondary-foreground hover:bg-accent"
          title="lowercase"
        >
          <CaseLower size={14} />
        </button>
        <button
          onClick={transformToCapitalize}
          className="p-2 rounded-md transition-colors bg-secondary text-secondary-foreground hover:bg-accent"
          title="Capitalize"
        >
          <CaseSensitive size={14} />
        </button>
      </div>

      <div className="space-y-3 p-3 bg-secondary/50 rounded-lg">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Fill</label>
          <div className="flex gap-1">
            <button
              onClick={() => handleStyleChange({ fillType: 'solid' as TextFillType })}
              className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
                (layer.style.fillType ?? 'solid') === 'solid'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent'
              }`}
            >
              Solid
            </button>
            <button
              onClick={() => {
                const gradient: Gradient = layer.style.gradient ?? {
                  type: 'linear',
                  angle: 90,
                  stops: [
                    { offset: 0, color: layer.style.color },
                    { offset: 1, color: '#8b5cf6' },
                  ],
                };
                handleStyleChange({ fillType: 'gradient' as TextFillType, gradient });
              }}
              className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
                layer.style.fillType === 'gradient'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent'
              }`}
            >
              Gradient
            </button>
          </div>
        </div>

        {(layer.style.fillType ?? 'solid') === 'solid' ? (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={layer.style.color}
              onChange={(e) => handleStyleChange({ color: e.target.value })}
              className="w-8 h-8 rounded border border-input cursor-pointer"
            />
            <input
              type="text"
              value={layer.style.color}
              onChange={(e) => handleStyleChange({ color: e.target.value })}
              className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
          </div>
        ) : (
          <GradientPicker
            value={layer.style.gradient}
            onChange={(gradient) => handleStyleChange({ gradient })}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Line Height</label>
          <input
            type="number"
            value={layer.style.lineHeight}
            onChange={(e) => handleStyleChange({ lineHeight: Number(e.target.value) })}
            className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            step={0.1}
            min={0.5}
            max={3}
          />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Letter Spacing</label>
          <input
            type="number"
            value={layer.style.letterSpacing}
            onChange={(e) => handleStyleChange({ letterSpacing: Number(e.target.value) })}
            className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            step={0.1}
          />
        </div>
      </div>

      <div className="space-y-2 p-3 bg-secondary/50 rounded-lg">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Text Stroke</label>
          <button
            onClick={() => handleStyleChange({ strokeColor: layer.style.strokeColor ? null : '#000000', strokeWidth: layer.style.strokeColor ? 0 : 2 })}
            className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
              layer.style.strokeColor
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent'
            }`}
          >
            {layer.style.strokeColor ? 'On' : 'Off'}
          </button>
        </div>
        {layer.style.strokeColor && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={layer.style.strokeColor}
                onChange={(e) => handleStyleChange({ strokeColor: e.target.value })}
                className="w-8 h-8 rounded border border-input cursor-pointer"
              />
              <input
                type="text"
                value={layer.style.strokeColor}
                onChange={(e) => handleStyleChange({ strokeColor: e.target.value })}
                className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-muted-foreground">Width</label>
                <span className="text-[10px] text-muted-foreground">{layer.style.strokeWidth ?? 0}px</span>
              </div>
              <Slider
                value={[layer.style.strokeWidth ?? 0]}
                onValueChange={([width]) => handleStyleChange({ strokeWidth: width })}
                min={0}
                max={10}
                step={0.5}
              />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 p-3 bg-secondary/50 rounded-lg">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Background</label>
          <button
            onClick={() => handleStyleChange({ backgroundColor: layer.style.backgroundColor ? null : '#000000' })}
            className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
              layer.style.backgroundColor
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent'
            }`}
          >
            {layer.style.backgroundColor ? 'On' : 'Off'}
          </button>
        </div>
        {layer.style.backgroundColor && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={layer.style.backgroundColor}
                onChange={(e) => handleStyleChange({ backgroundColor: e.target.value })}
                className="w-8 h-8 rounded border border-input cursor-pointer"
              />
              <input
                type="text"
                value={layer.style.backgroundColor}
                onChange={(e) => handleStyleChange({ backgroundColor: e.target.value })}
                className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-muted-foreground">Padding</label>
                  <span className="text-[10px] text-muted-foreground">{layer.style.backgroundPadding ?? 8}px</span>
                </div>
                <Slider
                  value={[layer.style.backgroundPadding ?? 8]}
                  onValueChange={([padding]) => handleStyleChange({ backgroundPadding: padding })}
                  min={0}
                  max={32}
                  step={1}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-muted-foreground">Radius</label>
                  <span className="text-[10px] text-muted-foreground">{layer.style.backgroundRadius ?? 4}px</span>
                </div>
                <Slider
                  value={[layer.style.backgroundRadius ?? 4]}
                  onValueChange={([radius]) => handleStyleChange({ backgroundRadius: radius })}
                  min={0}
                  max={32}
                  step={1}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 p-3 bg-secondary/50 rounded-lg">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Text Shadow</label>
          <Switch
            checked={layer.style.textShadow?.enabled ?? false}
            onCheckedChange={(enabled) =>
              handleStyleChange({
                textShadow: {
                  ...(layer.style.textShadow ?? { enabled: false, color: 'rgba(0, 0, 0, 0.5)', blur: 4, offsetX: 0, offsetY: 2 }),
                  enabled,
                },
              })
            }
          />
        </div>
        {layer.style.textShadow?.enabled && (
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1.5">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={(layer.style.textShadow?.color ?? 'rgba(0, 0, 0, 0.5)').startsWith('rgba') ? '#000000' : layer.style.textShadow?.color ?? '#000000'}
                  onChange={(e) =>
                    handleStyleChange({
                      textShadow: { ...(layer.style.textShadow ?? { enabled: true, color: 'rgba(0, 0, 0, 0.5)', blur: 4, offsetX: 0, offsetY: 2 }), color: e.target.value },
                    })
                  }
                  className="w-8 h-8 rounded border border-input cursor-pointer"
                />
                <input
                  type="text"
                  value={layer.style.textShadow?.color ?? 'rgba(0, 0, 0, 0.5)'}
                  onChange={(e) =>
                    handleStyleChange({
                      textShadow: { ...(layer.style.textShadow ?? { enabled: true, color: 'rgba(0, 0, 0, 0.5)', blur: 4, offsetX: 0, offsetY: 2 }), color: e.target.value },
                    })
                  }
                  className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-muted-foreground">Blur</label>
                <span className="text-[10px] text-muted-foreground">{layer.style.textShadow?.blur ?? 4}px</span>
              </div>
              <Slider
                value={[layer.style.textShadow?.blur ?? 4]}
                onValueChange={([blur]) =>
                  handleStyleChange({
                    textShadow: { ...(layer.style.textShadow ?? { enabled: true, color: 'rgba(0, 0, 0, 0.5)', blur: 4, offsetX: 0, offsetY: 2 }), blur },
                  })
                }
                min={0}
                max={50}
                step={1}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] text-muted-foreground">Offset X</label>
                  <span className="text-[10px] text-muted-foreground">{layer.style.textShadow?.offsetX ?? 0}px</span>
                </div>
                <Slider
                  value={[layer.style.textShadow?.offsetX ?? 0]}
                  onValueChange={([offsetX]) =>
                    handleStyleChange({
                      textShadow: { ...(layer.style.textShadow ?? { enabled: true, color: 'rgba(0, 0, 0, 0.5)', blur: 4, offsetX: 0, offsetY: 2 }), offsetX },
                    })
                  }
                  min={-30}
                  max={30}
                  step={1}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] text-muted-foreground">Offset Y</label>
                  <span className="text-[10px] text-muted-foreground">{layer.style.textShadow?.offsetY ?? 2}px</span>
                </div>
                <Slider
                  value={[layer.style.textShadow?.offsetY ?? 2]}
                  onValueChange={([offsetY]) =>
                    handleStyleChange({
                      textShadow: { ...(layer.style.textShadow ?? { enabled: true, color: 'rgba(0, 0, 0, 0.5)', blur: 4, offsetX: 0, offsetY: 2 }), offsetY },
                    })
                  }
                  min={-30}
                  max={30}
                  step={1}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
