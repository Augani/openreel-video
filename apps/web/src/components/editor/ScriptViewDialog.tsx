import { useState, useCallback, useMemo, useRef } from "react";
import {
  Copy,
  Download,
  FileCode,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json";
import { vs2015 } from "react-syntax-highlighter/dist/esm/styles/hljs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
} from "@openreel/ui";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { createProjectSerializer, createStorageEngine } from "@openreel/core";
import type { ValidationResult } from "@openreel/core/storage/schema-types";

SyntaxHighlighter.registerLanguage("json", json);

interface ScriptViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ScriptViewDialog: React.FC<ScriptViewDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const { project } = useProjectStore();
  const [activeTab, setActiveTab] = useState<"export" | "import">("export");
  const [importJson, setImportJson] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const storage = useMemo(() => createStorageEngine(), []);
  const serializer = useMemo(() => createProjectSerializer(storage), [storage]);

  const exportedJson = useMemo(() => {
    if (!project) return "";
    return serializer.exportToJsonWithMetadata(
      project,
      `Exported from ${project.name}`,
    );
  }, [project, serializer]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportedJson);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }, [exportedJson]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([exportedJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = project?.modifiedAt ?? Date.now();
    const d = new Date(ts);
    const dateSuffix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}`;
    a.download = `${project?.name || "project"}_${dateSuffix}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [exportedJson, project?.name, project?.modifiedAt]);

  const processImportJson = useCallback(
    (jsonString: string) => {
      setImportJson(jsonString);
      setValidation(null);
      // Auto-validate
      try {
        const result = serializer.validateProjectJson(jsonString);
        setValidation(result);
      } catch (error) {
        setValidation({
          valid: false,
          errors: [
            `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
          ],
          warnings: [],
        });
      }
    },
    [serializer],
  );

  const handleFileUpload = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result;
        if (typeof content === "string") {
          processImportJson(content);
        }
      };
      reader.readAsText(file);
    },
    [processImportJson],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
      // Reset so same file can be selected again
      e.target.value = "";
    },
    [handleFileUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type === "application/json") {
        handleFileUpload(file);
      } else if (file) {
        setValidation({
          valid: false,
          errors: [t("editor:scriptView.states.invalidFileType")],
          warnings: [],
        });
      }
    },
    [handleFileUpload, t],
  );

  const handleValidate = useCallback(() => {
    setIsValidating(true);
    try {
      const result = serializer.validateProjectJson(importJson);
      setValidation(result);
    } catch (error) {
      setValidation({
        valid: false,
        errors: [
          `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ],
        warnings: [],
      });
    } finally {
      setIsValidating(false);
    }
  }, [importJson, serializer]);

  const handleImport = useCallback(() => {
    if (!validation?.valid) return;

    try {
      const { project: importedProject } =
        serializer.importFromJsonWithValidation(importJson);
      if (importedProject) {
        useProjectStore.getState().loadProject(importedProject);
        onClose();
        const missingCount = importedProject.mediaLibrary.items.filter(
          (item) => item.isPlaceholder,
        ).length;
        if (missingCount > 0) {
          toast.warning(
            `${missingCount} asset${missingCount !== 1 ? "s" : ""} need relinking`,
            "Go to Assets panel → click \"Relink from Folder\" to restore missing media.",
          );
        }
      }
    } catch (error) {
      setValidation({
        valid: false,
        errors: [
          `Import error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ],
        warnings: [],
      });
    }
  }, [importJson, validation, serializer, onClose]);

  if (!isOpen) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 gap-0 bg-background-secondary border-border overflow-hidden flex flex-col" style={{ height: "70vh" }}>
        <DialogHeader className="p-4 border-b border-border space-y-0">
          <div className="flex items-center gap-3">
            <FileCode size={20} className="text-primary" />
            <div>
              <DialogTitle className="text-lg font-semibold text-text-primary">
                {t("editor:scriptView.title")}
              </DialogTitle>
              <DialogDescription className="text-xs text-text-muted">
                {t("editor:scriptView.description")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Tab buttons */}
        <div className="flex gap-1 p-2 border-b border-border">
          <button
            onClick={() => setActiveTab("export")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "export"
                ? "bg-background-tertiary text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
            }`}
          >
            {t("editor:scriptView.tabs.export")}
          </button>
          <button
            onClick={() => setActiveTab("import")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "import"
                ? "bg-background-tertiary text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
            }`}
          >
            {t("editor:scriptView.tabs.import")}
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab === "export" && (
            <>
              {exportedJson ? (
                <>
                  <div className="flex gap-2 p-3 border-b border-border">
                    <Button variant="outline" size="sm" onClick={handleCopy}>
                      {copySuccess ? (
                        <>
                          <CheckCircle2 size={16} className="text-primary" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy size={16} />
                          {t("common:buttons.copy")}
                        </>
                      )}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDownload}>
                      <Download size={16} />
                      {t("editor:scriptView.actions.download")}
                    </Button>
                  </div>

                  <div className="flex-1 overflow-auto custom-scrollbar p-4">
                    <div className="rounded-lg overflow-hidden border border-border">
                      <SyntaxHighlighter
                        language="json"
                        style={vs2015}
                        showLineNumbers
                        customStyle={{
                          margin: 0,
                          padding: "1rem",
                          background: "#1e1e1e",
                          fontSize: "12px",
                        }}
                      >
                        {exportedJson}
                      </SyntaxHighlighter>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <FileCode size={40} className="text-text-muted" />
                  <p className="text-sm text-text-secondary">
                    {t("editor:scriptView.states.noProjectData")}
                  </p>
                </div>
              )}
            </>
          )}

          {activeTab === "import" && (
            <div className="flex-1 flex flex-col gap-4 p-4 overflow-auto">
              {/* File upload drop zone */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileInputChange}
                className="hidden"
              />
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-text-muted hover:bg-background-tertiary"
                }`}
              >
                <Upload
                  size={32}
                  className={
                    isDragging ? "text-primary" : "text-text-muted"
                  }
                />
                <div className="text-center">
                  <p className="text-sm text-text-primary font-medium">
                    {isDragging
                      ? t("editor:scriptView.states.dropHere")
                      : t("editor:scriptView.states.dropHereOrClick")}
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    {t("editor:scriptView.states.acceptsProjectFiles")}
                  </p>
                </div>
              </div>

              {/* Show loaded file info */}
              {importJson && (
                <div className="flex items-center gap-2 p-3 bg-background-tertiary border border-border rounded-lg">
                  <FileCode size={16} className="text-text-secondary" />
                  <span className="text-sm text-text-primary flex-1">
                    {t("editor:scriptView.states.charactersLoaded", { count: importJson.length.toLocaleString() })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setImportJson("");
                      setValidation(null);
                    }}
                  >
                    {t("common:buttons.clear")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleValidate}
                    disabled={isValidating}
                  >
                    {isValidating ? t("editor:scriptView.states.validating") : t("editor:scriptView.actions.revalidate")}
                  </Button>
                </div>
              )}

              {/* Validation results */}
              {validation && (
                <div className="space-y-2">
                  {validation.valid && (
                    <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                      <CheckCircle2 size={16} className="text-primary" />
                      <span className="text-sm text-primary">
                        {t("editor:scriptView.states.validProject")}
                      </span>
                    </div>
                  )}

                  {validation.errors.length > 0 && (
                    <div className="p-3 bg-error/10 border border-error/30 rounded-lg space-y-1">
                      <div className="flex items-center gap-2 text-error font-medium text-sm">
                        <AlertCircle size={16} />
                        {t("common:messages.errors")}
                      </div>
                      <ul className="list-disc list-inside text-xs text-error/80 space-y-0.5">
                        {validation.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {validation.warnings.length > 0 && (
                    <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg space-y-1">
                      <div className="flex items-center gap-2 text-warning font-medium text-sm">
                        <AlertTriangle size={16} />
                        {t("common:messages.warnings")}
                      </div>
                      <ul className="list-disc list-inside text-xs text-warning/80 space-y-0.5">
                        {validation.warnings.map((warning, i) => (
                          <li key={i}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {validation.missingAssets &&
                    validation.missingAssets.length > 0 && (
                      <div className="p-3 bg-background-tertiary border border-border rounded-lg space-y-1">
                        <div className="text-sm font-medium text-text-secondary">
                          {t("editor:scriptView.states.missingAssets")} ({validation.missingAssets.length})
                        </div>
                        <p className="text-xs text-text-muted">
                          {t("editor:scriptView.states.missingAssetsHelp")}
                        </p>
                      </div>
                    )}
                </div>
              )}

              {/* Import button */}
              {importJson && (
                <Button onClick={handleImport} disabled={!validation?.valid}>
                  <Upload size={16} />
                  {t("editor:scriptView.actions.importProject")}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
