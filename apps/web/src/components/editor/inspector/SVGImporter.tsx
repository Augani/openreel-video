import React, { useCallback, useState, useRef } from "react";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftFileDropControl as FileInput } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Upload, FileImage, AlertCircle, Check, X } from "@/icons/lucide-compat";
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
      <FileInput
        ref={fileInputRef}
        label="Import SVG file"
        isLabelHidden
        value={null}
        accept=".svg"
        onChange={(files) => {
          const file = Array.isArray(files) ? files[0] : files;
          if (!file) return;
          handleFileSelect({
            target: { files: [file] },
          } as unknown as React.ChangeEvent<HTMLInputElement>);
        }}
        className="hidden"
      />

      {/* Drop zone / Import button */}
      <Card
        variant="muted"
        padding={4}
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
       ? "border-green-500 bg-green-500/10"
       : "border-border hover:border-primary hover:bg-primary/5"
 }
 `}
      >
        <div className="flex flex-col items-center gap-2">
          {/* Status icon */}
          {status === "loading" ? (
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : status === "success" ? (
            <Check size={24} className="text-green-500" />
          ) : status === "error" ? (
            <AlertCircle size={24} className="text-red-500" />
          ) : (
            <Upload size={24} className="text-fg-3" />
          )}

          {/* Status text */}
          <div className="text-center">
            {status === "loading" ? (
              <Text type="supporting" color="secondary" className="text-[10px]">
                Importing...
              </Text>
            ) : status === "success" ? (
              <Text type="supporting" className="text-[10px] text-green-500">
                SVG imported successfully
              </Text>
            ) : status === "error" ? (
              <Text type="supporting" className="text-[10px] text-red-500">
                {errorMessage}
              </Text>
            ) : (
              <div className="flex flex-col gap-0.5">
                <Text type="supporting" color="primary" className="block text-[10px] font-medium">
                  Import SVG
                </Text>
                <Text type="supporting" color="secondary" className="block text-[9px]">
                  Click or drag & drop
                </Text>
              </div>
            )}
          </div>

          {/* File name */}
          {fileName && status !== "idle" && (
            <div className="flex items-center gap-1 px-2 py-1 bg-bg-2 rounded">
              <FileImage size={12} className="text-fg-3" />
              <Text type="supporting" color="secondary" className="truncate max-w-[150px] text-[9px]">
                {fileName}
              </Text>
            </div>
          )}
        </div>

        {/* Clear error button */}
        {status === "error" && (
          <IconButton
            label="Clear SVG import error"
            icon={<X size={14} className="text-fg-3" />}
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              clearError();
            }}
            className="absolute top-2 right-2 p-1 rounded hover:bg-bg-2"
          />
        )}
      </Card>

      {/* Supported formats info */}
      <Text type="supporting" color="secondary" className="flex items-center gap-2 text-[9px]">
        <FileImage size={12} />
        Supported format: SVG (.svg)
      </Text>
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
