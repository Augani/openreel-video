import {
  Button,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  ColorPicker,
  Switch,
} from "@openreel/ui";
import { parseMotionColor, type TextStyle, type FontWeight } from "@openreel/core";
import { useMemo, useRef } from "react";
import { useProjectStore } from "../../../stores/project-store";
import { TextAnimationPhaseControl } from "./TextAnimationPhaseControl";
import { ValueField } from "./PrimaryVideoProperties";
import { ensureFontFamily } from "../../../services/project-fonts";
import { toast } from "../../../stores/notification-store";
import { InspectorSlider } from "./shell/InspectorSlider";
import { FONT_CATEGORIES, useCustomFonts } from "./font-options";
import { useTextFontEdit } from "./useTextFontEdit";
import { useTextSelectionStore } from "../../../stores/text-selection-store";

const builtInFonts = Object.values(FONT_CATEGORIES).flat();

const alignmentPaths = { left: "M4 6h16M4 12h10M4 18h14", center: "M4 6h16M7 12h10M5 18h14", right: "M4 6h16M10 12h10M6 18h14" };
const fontWeights: Record<FontWeight, string> = { normal: "Regular", bold: "Bold", 100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semi Bold", 700: "Bold", 800: "Extra Bold", 900: "Black" };

export function PrimaryTextProperties({ clipId }: { clipId: string }) {
  const project = useProjectStore((s) => s.project);
  const disabledStyles = useRef(new Map<string, Partial<TextStyle>>());
  const text =
    project.textClips?.find((c) => c.id === clipId) ??
    useProjectStore.getState().getTextClip(clipId);
  const customFonts = useCustomFonts();
  const beginFontEdit = useTextFontEdit(project.id, [clipId]);
  const fontFamily = text?.style.fontFamily ?? "Inter";
  const fonts = useMemo(() => [...new Set([fontFamily, ...builtInFonts, ...customFonts])], [fontFamily, customFonts]);
  if (!text) return null;
  const style = text.style;
  const shadowOpacity = parseMotionColor(style.shadowColor ?? "#000000")?.a;
  const styleKey = `${project.id}:${clipId}`;
  const remember = (value: Partial<TextStyle>) => disabledStyles.current.set(styleKey, {
    ...disabledStyles.current.get(styleKey), ...value,
  });
  const letterSpacingPercent =
    (style.letterSpacing / Math.max(1, style.fontSize)) * 100;
  const update = (value: Partial<TextStyle>) =>
    useProjectStore.getState().updateTextStyle(clipId, value);
  return (
    <div className="workspace-primary-text">
      <Textarea
        aria-label="Text content"
        value={text.text}
        onChange={(e) =>
          useProjectStore.getState().updateTextContent(clipId, e.target.value)
        }
        onSelect={(e) => {
          const { selectionStart, selectionEnd } = e.currentTarget;
          useTextSelectionStore.getState().setSelection(clipId, selectionStart, selectionEnd);
        }}
      />
      <div className="workspace-text-font-row">
        <Select
          value={style.fontFamily}
          onValueChange={async (fontFamily) => {
            const edit = beginFontEdit();
            try {
              await ensureFontFamily(fontFamily, style.fontWeight, text.text);
              edit.commit({ fontFamily });
            } catch {
              if (edit.isCurrent()) toast.error(
                "Font unavailable",
                "Choose another font or import it in advanced text settings.",
              );
            } finally {
              edit.cancel();
            }
          }}
        >
          <SelectTrigger
            aria-label="Font family"
            icon={<span aria-hidden="true" className="workspace-text-font-caret">▾</span>}
          >
            <SelectValue>{style.fontFamily} · {fontWeights[style.fontWeight]}{style.fontStyle === "italic" ? " Italic" : ""}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {fonts.map((f) => (
              <SelectItem value={f} key={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ValueField
          label="Font size"
          value={style.fontSize}
          min={1}
          max={1000}
          step={1}
          onChange={(fontSize) => update({ fontSize })}
        />
      </div>
      <div className="workspace-text-alignment">
        <div role="group" aria-label="Text alignment">
          {(["left", "center", "right"] as const).map((v) => {
            return (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Align ${v}`}
                aria-pressed={style.textAlign === v}
                onClick={() => update({ textAlign: v })}
                key={v}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={alignmentPaths[v]}/></svg>
              </Button>
            );
          })}
        </div>
        <label>
          Color
          <ColorPicker
            label="Text color"
            value={style.color}
            showAlpha
            showValue={false}
            className="workspace-text-color"
            onChange={(color) => update({ color })}
          />
        </label>
      </div>
      <div className="workspace-text-property">
        <span>Letter spacing</span>
        <InspectorSlider historyKey={`${clipId}:letter-spacing`}
          aria-label="Letter spacing"
          min={-50}
          max={100}
          step={0.1}
          value={[letterSpacingPercent]}
          onValueChange={([percentage]) =>
            update({ letterSpacing: (percentage * style.fontSize) / 100 })
          }
        />
        <ValueField
          label="Letter spacing value"
          displayPrecision={0}
          value={letterSpacingPercent}
          min={-50}
          max={100}
          step={0.1}
          unit="%"
          onChange={(percentage) =>
            update({ letterSpacing: (percentage * style.fontSize) / 100 })
          }
        />
      </div>
      <div className="workspace-text-property">
        <span>Line height</span>
        <InspectorSlider historyKey={`${clipId}:line-height`}
          aria-label="Line height"
          min={0.5}
          max={3}
          step={0.01}
          value={[style.lineHeight]}
          onValueChange={([lineHeight]) => update({ lineHeight })}
        />
        <ValueField
          label="Line height value"
          value={style.lineHeight}
          min={0.5}
          max={3}
          step={0.01}
          onChange={(lineHeight) => update({ lineHeight })}
        />
      </div>
      <section>
        <h3>Style</h3>
        <label>
          Outline
          <span>
            {style.strokeWidth ?? 0} px
            <Switch
              aria-label="Outline"
              checked={!!style.strokeWidth}
              onCheckedChange={(enabled) => {
                if (!enabled && style.strokeWidth) remember({ strokeWidth: style.strokeWidth });
                update({ strokeWidth: enabled ? disabledStyles.current.get(styleKey)?.strokeWidth ?? 2 : 0 });
              }}
            />
          </span>
        </label>
        <label>
          Shadow
          <span>
            <span>{(style.shadowBlur ?? 0) > 0 ? shadowOpacity === undefined ? "on" : `${Math.round(shadowOpacity * 100)}%` : "off"}</span>
            <Switch
              aria-label="Shadow"
              checked={(style.shadowBlur ?? 0) > 0}
              onCheckedChange={(enabled) => {
                if (!enabled) {
                  if (style.shadowBlur) remember({ shadowBlur: style.shadowBlur });
                  update({ shadowBlur: 0 });
                } else update({
                  shadowBlur: disabledStyles.current.get(styleKey)?.shadowBlur ?? 8,
                  shadowColor: style.shadowColor ?? "#000000",
                  shadowOffsetX: style.shadowOffsetX ?? 2,
                  shadowOffsetY: style.shadowOffsetY ?? 2,
                });
              }}
            />
          </span>
        </label>
        <label>
          Background box
          <span>
            <span>{!!style.backgroundColor && style.backgroundColor !== "transparent" ? "on" : "off"}</span>
            <Switch
              aria-label="Background box"
              checked={
                !!style.backgroundColor &&
                style.backgroundColor !== "transparent"
              }
              onCheckedChange={(enabled) => {
                if (!enabled && style.backgroundColor && style.backgroundColor !== "transparent")
                  remember({ backgroundColor: style.backgroundColor });
                update({ backgroundColor: enabled ? disabledStyles.current.get(styleKey)?.backgroundColor ?? "#111214" : "transparent" });
              }}
            />
          </span>
        </label>
      </section>
      <section>
        <h3>Animation</h3>
        <div className="workspace-text-animation-summary">
          <TextAnimationPhaseControl clipId={clipId} side="entry" animation={text.animation} />
          <TextAnimationPhaseControl clipId={clipId} side="exit" animation={text.animation} />
        </div>
      </section>
    </div>
  );
}
