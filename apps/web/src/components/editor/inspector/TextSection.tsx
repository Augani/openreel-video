import React, { useCallback, useMemo } from "react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  Crosshair,
  Bold,
  Italic,
  Underline,
  Type,
} from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import type { TextStyle, FontWeight } from "@openreel/core";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@openreel/ui";

const ColorPicker: React.FC<{
  label: string;
  value: string;
  onChange: (color: string) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between">
    <span className="text-[10px] text-text-secondary">{label}</span>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-6 h-6 rounded border border-border cursor-pointer"
      />
      <span className="text-[10px] font-mono text-text-muted uppercase">
        {value}
      </span>
    </div>
  </div>
);

const NumberInput: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}> = ({ label, value, onChange, min = 0, max = 1000, step = 1, unit = "" }) => (
  <div className="flex items-center justify-between">
    <span className="text-[10px] text-text-secondary">{label}</span>
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        className="w-16 px-2 py-1 text-[10px] font-mono text-text-primary bg-background-tertiary border border-border rounded text-right outline-none focus:border-primary"
      />
      {unit && <span className="text-[10px] text-text-muted">{unit}</span>}
    </div>
  </div>
);

const ToggleButtonGroup: React.FC<{
  options: { value: string; icon: React.ReactNode; label: string }[];
  value: string;
  onChange: (value: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="flex gap-1">
    {options.map((option) => (
      <button
        key={option.value}
        onClick={() => onChange(option.value)}
        className={`p-1.5 rounded transition-colors ${
          value === option.value
            ? "bg-primary text-white"
            : "bg-background-tertiary border border-border text-text-secondary hover:text-text-primary"
        }`}
        title={option.label}
      >
        {option.icon}
      </button>
    ))}
  </div>
);

const FONT_CATEGORIES = {
  Popular: [
    "Inter",
    "Poppins",
    "Montserrat",
    "Roboto",
    "Open Sans",
    "Lato",
    "Outfit",
    "DM Sans",
  ],
  "Display & Headlines": [
    "Bebas Neue",
    "Anton",
    "Oswald",
    "Teko",
    "Staatliches",
    "Alfa Slab One",
    "Archivo Black",
    "Black Ops One",
    "Titan One",
    "Righteous",
    "Concert One",
    "Fredoka One",
    "Bungee",
  ],
  "Elegant & Serif": [
    "Playfair Display",
    "Cinzel",
    "Lora",
    "Merriweather",
    "DM Serif Display",
    "Abril Fatface",
    "Roboto Slab",
    "Zilla Slab",
  ],
  "Modern & Clean": [
    "Lexend",
    "Quicksand",
    "Nunito",
    "Rubik",
    "Work Sans",
    "Raleway",
    "Ubuntu",
    "Space Grotesk",
    "Comfortaa",
  ],
  "Handwritten & Script": [
    "Pacifico",
    "Lobster",
    "Dancing Script",
    "Great Vibes",
    "Caveat",
    "Sacramento",
    "Satisfy",
    "Yellowtail",
    "Rock Salt",
    "Permanent Marker",
  ],
  "Fun & Creative": ["Bangers", "Creepster", "Press Start 2P"],
  Monospace: ["Roboto Mono", "Space Mono"],
  System: ["Arial", "Helvetica", "Times New Roman", "Georgia", "Verdana"],
};

const FontSelector: React.FC<{
  value: string;
  onChange: (font: string) => void;
}> = ({ value, onChange }) => {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-text-secondary">Font</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="max-w-[140px] bg-background-tertiary border-border text-text-primary text-[10px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-background-secondary border-border max-h-80">
          {Object.entries(FONT_CATEGORIES).map(([category, fonts]) => (
            <SelectGroup key={category}>
              <SelectLabel className="text-text-muted text-[10px] font-medium">
                {category}
              </SelectLabel>
              {fonts.map((font) => (
                <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

interface TextSectionProps {
  clipId: string;
}

/**
 * TextSection Component
 *
 * - 15.1: Display text content editor and styling controls
 */
export const TextSection: React.FC<TextSectionProps> = ({ clipId }) => {
  const {
    getTextClip,
    updateTextContent,
    updateTextStyle,
    updateTextTransform,
    project,
  } = useProjectStore();

  const textClip = useMemo(
    () => getTextClip(clipId),
    [clipId, getTextClip, project.modifiedAt],
  );

  const defaultStyle: TextStyle = {
    fontFamily: "Inter",
    fontSize: 48,
    fontWeight: "normal" as FontWeight,
    fontStyle: "normal",
    color: "#ffffff",
    backgroundColor: "transparent",
    textAlign: "center",
    verticalAlign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
    textDecoration: "none",
    strokeColor: "#000000",
    strokeWidth: 0,
    shadowColor: "#000000",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
  };

  const style = textClip?.style || defaultStyle;
  const text = textClip?.text || "";

  const handleTextChange = useCallback(
    (newText: string) => {
      updateTextContent(clipId, newText);
    },
    [clipId, updateTextContent],
  );

  const handleStyleChange = useCallback(
    async (changes: Partial<TextStyle>) => {
      if (changes.fontFamily) {
        try {
          const fontSize = style.fontSize || 48;
          await document.fonts.load(`${fontSize}px "${changes.fontFamily}"`);
        } catch {
          // Font load failed, continue anyway - browser will fallback
        }
      }
      updateTextStyle(clipId, changes);
    },
    [clipId, updateTextStyle, style.fontSize],
  );

  const handleCenterHorizontal = useCallback(() => {
    const currentY = textClip?.transform?.position?.y ?? 0.5;
    updateTextTransform(clipId, { position: { x: 0.5, y: currentY } });
  }, [clipId, textClip, updateTextTransform]);

  const handleCenterVertical = useCallback(() => {
    const currentX = textClip?.transform?.position?.x ?? 0.5;
    updateTextTransform(clipId, { position: { x: currentX, y: 0.5 } });
  }, [clipId, textClip, updateTextTransform]);

  const handleCenterBoth = useCallback(() => {
    updateTextTransform(clipId, { position: { x: 0.5, y: 0.5 } });
  }, [clipId, updateTextTransform]);

  if (!textClip) {
    return (
      <div className="p-4 text-center">
        <Type size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-[10px] text-text-muted">No text clip selected</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="text-[10px] text-text-secondary">Text Content</span>
        <textarea
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder="Enter text..."
          className="w-full h-20 px-3 py-2 text-sm text-text-primary bg-background-tertiary border border-border rounded-lg resize-none outline-none focus:border-primary"
          style={{ fontFamily: style.fontFamily }}
        />
      </div>

      <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
        <FontSelector
          value={style.fontFamily}
          onChange={(fontFamily) => handleStyleChange({ fontFamily })}
        />
        <NumberInput
          label="Size"
          value={style.fontSize}
          onChange={(fontSize) => handleStyleChange({ fontSize })}
          min={8}
          max={500}
          unit="px"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary">Style</span>
          <div className="flex gap-1">
            <button
              onClick={() =>
                handleStyleChange({
                  fontWeight: style.fontWeight === "bold" ? "normal" : "bold",
                })
              }
              className={`p-1.5 rounded transition-colors ${
                style.fontWeight === "bold"
                  ? "bg-primary text-white"
                  : "bg-background-secondary border border-border text-text-secondary hover:text-text-primary"
              }`}
              title="Bold"
            >
              <Bold size={12} />
            </button>
            <button
              onClick={() =>
                handleStyleChange({
                  fontStyle: style.fontStyle === "italic" ? "normal" : "italic",
                })
              }
              className={`p-1.5 rounded transition-colors ${
                style.fontStyle === "italic"
                  ? "bg-primary text-white"
                  : "bg-background-secondary border border-border text-text-secondary hover:text-text-primary"
              }`}
              title="Italic"
            >
              <Italic size={12} />
            </button>
            <button
              onClick={() =>
                handleStyleChange({
                  textDecoration:
                    style.textDecoration === "underline" ? "none" : "underline",
                })
              }
              className={`p-1.5 rounded transition-colors ${
                style.textDecoration === "underline"
                  ? "bg-primary text-white"
                  : "bg-background-secondary border border-border text-text-secondary hover:text-text-primary"
              }`}
              title="Underline"
            >
              <Underline size={12} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-secondary">Text Align</span>
        <ToggleButtonGroup
          options={[
            { value: "left", icon: <AlignLeft size={12} />, label: "Left" },
            {
              value: "center",
              icon: <AlignCenter size={12} />,
              label: "Center",
            },
            { value: "right", icon: <AlignRight size={12} />, label: "Right" },
          ]}
          value={style.textAlign}
          onChange={(textAlign) =>
            handleStyleChange({
              textAlign: textAlign as "left" | "center" | "right",
            })
          }
        />
      </div>

      <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
        <span className="text-[10px] text-text-secondary font-medium">
          Position on Canvas
        </span>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-muted">Align to Canvas</span>
          <div className="flex gap-1">
            <button
              onClick={handleCenterHorizontal}
              className="p-1.5 rounded bg-background-secondary border border-border text-text-secondary hover:text-text-primary transition-colors"
              title="Center Horizontally"
            >
              <AlignHorizontalJustifyCenter size={12} />
            </button>
            <button
              onClick={handleCenterVertical}
              className="p-1.5 rounded bg-background-secondary border border-border text-text-secondary hover:text-text-primary transition-colors"
              title="Center Vertically"
            >
              <AlignVerticalJustifyCenter size={12} />
            </button>
            <button
              onClick={handleCenterBoth}
              className="p-1.5 rounded bg-primary text-white transition-colors"
              title="Center Both"
            >
              <Crosshair size={12} />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
        <ColorPicker
          label="Text Color"
          value={style.color}
          onChange={(color) => handleStyleChange({ color })}
        />
        <ColorPicker
          label="Background"
          value={style.backgroundColor || "transparent"}
          onChange={(backgroundColor) => handleStyleChange({ backgroundColor })}
        />
      </div>

      <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
        <span className="text-[10px] text-text-secondary font-medium">
          Stroke
        </span>
        <ColorPicker
          label="Color"
          value={style.strokeColor || "#000000"}
          onChange={(strokeColor) => handleStyleChange({ strokeColor })}
        />
        <NumberInput
          label="Width"
          value={style.strokeWidth || 0}
          onChange={(strokeWidth) => handleStyleChange({ strokeWidth })}
          min={0}
          max={20}
          unit="px"
        />
      </div>

      <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
        <span className="text-[10px] text-text-secondary font-medium">
          Shadow
        </span>
        <ColorPicker
          label="Color"
          value={style.shadowColor || "#000000"}
          onChange={(shadowColor) => handleStyleChange({ shadowColor })}
        />
        <NumberInput
          label="Offset X"
          value={style.shadowOffsetX || 0}
          onChange={(shadowOffsetX) => handleStyleChange({ shadowOffsetX })}
          min={-50}
          max={50}
          unit="px"
        />
        <NumberInput
          label="Offset Y"
          value={style.shadowOffsetY || 0}
          onChange={(shadowOffsetY) => handleStyleChange({ shadowOffsetY })}
          min={-50}
          max={50}
          unit="px"
        />
        <NumberInput
          label="Blur"
          value={style.shadowBlur || 0}
          onChange={(shadowBlur) => handleStyleChange({ shadowBlur })}
          min={0}
          max={50}
          unit="px"
        />
      </div>

      <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
        <NumberInput
          label="Line Height"
          value={style.lineHeight || 1.2}
          onChange={(lineHeight) => handleStyleChange({ lineHeight })}
          min={0.5}
          max={3}
          step={0.1}
        />
        <NumberInput
          label="Letter Spacing"
          value={style.letterSpacing || 0}
          onChange={(letterSpacing) => handleStyleChange({ letterSpacing })}
          min={-10}
          max={50}
          unit="px"
        />
      </div>
    </div>
  );
};

export default TextSection;
