import React, { useCallback, useMemo, useState } from "react";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftFileDropControl as FileInput } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
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
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import type {
  MotionShaderParamValue,
  TextShaderStyle,
  TextStyle,
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
import { MockToggle } from "./shell/InspectorControls";
import {
  createDefaultEditorShader,
  groupShaderDefsByCollection,
  ShaderParamFields,
} from "./ShaderControls";
import { ShaderPreviewBrowser } from "../../shaders/ShaderPreviewBrowser";
import { useTranslation } from "react-i18next";

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
    <Text type="supporting" color="secondary">
      {label}
    </Text>
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
}> = ({ label, value, onChange, min = 0, max = 1000, step = 1, unit = "" }) => (
  <ToolcraftNumberInputControl
    label={label}
    size="sm"
    width="100%"
    value={Number.isFinite(value) ? value : 0}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    units={unit || null}
  />
);

const ToggleButtonGroup: React.FC<{
  options: { value: string; icon: React.ReactElement; label: string }[];
  value: string;
  onChange: (value: string) => void;
}> = ({ options, value, onChange }) => {
  const { t } = useTranslation();
  return (
  <div className="flex gap-1">
    {options.map((option) => (
      <IconButton
        key={option.value}
        label={t(option.label)}
        icon={option.icon as any}
        size="sm"
        variant={value === option.value ? "primary" : "secondary"}
        onClick={() => onChange(option.value)}
      />
    ))}
  </div>
);
};

const FontSelector: React.FC<{
  value: string;
  onChange: (font: string) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const customFonts = useCustomFonts();
  const options = [
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
            title: t("Custom Uploads"),
            options: customFonts.map((font) => ({
              label: font,
              value: font,
            })),
          },
        ]
      : []),
  ];

  return (
    <div className="flex items-center justify-between">
      <Text type="supporting" color="secondary">
        {t("Font")}</Text>
      <Selector
        label={t("Font")}
        isLabelHidden
        size="sm"
        width={160}
        value={value}
        options={options as any}
        onChange={onChange}
        hasSearch
        searchPlaceholder={t("Search fonts")}
      />
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
  const { t } = useTranslation();
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
  const targetClipIds = clipIds?.length ? clipIds : [clipId];
  const isBatch = targetClipIds.length > 1;

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
        try {
          const fontSize = style.fontSize || 48;
          await document.fonts.load(`${fontSize}px "${changes.fontFamily}"`);
        } catch {
          // Font load failed, continue anyway - browser will fallback
        }
      }
      if (isBatch) beginHistoryGroup("Update selected text properties");
      try {
        for (const targetId of targetClipIds) updateTextStyle(targetId, changes);
      } finally {
        if (isBatch) endHistoryGroup();
      }
    },
    [beginHistoryGroup, endHistoryGroup, isBatch, style.fontSize, targetClipIds, updateTextStyle],
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

      const result = await registerCustomFont(file);
      if (!result.success) {
        toast.error("Font upload failed", result.error ?? "Unknown error.");
      } else {
        await handleStyleChange({ fontFamily: result.fontFamily });
        toast.success("Custom font uploaded", `${result.fontFamily} is ready to use.`);
      }

      setFontFile(null);
    },
    [handleStyleChange],
  );

  if (!textClip) {
    return (
      <div className="p-4 text-center">
        <Type size={24} className="mx-auto mb-2 text-fg-3" />
        <Text type="supporting" color="secondary">
          {t("No text clip selected")}</Text>
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
        <Card variant="green" padding={3}>
          <Text type="supporting" display="block" className="text-[10px] text-fg-2">
            {t("Applying the full Text inspector to ")}{textClips.length} {t(" selected clips. Caption content and timing stay unchanged.")}</Text>
        </Card>
      ) : (
        <ToolcraftTextAreaControl
          label={t("Text Content")}
          size="sm"
          width="100%"
          rows={4}
          value={text}
          onChange={handleTextChange}
          placeholder={t("Enter text...")}
          style={{ fontFamily: style.fontFamily }}
        />
      )}

      <Card variant="muted" padding={3}>
        <div className="space-y-2">
          <FontSelector
            value={style.fontFamily}
            onChange={(fontFamily) => handleStyleChange({ fontFamily })}
          />
          <FileInput
            label={t("Custom Font")}
            isLabelHidden
            width="100%"
            mode="input"
            value={fontFile}
            accept={FONT_FILE_ACCEPT}
            placeholder={t("Upload custom font")}
            onChange={handleCustomFontSelect}
          />
          <NumberInput
            label={t("Size")}
            value={style.fontSize}
            onChange={(fontSize) => handleStyleChange({ fontSize })}
            min={8}
            max={500}
            unit="px"
          />
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary">
              {t("Style")}</Text>
            <div className="flex gap-1">
              <IconButton
                label={t("Bold")}
                icon={<Bold size={12} />}
                size="sm"
                variant={allBold ? "primary" : "secondary"}
                onClick={() =>
                  handleStyleChange({
                    fontWeight: allBold ? "normal" : "bold",
                  })
                }
              />
              <IconButton
                label={t("Italic")}
                icon={<Italic size={12} />}
                size="sm"
                variant={allItalic ? "primary" : "secondary"}
                onClick={() =>
                  handleStyleChange({
                    fontStyle: allItalic ? "normal" : "italic",
                  })
                }
              />
              <IconButton
                label={t("Underline")}
                icon={<Underline size={12} />}
                size="sm"
                variant={
                  allUnderlined ? "primary" : "secondary"
                }
                onClick={() =>
                  handleStyleChange({
                    textDecoration:
                      allUnderlined ? "none" : "underline",
                  })
                }
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <Text type="supporting" color="secondary">
          {t("Text Align")}</Text>
        <ToggleButtonGroup
          options={[
            { value: "left", icon: <AlignLeft size={12} />, label: t("Left") },
            {
              value: "center",
              icon: <AlignCenter size={12} />,
              label: t("Center"),
            },
            { value: "right", icon: <AlignRight size={12} />, label: t("Right") },
          ]}
          value={style.textAlign}
          onChange={(textAlign) =>
            handleStyleChange({
              textAlign: textAlign as "left" | "center" | "right",
            })
          }
        />
      </div>

      <Card variant="muted" padding={3}>
        <div className="space-y-2">
          <Text type="supporting" color="primary" weight="medium">
            {t("Position on Canvas")}</Text>
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary">
              {t("Align to Canvas")}</Text>
            <div className="flex gap-1">
              <IconButton
                label={t("Center Horizontally")}
                icon={<AlignHorizontalJustifyCenter size={12} />}
                size="sm"
                variant="secondary"
                onClick={handleCenterHorizontal}
              />
              <IconButton
                label={t("Center Vertically")}
                icon={<AlignVerticalJustifyCenter size={12} />}
                size="sm"
                variant="secondary"
                onClick={handleCenterVertical}
              />
              <IconButton
                label={t("Center Both")}
                icon={<Crosshair size={12} />}
                size="sm"
                variant="primary"
                onClick={handleCenterBoth}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card variant="muted" padding={3}>
        <div className="space-y-2">
          <ColorField
            label={t("Text Color")}
            value={style.color}
            onChange={(color) => handleStyleChange({ color })}
          />
          <ColorField
            label={t("Background")}
            value={style.backgroundColor || "transparent"}
            onChange={(backgroundColor) => handleStyleChange({ backgroundColor })}
            showAlpha
            allowTransparent
          />
        </div>
      </Card>

      <Card variant="muted" padding={3}>
        <div className="space-y-2">
          <Text type="supporting" color="primary" weight="medium">
            {t("Stroke")}</Text>
          <ColorField
            label={t("Color")}
            value={style.strokeColor || "#000000"}
            onChange={(strokeColor) => handleStyleChange({ strokeColor })}
          />
          <NumberInput
            label={t("Width")}
            value={style.strokeWidth || 0}
            onChange={(strokeWidth) => handleStyleChange({ strokeWidth })}
            min={0}
            max={20}
            unit="px"
          />
        </div>
      </Card>

      <Card variant="muted" padding={3}>
        <div className="space-y-2">
          <Text type="supporting" color="primary" weight="medium">
            {t("Shadow")}</Text>
          <ColorField
            label={t("Color")}
            value={style.shadowColor || "#000000"}
            onChange={(shadowColor) => handleStyleChange({ shadowColor })}
            showAlpha
          />
          <NumberInput
            label={t("Offset X")}
            value={style.shadowOffsetX || 0}
            onChange={(shadowOffsetX) => handleStyleChange({ shadowOffsetX })}
            min={-50}
            max={50}
            unit="px"
          />
          <NumberInput
            label={t("Offset Y")}
            value={style.shadowOffsetY || 0}
            onChange={(shadowOffsetY) => handleStyleChange({ shadowOffsetY })}
            min={-50}
            max={50}
            unit="px"
          />
          <NumberInput
            label={t("Blur")}
            value={style.shadowBlur || 0}
            onChange={(shadowBlur) => handleStyleChange({ shadowBlur })}
            min={0}
            max={50}
            unit="px"
          />
        </div>
      </Card>

      <Card variant="muted" padding={3}>
        <div className="space-y-2">
          <NumberInput
            label={t("Line Height")}
            value={style.lineHeight || 1.2}
            onChange={(lineHeight) => handleStyleChange({ lineHeight })}
            min={0.5}
            max={3}
            step={0.1}
          />
          <NumberInput
            label={t("Letter Spacing")}
            value={style.letterSpacing || 0}
            onChange={(letterSpacing) => handleStyleChange({ letterSpacing })}
            min={-10}
            max={50}
            unit="px"
          />
        </div>
      </Card>

      <TextShaderControls
        shader={style.shader}
        onChange={(shader) => handleStyleChange({ shader })}
      />

      <Text3DControls clipId={clipId} clipIds={targetClipIds} />
    </div>
  );
};

// ─── Text shader controls ────────────────────────────────────────

const DEFAULT_TEXT_SHADER_PROGRESS = 0.5;

const TextShaderControls: React.FC<{
  shader: TextShaderStyle | undefined;
  onChange: (shader: TextShaderStyle | undefined) => void;
}> = ({ shader, onChange }) => {
  const { t } = useTranslation();
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
        [{ value: "", label: t("None") }],
      ),
    [materialDefs, t],
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
    <Card variant="muted" padding={3}>
      <div className="space-y-2">
        <Text type="supporting" color="primary" weight="medium">
          {t("Text Material")}</Text>
        <Selector
          label={t("Text Material")}
          isLabelHidden
          size="sm"
          width="100%"
          value={shader?.shaderId ?? ""}
          options={shaderOptions as any}
          onChange={handleShaderSelect}
        />
        <ShaderPreviewBrowser
          defs={materialDefs}
          selectedId={shader?.shaderId}
          onSelect={handleShaderSelect}
          sample="text"
          label={t("Text material previews")}
        />
        {shader && def ? (
          <>
            <NumberInput
              label={t("Progress")}
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
  const { t } = useTranslation();
  const {
    getTextClip,
    updateText3D,
    project,
    updateClipRotate3D,
    beginHistoryGroup,
    endHistoryGroup,
  } = useProjectStore();
  const targetClipIds = clipIds?.length ? clipIds : [clipId];
  const isBatch = targetClipIds.length > 1;
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
      if (!nextEnabled) {
        apply({ enabled: false });
        return;
      }

      apply({ ...DEFAULT_TEXT_3D, enabled: true });
      for (const targetId of targetClipIds) {
        const rot = getTextClip(targetId)?.transform.rotate3d ?? { x: 0, y: 0, z: 0 };
        if (rot.x === 0 && rot.y === 0) {
          updateClipRotate3D(targetId, { x: -10, y: 18, z: 0 });
        }
      }
    },
    [apply, getTextClip, targetClipIds, updateClipRotate3D],
  );

  return (
    <Card variant="muted" padding={3}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Text type="supporting" color="primary" weight="medium">
            {t("3D Text")}</Text>
          <MockToggle
            ariaLabel={t("3D Text")}
            checked={enabled}
            onChange={handleEnabledChange}
          />
        </div>
        {enabled && (
          <>
            <NumberInput
              label={t("Depth")}
              value={text3d?.depth ?? DEFAULT_TEXT_3D.depth}
              onChange={(depth) => apply({ depth })}
              min={1}
              max={120}
              step={1}
              unit="px"
            />
            <NumberInput
              label={t("Bevel Thickness")}
              value={text3d?.bevelThickness ?? DEFAULT_TEXT_3D.bevelThickness}
              onChange={(bevelThickness) => apply({ bevelThickness })}
              min={0}
              max={20}
              step={0.1}
            />
            <NumberInput
              label={t("Bevel Size")}
              value={text3d?.bevelSize ?? DEFAULT_TEXT_3D.bevelSize}
              onChange={(bevelSize) => apply({ bevelSize })}
              min={0}
              max={10}
              step={0.1}
            />
            <NumberInput
              label={t("Bevel Segments")}
              value={text3d?.bevelSegments ?? DEFAULT_TEXT_3D.bevelSegments}
              onChange={(bevelSegments) =>
                apply({ bevelSegments: Math.max(1, Math.round(bevelSegments)) })
              }
              min={1}
              max={8}
              step={1}
            />
            <ToolcraftSegmentedControl<"basic" | "physical">
              ariaLabel={t("Material")}
              value={text3d?.material ?? "physical"}
              onChange={(material) => apply({ material })}
              options={[
                { value: "basic", label: t("Basic") },
                { value: "physical", label: t("Physical") },
              ]}
            />
            {(text3d?.material ?? "physical") === "physical" && (
              <>
                <NumberInput
                  label={t("Metalness")}
                  value={text3d?.metalness ?? DEFAULT_TEXT_3D.metalness}
                  onChange={(metalness) =>
                    apply({ metalness: Math.max(0, Math.min(1, metalness)) })
                  }
                  min={0}
                  max={1}
                  step={0.05}
                />
                <NumberInput
                  label={t("Roughness")}
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

export default TextSection;
