import React, { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ensureFontFamily } from "../../../services/project-fonts";
import {
  Button, Card, Input, Label, RadioGroup, RadioGroupItem,
  Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem,
  Switch, Textarea, cn,
} from "@openreel/ui";
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
  UploadCloud,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { DEFAULT_TEXT_SHADER_PROGRESS } from "../panels/effect-previews/kind-defs";
import type {
  MotionShaderParamValue,
  TextShaderStyle,
  TextStyle,
  Transform,
  FontWeight,
} from "@openreel/core";
import {
  getMotionShaderDef,
  getMotionShaderEffectDefs,
  getMotionShaderFillDefs,
  getMotionShaderTextDefs,
} from "@openreel/core";
import {
  FONT_CATEGORIES,
  FONT_FILE_ACCEPT,
  registerCustomFont,
  useCustomFonts,
} from "./font-options";
import { toast } from "../../../stores/notification-store";
import { ColorSelector } from "../../../motion/components/primitives";
import { useNumericDraft } from "./shell/useNumericDraft";
import {
  createDefaultEditorShader,
  groupShaderDefsByCollection,
  ShaderParamFields,
} from "./ShaderControls";
import { ShaderPreviewBrowser } from "../../shaders/ShaderPreviewBrowser";
import { useTextFontEdit } from "./useTextFontEdit";
import { useTextSelectionStore } from "../../../stores/text-selection-store";
import { lazyWithRetry } from "./lazy-retry";

// Gradient / run / stroke editors load on first use so the plain title path stays small.
const RichTextSection = lazyWithRetry(() => import("./RichTextSection"));

const textControlClassName = "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50";
const textIconButtonClassName = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const activeTextButtonClassName = "bg-accent text-accent-fg hover:bg-accent/90";
const inactiveTextButtonClassName = "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg";

const ColorField: React.FC<{
  label: string;
  value: string;
  onChange: (color: string) => void;
  showAlpha?: boolean;
  allowTransparent?: boolean;
}> = ({
  label,
  value,
  onChange,
  showAlpha = false,
  allowTransparent = false,
}) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-[12px] leading-5 text-fg-2 font-normal">
      {label}
    </span>
    <div className="flex max-w-[190px] items-center">
      <ColorSelector
        value={value}
        onChange={onChange}
        label={`Select ${label.toLowerCase()}`}
        allowTransparent={allowTransparent}
        fallback={label === "Text Color" ? "#ffffff" : "#000000"}
        showAlpha={showAlpha}
      />
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
}> = ({ label, value, onChange, min = 0, max = 1000, step = 1, unit = "" }) => {
  const id = useId();
  const input = useNumericDraft({ value, onChange, min, max, step });
  return (
    <div className="min-w-0 space-y-1.5 w-full">
      <Label htmlFor={id} className="block truncate text-[11px] font-medium leading-[1.4] text-text-secondary">{label}</Label>
      <div className="relative min-w-0">
        <Input
          {...input}
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          className={cn(textControlClassName, "font-mono tabular-nums h-7 text-[12px]", unit && "pr-9")}
        />
        {unit && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-fg-muted">{unit}</span>}
      </div>
    </div>
  );
};

const ToggleButtonGroup: React.FC<{
  options: { value: string; icon: React.ReactElement; label: string }[];
  value: string;
  onChange: (value: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="flex gap-1">
    {options.map((option) => (
      <Button
        key={option.value}
        type="button"
        aria-label={option.label}
        title={option.label}
        aria-pressed={value === option.value}
        size="icon-sm"
        variant="ghost"
        className={cn(textIconButtonClassName, value === option.value ? activeTextButtonClassName : inactiveTextButtonClassName)}
        onClick={() => onChange(option.value)}
      >
        {option.icon}
      </Button>
    ))}
  </div>
);

const FontSelector: React.FC<{
  value: string;
  onChange: (font: string) => void;
}> = ({ value, onChange }) => {
  const customFonts = useCustomFonts();
  const options = useMemo(() => [
    ...Object.entries(FONT_CATEGORIES).map(([category, fonts]) => ({
      type: "section" as const,
      title: category,
      options: fonts.map((font) => ({
        label: font,
        value: font,
      })),
    })),
    ...(customFonts.length > 0
      ? [
          {
            type: "section" as const,
            title: "Custom Uploads",
            options: customFonts.map((font) => ({
              label: font,
              value: font,
            })),
          },
        ]
      : []),
  ], [customFonts]);

  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] leading-5 text-fg-2 font-normal">
        Font
      </span>
      <div className="min-w-0 space-y-1.5 w-[160px]">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger aria-label="Font" className={cn(textControlClassName, "h-7 text-[12px]")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((section) => (
              <SelectGroup key={section.title}>
                <SelectLabel>{section.title}</SelectLabel>
                {section.options.map((font) => <SelectItem key={font.value} value={font.value}>{font.label}</SelectItem>)}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

interface TextSectionProps {
  clipId: string;
  clipIds?: readonly string[];
}

/**
 * TextSection Component
 *
 * - 15.1: Display text content editor and styling controls
 */
export const TextSection: React.FC<TextSectionProps> = ({ clipId, clipIds }) => {
  const {
    getTextClip,
    updateTextContent,
    updateTextStyle,
    updateTextTransform,
    beginHistoryGroup,
    endHistoryGroup,
    project,
  } = useProjectStore();
  const [fontFile, setFontFile] = useState<File | null>(null);
  const fontUploadRequest = useRef(0);
  const [fontDragOver, setFontDragOver] = useState(false);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const contentId = useId();
  const targetClipIds = useMemo(() => clipIds?.length ? clipIds : [clipId], [clipIds, clipId]);
  const isBatch = targetClipIds.length > 1;
  const numericScope = `${project.id}:${targetClipIds.join("|")}`;
  const beginFontEdit = useTextFontEdit(project.id, targetClipIds);
  useEffect(() => { fontUploadRequest.current += 1; setFontFile(null); }, [numericScope]);

  const textClips = useMemo(
    () => targetClipIds.flatMap((id) => {
      const clip = getTextClip(id);
      return clip ? [clip] : [];
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getTextClip, project.modifiedAt, targetClipIds.join("|")],
  );
  const textClip = textClips[0];

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
        fontUploadRequest.current += 1;
        setFontFile(null);
        const edit = beginFontEdit();
        try {
          try {
            await ensureFontFamily(changes.fontFamily, changes.fontWeight ?? style.fontWeight, text);
          } catch {
            // Preserve advanced font fallback when the selected face is unavailable.
          }
          edit.commit(changes);
        } finally {
          edit.cancel();
        }
        return;
      }
      if (isBatch) beginHistoryGroup("Update selected text properties");
      try {
        for (const targetId of targetClipIds) updateTextStyle(targetId, changes);
      } finally {
        if (isBatch) endHistoryGroup();
      }
    },
    [beginFontEdit, beginHistoryGroup, endHistoryGroup, isBatch, style.fontWeight, text, targetClipIds, updateTextStyle],
  );

  const handleCenterHorizontal = useCallback(() => {
    if (isBatch) beginHistoryGroup("Center selected text horizontally");
    try {
      for (const clip of textClips) {
        const currentY = clip.transform?.position?.y ?? 0.5;
        updateTextTransform(clip.id, { position: { x: 0.5, y: currentY } });
      }
    } finally {
      if (isBatch) endHistoryGroup();
    }
  }, [beginHistoryGroup, endHistoryGroup, isBatch, textClips, updateTextTransform]);

  const handleCenterVertical = useCallback(() => {
    if (isBatch) beginHistoryGroup("Center selected text vertically");
    try {
      for (const clip of textClips) {
        const currentX = clip.transform?.position?.x ?? 0.5;
        updateTextTransform(clip.id, { position: { x: currentX, y: 0.5 } });
      }
    } finally {
      if (isBatch) endHistoryGroup();
    }
  }, [beginHistoryGroup, endHistoryGroup, isBatch, textClips, updateTextTransform]);

  const handleCenterBoth = useCallback(() => {
    if (isBatch) beginHistoryGroup("Center selected text");
    try {
      for (const targetId of targetClipIds) {
        updateTextTransform(targetId, { position: { x: 0.5, y: 0.5 } });
      }
    } finally {
      if (isBatch) endHistoryGroup();
    }
  }, [beginHistoryGroup, endHistoryGroup, isBatch, targetClipIds, updateTextTransform]);

  const handleCustomFontSelect = useCallback(
    async (files: File | File[] | null) => {
      const file = Array.isArray(files) ? files[0] : files;
      setFontFile(file ?? null);
      if (!file) return;
      const uploadRequest = ++fontUploadRequest.current;
      const edit = beginFontEdit();
      try {
        const result = await registerCustomFont(file);
        if (!edit.isCurrent()) return;
        if (!result.success) {
          toast.error("Font upload failed", result.error ?? "Unknown error.");
        } else {
          await ensureFontFamily(result.fontFamily, style.fontWeight, text);
          if (!edit.isCurrent()) return;
          if (edit.commit({ fontFamily: result.fontFamily }))
            toast.success("Custom font uploaded", `${result.fontFamily} is ready to use.`);
        }
        setFontFile(null);
      } catch {
        if (edit.isCurrent()) {
          setFontFile(null);
          toast.error("Font upload failed", "The uploaded font could not be loaded.");
        }
      } finally {
        edit.cancel();
        if (uploadRequest === fontUploadRequest.current) setFontFile(null);
      }
    },
    [beginFontEdit, style.fontWeight, text],
  );

  if (!textClip) {
    return (
      <div className="p-4 text-center">
        <Type size={24} className="mx-auto mb-2 text-fg-3" />
        <span className="text-[12px] leading-5 text-fg-2 font-normal">
          No text clip selected
        </span>
      </div>
    );
  }

  const allBold = textClips.every(({ style: candidate }) =>
    candidate.fontWeight === "bold" ||
    (typeof candidate.fontWeight === "number" && candidate.fontWeight >= 700),
  );
  const allItalic = textClips.every(
    ({ style: candidate }) => candidate.fontStyle === "italic",
  );
  const allUnderlined = textClips.every(
    ({ style: candidate }) => candidate.textDecoration === "underline",
  );

  return (
    <div className="space-y-4">
      {isBatch ? (
        <Card className="min-w-0 rounded-[7px] border border-status-success/25 bg-status-success/10 p-3 text-fg shadow-none">
          <span className="font-normal block text-[10px] text-fg-2">
            Applying the full Text inspector to {textClips.length} selected clips. Caption content and timing stay unchanged.
          </span>
        </Card>
      ) : (
        <div className="min-w-0 space-y-1.5 w-full">
          <Label htmlFor={contentId} className="block truncate text-[11px] font-medium leading-[1.4] text-text-secondary">Text Content</Label>
          <Textarea
            id={contentId}
            className={cn(textControlClassName, "min-h-[5.75rem] resize-y leading-5 text-[12px]")}
            rows={4}
            value={text}
            onChange={(event) => handleTextChange(event.currentTarget.value)}
            onSelect={(event) => {
              const { selectionStart, selectionEnd } = event.currentTarget;
              useTextSelectionStore.getState().setSelection(clipId, selectionStart, selectionEnd);
            }}
            placeholder="Enter text..."
            style={{ fontFamily: style.fontFamily }}
          />
        </div>
      )}

      {!isBatch && (
        <Suspense fallback={null}>
          <RichTextSection clipId={clipId} clip={textClip} />
        </Suspense>
      )}

      <Card className="min-w-0 rounded-[7px] border border-transparent bg-bg-2 p-3 text-fg shadow-none">
        <div className="space-y-2">
          <FontSelector
            value={style.fontFamily}
            onChange={(fontFamily) => handleStyleChange({ fontFamily })}
          />
          <div className="min-w-0 w-full">
            <Input
              ref={fontInputRef}
              type="file"
              accept={FONT_FILE_ACCEPT}
              aria-hidden="true"
              tabIndex={-1}
              className="hidden"
              onChange={(event) => {
                void handleCustomFontSelect(event.currentTarget.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Custom Font"
              className={cn(
                "flex h-8 w-full min-w-0 cursor-pointer items-center justify-center gap-2 whitespace-normal rounded-[7px] border border-solid border-border bg-bg-2 px-2.5 text-center text-[12px] font-semibold leading-[1.4] text-fg-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5",
                fontDragOver && "border-accent bg-selected text-accent",
              )}
              onClick={() => fontInputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setFontDragOver(true); }}
              onDragOver={(event) => { event.preventDefault(); setFontDragOver(true); }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFontDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setFontDragOver(false);
                void handleCustomFontSelect(event.dataTransfer.files[0] ?? null);
              }}
            >
              <span className="flex shrink-0 items-center justify-center text-fg-muted"><UploadCloud size={14} aria-hidden /></span>
              <span className="min-w-0"><span className="block truncate">{fontFile?.name ?? "Upload custom font"}</span></span>
            </Button>
          </div>
          <NumberInput key={`${numericScope}:Size`}
            label="Size"
            value={style.fontSize}
            onChange={(fontSize) => handleStyleChange({ fontSize })}
            min={8}
            max={500}
            unit="px"
          />
          <div className="flex items-center justify-between">
            <span className="text-[12px] leading-5 text-fg-2 font-normal">
              Style
            </span>
            <div className="flex gap-1">
              <Button
                type="button" variant="ghost" size="icon-sm"
                aria-label="Bold" title="Bold" aria-pressed={allBold}
                className={cn(textIconButtonClassName, allBold ? activeTextButtonClassName : inactiveTextButtonClassName)}
                onClick={() =>
                  handleStyleChange({
                    fontWeight: allBold ? "normal" : "bold",
                  })
                }
              >
                <Bold size={12} />
              </Button>
              <Button
                type="button" variant="ghost" size="icon-sm"
                aria-label="Italic" title="Italic" aria-pressed={allItalic}
                className={cn(textIconButtonClassName, allItalic ? activeTextButtonClassName : inactiveTextButtonClassName)}
                onClick={() =>
                  handleStyleChange({
                    fontStyle: allItalic ? "normal" : "italic",
                  })
                }
              >
                <Italic size={12} />
              </Button>
              <Button
                type="button" variant="ghost" size="icon-sm"
                aria-label="Underline" title="Underline" aria-pressed={allUnderlined}
                className={cn(textIconButtonClassName, allUnderlined ? activeTextButtonClassName : inactiveTextButtonClassName)}
                onClick={() =>
                  handleStyleChange({
                    textDecoration:
                      allUnderlined ? "none" : "underline",
                  })
                }
              >
                <Underline size={12} />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-[12px] leading-5 text-fg-2 font-normal">
          Text Align
        </span>
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

      <Card className="min-w-0 rounded-[7px] border border-transparent bg-bg-2 p-3 text-fg shadow-none">
        <div className="space-y-2">
          <span className="text-[12px] leading-5 text-fg font-medium">
            Position on Canvas
          </span>
          <div className="flex items-center justify-between">
            <span className="text-[12px] leading-5 text-fg-2 font-normal">
              Align to Canvas
            </span>
            <div className="flex gap-1">
              <Button
                type="button" variant="ghost" size="icon-sm"
                aria-label="Center Horizontally" title="Center Horizontally"
                className={cn(textIconButtonClassName, inactiveTextButtonClassName)}
                onClick={handleCenterHorizontal}
              >
                <AlignHorizontalJustifyCenter size={12} />
              </Button>
              <Button
                type="button" variant="ghost" size="icon-sm"
                aria-label="Center Vertically" title="Center Vertically"
                className={cn(textIconButtonClassName, inactiveTextButtonClassName)}
                onClick={handleCenterVertical}
              >
                <AlignVerticalJustifyCenter size={12} />
              </Button>
              <Button
                type="button" variant="ghost" size="icon-sm"
                aria-label="Center Both" title="Center Both"
                className={cn(textIconButtonClassName, activeTextButtonClassName)}
                onClick={handleCenterBoth}
              >
                <Crosshair size={12} />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="min-w-0 rounded-[7px] border border-transparent bg-bg-2 p-3 text-fg shadow-none">
        <div className="space-y-2">
          <ColorField
            label="Text Color"
            value={style.color}
            onChange={(color) => handleStyleChange({ color })}
          />
          <ColorField
            label="Background"
            value={style.backgroundColor || "transparent"}
            onChange={(backgroundColor) => handleStyleChange({ backgroundColor })}
            showAlpha
            allowTransparent
          />
        </div>
      </Card>

      <Card className="min-w-0 rounded-[7px] border border-transparent bg-bg-2 p-3 text-fg shadow-none">
        <div className="space-y-2">
          <span className="text-[12px] leading-5 text-fg font-medium">
            Stroke
          </span>
          <ColorField
            label="Color"
            value={style.strokeColor || "#000000"}
            onChange={(strokeColor) => handleStyleChange({ strokeColor })}
          />
          <NumberInput key={`${numericScope}:Width`}
            label="Width"
            value={style.strokeWidth || 0}
            onChange={(strokeWidth) => handleStyleChange({ strokeWidth })}
            min={0}
            max={20}
            unit="px"
          />
        </div>
      </Card>

      <Card className="min-w-0 rounded-[7px] border border-transparent bg-bg-2 p-3 text-fg shadow-none">
        <div className="space-y-2">
          <span className="text-[12px] leading-5 text-fg font-medium">
            Shadow
          </span>
          <ColorField
            label="Color"
            value={style.shadowColor || "#000000"}
            onChange={(shadowColor) => handleStyleChange({ shadowColor })}
            showAlpha
          />
          <NumberInput key={`${numericScope}:Offset X`}
            label="Offset X"
            value={style.shadowOffsetX || 0}
            onChange={(shadowOffsetX) => handleStyleChange({ shadowOffsetX })}
            min={-50}
            max={50}
            unit="px"
          />
          <NumberInput key={`${numericScope}:Offset Y`}
            label="Offset Y"
            value={style.shadowOffsetY || 0}
            onChange={(shadowOffsetY) => handleStyleChange({ shadowOffsetY })}
            min={-50}
            max={50}
            unit="px"
          />
          <NumberInput key={`${numericScope}:Blur`}
            label="Blur"
            value={style.shadowBlur || 0}
            onChange={(shadowBlur) => handleStyleChange({ shadowBlur })}
            min={0}
            max={50}
            unit="px"
          />
        </div>
      </Card>

      <Card className="min-w-0 rounded-[7px] border border-transparent bg-bg-2 p-3 text-fg shadow-none">
        <div className="space-y-2">
          <NumberInput key={`${numericScope}:Line Height`}
            label="Line Height"
            value={style.lineHeight || 1.2}
            onChange={(lineHeight) => handleStyleChange({ lineHeight })}
            min={0.5}
            max={3}
            step={0.1}
          />
          <NumberInput key={`${numericScope}:Letter Spacing`}
            label="Letter Spacing"
            value={style.letterSpacing || 0}
            onChange={(letterSpacing) => handleStyleChange({ letterSpacing })}
            min={-10}
            max={50}
            unit="px"
          />
        </div>
      </Card>

      <TextShaderControls
        historyKey={numericScope}
        shader={style.shader}
        text={text}
        previewStyle={style}
        previewTransform={textClip?.transform}
        onChange={(shader) => handleStyleChange({ shader })}
      />

      <Text3DControls clipId={clipId} clipIds={targetClipIds} />
    </div>
  );
};

// ─── Text shader controls ────────────────────────────────────────


const TextShaderControls: React.FC<{
  historyKey: string;
  shader: TextShaderStyle | undefined;
  text: string;
  previewStyle: TextStyle;
  previewTransform: Transform | undefined;
  onChange: (shader: TextShaderStyle | undefined) => void;
}> = ({ historyKey, shader, text, previewStyle, previewTransform, onChange }) => {
  const materialDefs = useMemo(
    () => [
      ...getMotionShaderTextDefs(),
      ...getMotionShaderFillDefs(),
      ...getMotionShaderEffectDefs(),
    ],
    [],
  );
  const shaderOptions = useMemo(
    () =>
      groupShaderDefsByCollection(
        materialDefs,
        [{ value: "", label: "None" }],
      ),
    [materialDefs],
  );

  const def = shader ? getMotionShaderDef(shader.shaderId) : undefined;

  const handleShaderSelect = useCallback(
    (shaderId: string) => {
      if (!shaderId) {
        onChange(undefined);
        return;
      }
      const next = createDefaultEditorShader(shaderId);
      if (!next) return;
      const nextDef = getMotionShaderDef(shaderId);
      if (!nextDef) return;
      onChange({
        ...next,
        progress: DEFAULT_TEXT_SHADER_PROGRESS,
      });
    },
    [onChange],
  );

  const updateParam = useCallback(
    (name: string, value: MotionShaderParamValue) => {
      if (!shader) return;
      onChange({
        ...shader,
        params: {
          ...shader.params,
          [name]: value,
        },
      });
    },
    [onChange, shader],
  );

  return (
    <Card data-inspector-anchor="text-materials" className="min-w-0 rounded-[7px] border border-transparent bg-bg-2 p-3 text-fg shadow-none">
      <div className="space-y-2">
        <span className="text-[12px] leading-5 text-fg font-medium">
          Text Material
        </span>
        <div className="min-w-0 space-y-1.5 w-full">
          <Select value={shader?.shaderId ?? "__no_text_material__"} onValueChange={(value) => handleShaderSelect(value === "__no_text_material__" ? "" : value)}>
            <SelectTrigger aria-label="Text Material" className={cn(textControlClassName, "h-7 text-[12px]")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {shaderOptions.map((section) => (
                <SelectGroup key={section.title}>
                  <SelectLabel>{section.title}</SelectLabel>
                  {section.options.map((option) => <SelectItem key={option.value} value={option.value || "__no_text_material__"}>{option.label}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ShaderPreviewBrowser
          defs={materialDefs}
          selectedId={shader?.shaderId}
          onSelect={handleShaderSelect}
          sample="text"
          label="Text material previews"
          text={text}
          textStyle={previewStyle}
          textTransform={previewTransform}
        />
        {shader && def ? (
          <>
            <NumberInput key={`${historyKey}:Progress`}
              label="Progress"
              value={shader.progress ?? DEFAULT_TEXT_SHADER_PROGRESS}
              onChange={(progress) =>
                onChange({
                  ...shader,
                  progress: Math.max(0, Math.min(1, progress)),
                })
              }
              min={0}
              max={1}
              step={0.01}
            />
            <ShaderParamFields
              historyKey={historyKey}
              def={def}
              params={shader.params}
              onChange={updateParam}
            />
          </>
        ) : null}
      </div>
    </Card>
  );
};

// ─── 3D Text controls ─────────────────────────────────────────────

interface Text3DControlsProps {
  clipId: string;
  clipIds?: readonly string[];
}

type Text3DDefaults = {
  enabled: boolean;
  depth: number;
  bevelThickness: number;
  bevelSize: number;
  bevelSegments: number;
  material: "basic" | "physical";
  metalness: number;
  roughness: number;
};

const DEFAULT_TEXT_3D: Text3DDefaults = {
  enabled: true,
  depth: 12,
  bevelThickness: 1.5,
  bevelSize: 0.8,
  bevelSegments: 3,
  material: "physical",
  metalness: 0.4,
  roughness: 0.45,
};

const Text3DControls: React.FC<Text3DControlsProps> = ({ clipId, clipIds }) => {
  const materialId = useId();
  const {
    getTextClip,
    updateText3D,
    project,
    updateTextTransform,
    beginHistoryGroup,
    endHistoryGroup,
  } = useProjectStore();
  const targetClipIds = useMemo(() => clipIds?.length ? clipIds : [clipId], [clipIds, clipId]);
  const isBatch = targetClipIds.length > 1;
  const numericScope = `${project.id}:${targetClipIds.join("|")}`;
  const textClip = useMemo(
    () => getTextClip(clipId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clipId, getTextClip, project.modifiedAt],
  );
  const text3d = textClip?.text3d;
  const enabled = text3d?.enabled ?? false;

  const apply = useCallback(
    (changes: Partial<typeof DEFAULT_TEXT_3D>) => {
      if (isBatch) beginHistoryGroup("Update selected 3D text properties");
      try {
        for (const targetId of targetClipIds) {
          const current = getTextClip(targetId)?.text3d;
          const next = { ...(current ?? DEFAULT_TEXT_3D), ...changes };
          updateText3D(targetId, next);
        }
      } finally {
        if (isBatch) endHistoryGroup();
      }
    },
    [beginHistoryGroup, endHistoryGroup, getTextClip, isBatch, targetClipIds, updateText3D],
  );

  const handleEnabledChange = useCallback(
    (nextEnabled: boolean) => {
      beginHistoryGroup(nextEnabled ? "Enable 3D text" : "Disable 3D text");
      try {
        for (const targetId of targetClipIds) {
          const current = getTextClip(targetId);
          if (!current) continue;
          updateText3D(targetId, { ...(current.text3d ?? DEFAULT_TEXT_3D), enabled: nextEnabled });
          const rot = current.transform.rotate3d ?? { x: 0, y: 0, z: 0 };
          if (nextEnabled && rot.x === 0 && rot.y === 0) {
            updateTextTransform(targetId, { rotate3d: { x: -10, y: 18, z: rot.z } });
          }
        }
      } finally {
        endHistoryGroup();
      }
    },
    [beginHistoryGroup, endHistoryGroup, getTextClip, targetClipIds, updateText3D, updateTextTransform],
  );

  return (
    <Card className="min-w-0 rounded-[7px] border border-transparent bg-bg-2 p-3 text-fg shadow-none">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] leading-5 text-fg font-medium">
            3D Text
          </span>
          <div className="flex min-w-0 items-center justify-between gap-3 py-1">
            <Switch aria-label="3D Text" checked={enabled} onCheckedChange={handleEnabledChange} className="workspace-switch flex-none" />
          </div>
        </div>
        {enabled && (
          <>
            <NumberInput key={`${numericScope}:Depth`}
              label="Depth"
              value={text3d?.depth ?? DEFAULT_TEXT_3D.depth}
              onChange={(depth) => apply({ depth })}
              min={1}
              max={120}
              step={1}
              unit="px"
            />
            <NumberInput key={`${numericScope}:Bevel Thickness`}
              label="Bevel Thickness"
              value={text3d?.bevelThickness ?? DEFAULT_TEXT_3D.bevelThickness}
              onChange={(bevelThickness) => apply({ bevelThickness })}
              min={0}
              max={20}
              step={0.1}
            />
            <NumberInput key={`${numericScope}:Bevel Size`}
              label="Bevel Size"
              value={text3d?.bevelSize ?? DEFAULT_TEXT_3D.bevelSize}
              onChange={(bevelSize) => apply({ bevelSize })}
              min={0}
              max={10}
              step={0.1}
            />
            <NumberInput key={`${numericScope}:Bevel Segments`}
              label="Bevel Segments"
              value={text3d?.bevelSegments ?? DEFAULT_TEXT_3D.bevelSegments}
              onChange={(bevelSegments) =>
                apply({ bevelSegments: Math.max(1, Math.round(bevelSegments)) })
              }
              min={1}
              max={8}
              step={1}
            />
            <RadioGroup
              aria-label="Material"
              value={text3d?.material ?? "physical"}
              onValueChange={(material) => {
                if (material === "basic" || material === "physical") apply({ material });
              }}
              className="grid min-h-8 min-w-0 grid-cols-2 gap-0 rounded-[7px] border border-border bg-bg-1 p-0.5"
            >
              {(["basic", "physical"] as const).map((material) => (
                <div key={material} className="relative min-w-0">
                  <RadioGroupItem
                    id={`${materialId}-${material}`} value={material} className="peer sr-only"
                    onKeyDown={(event) => {
                      if (event.altKey || event.ctrlKey || event.metaKey) return;
                      const next = event.key === "Home" ? "basic" : event.key === "End" ? "physical"
                        : ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
                          ? material === "basic" ? "physical" : "basic" : null;
                      // Native keyup can precede Radix's deferred focus move.
                      // Select now; Radix still owns roving focus and wrapping.
                      if (next && next !== (text3d?.material ?? "physical")) apply({ material: next });
                    }}
                  />
                  <Label
                    htmlFor={`${materialId}-${material}`}
                    className={cn(
                      "inline-flex h-7 w-full min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[5px] px-2 text-[12px] font-semibold leading-[1.4] text-fg-muted transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                      (text3d?.material ?? "physical") === material
                        ? "bg-bg-3 text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                        : "hover:bg-bg-2 hover:text-fg-2",
                    )}
                  >
                    <span className="truncate">{material === "basic" ? "Basic" : "Physical"}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {(text3d?.material ?? "physical") === "physical" && (
              <>
                <NumberInput key={`${numericScope}:Metalness`}
                  label="Metalness"
                  value={text3d?.metalness ?? DEFAULT_TEXT_3D.metalness}
                  onChange={(metalness) =>
                    apply({ metalness: Math.max(0, Math.min(1, metalness)) })
                  }
                  min={0}
                  max={1}
                  step={0.05}
                />
                <NumberInput key={`${numericScope}:Roughness`}
                  label="Roughness"
                  value={text3d?.roughness ?? DEFAULT_TEXT_3D.roughness}
                  onChange={(roughness) =>
                    apply({ roughness: Math.max(0, Math.min(1, roughness)) })
                  }
                  min={0}
                  max={1}
                  step={0.05}
                />
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
};
