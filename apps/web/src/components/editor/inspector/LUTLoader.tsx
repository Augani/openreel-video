import { Input as ShadcnInput, Button, Card } from "@openreel/ui";
import React, { useCallback, useRef, useState } from "react";





import { PropertySlider } from "./shell/PropertySlider";
import { Upload, X, AlertCircle } from "@/icons/lucide-compat";
import { parseCubeToLutData, type LUTData } from "@openreel/core";

interface LUTLoaderProps {
  lutData: LUTData | null;
  onChange: (lutData: LUTData | null) => void;
  onError?: (error: string) => void;
  /** Called with the file name and parsed table after a successful import (feeds the LUT library). */
  onImported?: (name: string, lutData: LUTData) => void;
  /** Names the slot in labels when more than one loader is on screen (e.g. "Input"). */
  slotName?: string;
}

const IntensitySlider: React.FC<{
  value: number;
  onChange: (value: number) => void;
}> = ({ value, onChange }) => {
  const percentage = Math.round(value * 100);

  return (
    <PropertySlider
      label="Intensity"
      min={0}
      max={100}
      step={1}
      value={percentage}
      onChange={(nextValue: number) => onChange(nextValue / 100)}
      formatValue={(nextValue) => `${Math.round(nextValue)}%`}
    />
  );
};

/**
 * Parse a .3dl LUT file
 *
 * Parse 3D LUT data from .3dl files
 */
export function parse3dlLUT(content: string): LUTData {
  const lines = content.split("\n").map((line) => line.trim());
  const data: number[] = [];
  let size = 0;

  // First line should contain the mesh size
  for (const line of lines) {
    if (line === "" || line.startsWith("#")) continue;

    // Try to parse as mesh definition (first non-comment line)
    if (size === 0) {
      const meshValues = line.split(/\s+/).map(parseFloat);
      if (meshValues.length >= 1 && !isNaN(meshValues[0])) {
        // 3dl files typically have mesh points, calculate size
        // Common sizes: 17, 33, 65
        size = Math.round(Math.cbrt(meshValues.length / 3)) || 17;
        if (meshValues.length === 3) {
          // This is actually a data line, not mesh definition
          size = 17; // Default size
          data.push(
            Math.round((meshValues[0] / 4095) * 255),
            Math.round((meshValues[1] / 4095) * 255),
            Math.round((meshValues[2] / 4095) * 255),
          );
        }
        continue;
      }
    }

    // Parse RGB values (3dl uses 0-4095 range typically)
    const values = line.split(/\s+/).map(parseFloat);
    if (values.length === 3 && values.every((v) => !isNaN(v))) {
      // Detect range and normalize to 0-255
      const maxVal = Math.max(...values);
      const scale = maxVal > 255 ? 4095 : maxVal > 1 ? 255 : 1;
      data.push(
        Math.round((values[0] / scale) * 255),
        Math.round((values[1] / scale) * 255),
        Math.round((values[2] / scale) * 255),
      );
    }
  }

  // Determine size from data length
  if (size === 0 || size * size * size * 3 !== data.length) {
    const calculatedSize = Math.round(Math.cbrt(data.length / 3));
    if (calculatedSize * calculatedSize * calculatedSize * 3 === data.length) {
      size = calculatedSize;
    } else {
      throw new Error("Could not determine LUT size from data");
    }
  }

  if (data.length === 0) {
    throw new Error("No valid LUT data found in file");
  }

  return {
    data: new Uint8Array(data),
    size,
    intensity: 1,
  };
}

/**
 * LUTLoader Component
 *
 * - 6.1: Open file picker for .cube or .3dl LUT files
 * - 6.2: Parse 3D LUT data and apply to clip
 * - 6.3: Adjust LUT intensity with slider (0-100%)
 * - 6.4: Display error message for invalid files
 */
export const LUTLoader: React.FC<LUTLoaderProps> = ({
  lutData,
  onChange,
  onError,
  onImported,
  slotName,
}) => {
  const slotPrefix = slotName ? `${slotName} ` : "";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Handle file selection
   *
   * Open file picker for .cube or .3dl files
   */
  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setIsLoading(true);
      setError(null);

      try {
        const content = await file.text();
        const extension = file.name.toLowerCase().split(".").pop();

        let parsedLUT: LUTData;

        if (extension === "cube") {
          parsedLUT = parseCubeToLutData(content);
        } else if (extension === "3dl") {
          parsedLUT = parse3dlLUT(content);
        } else {
          throw new Error(
            "Unsupported file format. Please use .cube or .3dl files.",
          );
        }

        setFileName(file.name);
        onChange(parsedLUT);
        onImported?.(file.name.replace(/\.[^.]+$/, ""), parsedLUT);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to parse LUT file";
        setError(errorMessage);
        onError?.(errorMessage);
      } finally {
        setIsLoading(false);
        // Reset input so same file can be selected again
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [onChange, onError, onImported],
  );

  /**
   * Handle intensity change
   *
   * Blend between original and LUT-graded image
   */
  const handleIntensityChange = useCallback(
    (intensity: number) => {
      if (lutData) {
        onChange({
          ...lutData,
          intensity,
        });
      }
    },
    [lutData, onChange],
  );

  /** The space the table was authored for; only HDR (Rec.2020) projects read it. */
  const handleSpaceChange = useCallback(
    (space: NonNullable<LUTData["space"]>) => {
      if (lutData) onChange({ ...lutData, space });
    },
    [lutData, onChange],
  );

  /**
   * Remove loaded LUT
   */
  const handleRemoveLUT = useCallback(() => {
    onChange(null);
    setFileName(null);
    setError(null);
  }, [onChange]);

  /**
   * Trigger file picker
   */
  const handleLoadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="space-y-3">
      {/* Hidden file input */}
      <ShadcnInput
        ref={fileInputRef}
        type="file"
        accept={".cube,.3dl"}
        className="hidden"
        aria-label={`Load ${slotPrefix}LUT file`}
        onChange={(event) => {
          void handleFileSelect(event);
          event.currentTarget.value = "";
        }}
      />

      {/* Load button or loaded LUT info */}
      {!lutData ? (
        <Button onClick={handleLoadClick} type="button" aria-label={isLoading ? "Loading..." : `Load ${slotPrefix}LUT (.cube, .3dl)`} disabled={(isLoading)} className="min-w-0 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none h-7 px-2.5 hover:bg-bg-3 w-full py-2 bg-bg-2 border border-border rounded-lg text-[10px] text-fg-2 hover:text-fg hover:border-text-secondary transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isLoading ? (
              <div className="w-3 h-3 border border-text-muted border-t-transparent rounded-full animate-spin" />
            ) : (
              <Upload size={12} />
            )}</span>
          <span className="truncate">{isLoading ? "Loading..." : `Load ${slotPrefix}LUT (.cube, .3dl)`}</span>
        </Button>
      ) : (
        <div className="space-y-2">
          {/* Loaded LUT info */}
          <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-2 flex items-center justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-fg font-normal block truncate text-[10px]">
                {fileName || "LUT Loaded"}
              </span>
              <span className="text-fg-2 font-normal text-[9px]">
                {lutData.size}x{lutData.size}x{lutData.size} LUT
              </span>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={handleRemoveLUT} type="button" aria-label={`Remove ${slotPrefix}LUT`} title={`Remove ${slotPrefix}LUT`} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent hover:bg-bg-2 p-1 text-fg-3 hover:text-fg transition-colors">
              {<X size={14} />}
            </Button>
          </Card>

          {/* Intensity slider */}
          <IntensitySlider
            value={lutData.intensity}
            onChange={handleIntensityChange}
          />

          <label className="block space-y-1">
            <span className="text-[10px] text-fg-2">LUT colour space (HDR projects)</span>
            <select
              aria-label={`${slotPrefix}LUT colour space`}
              value={lutData.space ?? "srgb"}
              onChange={(event) => handleSpaceChange(event.target.value as NonNullable<LUTData["space"]>)}
              className="h-7 w-full rounded-[6px] border border-border bg-bg-1 px-1.5 text-[11px] text-fg"
            >
              <option value="srgb">Display (sRGB / Rec.709)</option>
              <option value="linear">Scene linear (1.0 = SDR white)</option>
              <option value="pq">PQ (ST 2084)</option>
            </select>
            <span className="block text-[9px] leading-snug text-fg-3">
              In a Rec.2020 / HDR project the LUT sees the picture in this space. Light above its range passes through instead of clipping.
            </span>
          </label>

          {/* Load different LUT button */}
          <Button onClick={handleLoadClick} type="button" aria-label={`Load Different ${slotPrefix}LUT`} disabled={(isLoading)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 bg-transparent hover:bg-bg-2 w-full py-1.5 text-[10px] text-fg-3 hover:text-fg-2 transition-colors">
            <span className="truncate">{"Load Different LUT"}</span>
          </Button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 flex items-start gap-2 border border-red-500/20 bg-red-500/10">
          <AlertCircle
            size={14}
            className="text-red-500 flex-shrink-0 mt-0.5"
          />
          <span className="font-normal text-[10px] text-red-400">
            {error}
          </span>
        </Card>
      )}
    </div>
  );
};

