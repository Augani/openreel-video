import React, { useCallback, useRef, useState } from "react";
import { Upload, X, AlertCircle } from "lucide-react";
import { Slider } from "@openreel/ui";
import type { LUTData } from "@openreel/core";

interface LUTLoaderProps {
  lutData: LUTData | null;
  onChange: (lutData: LUTData | null) => void;
  onError?: (error: string) => void;
}

const IntensitySlider: React.FC<{
  value: number;
  onChange: (value: number) => void;
}> = ({ value, onChange }) => {
  const percentage = Math.round(value * 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-secondary">Intensity</span>
        <span className="text-[10px] font-mono text-text-primary">
          {percentage}%
        </span>
      </div>
      <Slider
        min={0}
        max={100}
        step={1}
        value={[percentage]}
        onValueChange={(v) => onChange(v[0] / 100)}
      />
    </div>
  );
};

/**
 * Parse a .cube LUT file
 *
 * Parse 3D LUT data from .cube files
 */
function parseCubeLUT(content: string): LUTData {
  const lines = content.split("\n").map((line) => line.trim());
  let size = 0;
  const data: number[] = [];

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith("#") || line === "") continue;

    // Parse LUT size
    if (line.startsWith("LUT_3D_SIZE")) {
      const parts = line.split(/\s+/);
      size = parseInt(parts[1], 10);
      if (isNaN(size) || size < 2 || size > 256) {
        throw new Error(`Invalid LUT size: ${parts[1]}`);
      }
      continue;
    }

    // Skip other metadata
    if (line.startsWith("TITLE") || line.startsWith("DOMAIN_")) continue;

    // Parse RGB values
    const values = line.split(/\s+/).map(parseFloat);
    if (values.length === 3 && values.every((v) => !isNaN(v))) {
      // Convert from 0-1 to 0-255
      data.push(
        Math.round(Math.max(0, Math.min(1, values[0])) * 255),
        Math.round(Math.max(0, Math.min(1, values[1])) * 255),
        Math.round(Math.max(0, Math.min(1, values[2])) * 255),
      );
    }
  }

  if (size === 0) {
    throw new Error("LUT size not specified in file");
  }

  const expectedLength = size * size * size * 3;
  if (data.length !== expectedLength) {
    throw new Error(
      `Invalid LUT data: expected ${expectedLength} values, got ${data.length}`,
    );
  }

  return {
    data: new Uint8Array(data),
    size,
    intensity: 1,
  };
}

/**
 * Parse a .3dl LUT file
 *
 * Parse 3D LUT data from .3dl files
 */
function parse3dlLUT(content: string): LUTData {
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
}) => {
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
          parsedLUT = parseCubeLUT(content);
        } else if (extension === "3dl") {
          parsedLUT = parse3dlLUT(content);
        } else {
          throw new Error(
            "Unsupported file format. Please use .cube or .3dl files.",
          );
        }

        setFileName(file.name);
        onChange(parsedLUT);
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
    [onChange, onError],
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
      <input
        ref={fileInputRef}
        type="file"
        accept=".cube,.3dl"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Load button or loaded LUT info */}
      {!lutData ? (
        <button
          onClick={handleLoadClick}
          disabled={isLoading}
          className="w-full py-2 bg-background-tertiary border border-border rounded-lg text-[10px] text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <div className="w-3 h-3 border border-text-muted border-t-transparent rounded-full animate-spin" />
              Loading...
            </>
          ) : (
            <>
              <Upload size={12} />
              Load LUT (.cube, .3dl)
            </>
          )}
        </button>
      ) : (
        <div className="space-y-2">
          {/* Loaded LUT info */}
          <div className="flex items-center justify-between p-2 bg-background-tertiary rounded-lg">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-text-primary truncate">
                {fileName || "LUT Loaded"}
              </p>
              <p className="text-[9px] text-text-muted">
                {lutData.size}x{lutData.size}x{lutData.size} LUT
              </p>
            </div>
            <button
              onClick={handleRemoveLUT}
              className="p-1 text-text-muted hover:text-text-primary transition-colors"
              title="Remove LUT"
            >
              <X size={14} />
            </button>
          </div>

          {/* Intensity slider */}
          <IntensitySlider
            value={lutData.intensity}
            onChange={handleIntensityChange}
          />

          {/* Load different LUT button */}
          <button
            onClick={handleLoadClick}
            disabled={isLoading}
            className="w-full py-1.5 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
          >
            Load Different LUT
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle
            size={14}
            className="text-red-500 flex-shrink-0 mt-0.5"
          />
          <p className="text-[10px] text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
};

export default LUTLoader;
