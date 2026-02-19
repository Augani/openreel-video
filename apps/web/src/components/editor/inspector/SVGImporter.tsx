import React, { useCallback, useState, useRef } from "react";
import { Upload, FileImage, AlertCircle, Check, X } from "lucide-react";
import { getGraphicsBridge } from "../../../bridges";

interface SVGImporterProps {
  trackId: string;
  startTime: number;
  duration?: number;
  onImport?: (clipId: string) => void;
  onError?: (error: string) => void;
}

/**
 * Import status type
 */
type ImportStatus = "idle" | "loading" | "success" | "error";

/**
 * SVGImporter Component
 *
 * - 17.3: Import and render SVG content
 */
export const SVGImporter: React.FC<SVGImporterProps> = ({
  trackId,
  startTime,
  duration = 5,
  onImport,
  onError,
}) => {
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Handle file selection
   */
  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.name.toLowerCase().endsWith(".svg")) {
        setStatus("error");
        setErrorMessage("Please select an SVG file (.svg)");
        onError?.("Please select an SVG file (.svg)");
        return;
      }

      setFileName(file.name);
      setStatus("loading");
      setErrorMessage("");

      try {
        // Read file content
        const svgContent = await readFileAsText(file);

        // Get graphics bridge
        const bridge = getGraphicsBridge();
        if (!bridge.isInitialized()) {
          bridge.initialize();
        }

        // Validate SVG content
        const validation = bridge.validateSVG(svgContent);
        if (!validation.valid) {
          setStatus("error");
          setErrorMessage(validation.error || "Invalid SVG content");
          onError?.(validation.error || "Invalid SVG content");
          return;
        }

        // Import SVG
        const svgClip = bridge.importSVG({
          trackId,
          startTime,
          svgContent,
          duration,
        });

        if (!svgClip) {
          setStatus("error");
          setErrorMessage("Failed to import SVG");
          onError?.("Failed to import SVG");
          return;
        }

        setStatus("success");
        onImport?.(svgClip.id);

        // Reset status after a delay
        setTimeout(() => {
          setStatus("idle");
          setFileName("");
        }, 2000);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to read SVG file";
        setStatus("error");
        setErrorMessage(message);
        onError?.(message);
      }

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [trackId, startTime, duration, onImport, onError],
  );

  /**
   * Handle click on import button
   */
  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Handle drag over
   */
  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  /**
   * Handle drop
   */
  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const file = event.dataTransfer.files?.[0];
      if (!file) return;

      // Create a synthetic event to reuse handleFileSelect logic
      const syntheticEvent = {
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      handleFileSelect(syntheticEvent);
    },
    [handleFileSelect],
  );

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setStatus("idle");
    setErrorMessage("");
    setFileName("");
  }, []);

  return (
    <div className="space-y-3">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Drop zone / Import button */}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`
 relative p-4 border-2 border-dashed rounded-lg cursor-pointer
 transition-colors duration-200
 ${
   status === "error"
     ? "border-red-500 bg-red-500/10"
     : status === "success"
       ? "border-pink-500 bg-pink-500/10"
       : "border-border hover:border-primary hover:bg-primary/5"
 }
 `}
      >
        <div className="flex flex-col items-center gap-2">
          {/* Status icon */}
          {status === "loading" ? (
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : status === "success" ? (
            <Check size={24} className="text-pink-500" />
          ) : status === "error" ? (
            <AlertCircle size={24} className="text-red-500" />
          ) : (
            <Upload size={24} className="text-text-muted" />
          )}

          {/* Status text */}
          <div className="text-center">
            {status === "loading" ? (
              <p className="text-[10px] text-text-secondary">Importing...</p>
            ) : status === "success" ? (
              <p className="text-[10px] text-pink-500">
                SVG imported successfully
              </p>
            ) : status === "error" ? (
              <p className="text-[10px] text-red-500">{errorMessage}</p>
            ) : (
              <>
                <p className="text-[10px] text-text-primary font-medium">
                  Import SVG
                </p>
                <p className="text-[9px] text-text-muted">
                  Click or drag & drop
                </p>
              </>
            )}
          </div>

          {/* File name */}
          {fileName && status !== "idle" && (
            <div className="flex items-center gap-1 px-2 py-1 bg-background-tertiary rounded">
              <FileImage size={12} className="text-text-muted" />
              <span className="text-[9px] text-text-secondary truncate max-w-[150px]">
                {fileName}
              </span>
            </div>
          )}
        </div>

        {/* Clear error button */}
        {status === "error" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearError();
            }}
            className="absolute top-2 right-2 p-1 rounded hover:bg-background-tertiary"
          >
            <X size={14} className="text-text-muted" />
          </button>
        )}
      </div>

      {/* Supported formats info */}
      <div className="flex items-center gap-2 text-[9px] text-text-muted">
        <FileImage size={12} />
        <span>Supported format: SVG (.svg)</span>
      </div>
    </div>
  );
};

/**
 * Read file as text
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

export default SVGImporter;
