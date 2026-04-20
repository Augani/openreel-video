import React, { useCallback, useMemo } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import type {
  ColorWheelValues,
  HSLValues,
  CurvesValues,
  LUTData,
} from "@openreel/core";
import {
  DEFAULT_COLOR_WHEELS,
  DEFAULT_HSL,
  DEFAULT_CURVES,
} from "@openreel/core";
import { ColorWheelsControl } from "./ColorWheelsControl";
import { CurvesEditor } from "./CurvesEditor";
import { LUTLoader } from "./LUTLoader";
import { HSLControls } from "./HSLControls";
import { useI18n } from "../../../i18n";

const SubSection: React.FC<{
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, children }) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full p-2 bg-background-tertiary hover:bg-background-tertiary/80 transition-colors"
      >
        <ChevronDown
          size={12}
          className={`transition-transform ${
            isOpen ? "" : "-rotate-90"
          } text-text-muted`}
        />
        <span className="text-[10px] font-medium text-text-primary">
          {title}
        </span>
      </button>
      {isOpen && <div className="p-3 space-y-3">{children}</div>}
    </div>
  );
};

interface ColorGradingSectionProps {
  clipId: string;
}

export const ColorGradingSection: React.FC<ColorGradingSectionProps> = ({
  clipId,
}) => {
  const { t } = useI18n();
  const { getColorGrading, updateColorGrading, resetColorGrading } =
    useProjectStore();

  const modifiedAt = useProjectStore((state) => state.project.modifiedAt);

  const colorGrading = useMemo(
    () => getColorGrading(clipId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clipId, getColorGrading, modifiedAt],
  );

  const colorWheelValues: ColorWheelValues = useMemo(() => {
    return colorGrading.colorWheels || { ...DEFAULT_COLOR_WHEELS };
  }, [colorGrading.colorWheels]);

  const hslValues: HSLValues = useMemo(() => {
    return colorGrading.hsl || { ...DEFAULT_HSL };
  }, [colorGrading.hsl]);

  const curvesValues: CurvesValues = useMemo(() => {
    return colorGrading.curves || { ...DEFAULT_CURVES };
  }, [colorGrading.curves]);

  const handleColorWheelsChange = useCallback(
    (values: ColorWheelValues) => {
      updateColorGrading(clipId, { colorWheels: values });
    },
    [clipId, updateColorGrading],
  );

  const handleColorWheelsReset = useCallback(() => {
    updateColorGrading(clipId, { colorWheels: { ...DEFAULT_COLOR_WHEELS } });
  }, [clipId, updateColorGrading]);

  const handleCurvesChange = useCallback(
    (values: CurvesValues) => {
      updateColorGrading(clipId, { curves: values });
    },
    [clipId, updateColorGrading],
  );

  const handleCurvesReset = useCallback(() => {
    updateColorGrading(clipId, { curves: { ...DEFAULT_CURVES } });
  }, [clipId, updateColorGrading]);

  const handleLUTChange = useCallback(
    (lutData: LUTData | null) => {
      updateColorGrading(clipId, { lut: lutData || undefined });
    },
    [clipId, updateColorGrading],
  );

  const handleHSLValuesChange = useCallback(
    (values: HSLValues) => {
      updateColorGrading(clipId, { hsl: values });
    },
    [clipId, updateColorGrading],
  );

  const handleHSLReset = useCallback(() => {
    updateColorGrading(clipId, { hsl: { ...DEFAULT_HSL } });
  }, [clipId, updateColorGrading]);

  const handleResetAll = useCallback(() => {
    resetColorGrading(clipId);
  }, [clipId, resetColorGrading]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={handleResetAll}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
        >
          <RotateCcw size={10} />
          {t("colorGrading.resetAll")}
        </button>
      </div>

      <SubSection title={t("colorGrading.colorWheels")} defaultOpen>
        <ColorWheelsControl
          values={colorWheelValues}
          onChange={handleColorWheelsChange}
          onReset={handleColorWheelsReset}
        />
      </SubSection>

      <SubSection title={t("colorGrading.curves")}>
        <CurvesEditor
          values={curvesValues}
          onChange={handleCurvesChange}
          onReset={handleCurvesReset}
        />
      </SubSection>

      <SubSection title={t("colorGrading.lut")}>
        <LUTLoader
          lutData={colorGrading.lut as LUTData | null}
          onChange={handleLUTChange}
        />
      </SubSection>

      <SubSection title={t("colorGrading.hsl")}>
        <HSLControls
          values={hslValues}
          onChange={handleHSLValuesChange}
          onReset={handleHSLReset}
        />
      </SubSection>
    </div>
  );
};

export default ColorGradingSection;
