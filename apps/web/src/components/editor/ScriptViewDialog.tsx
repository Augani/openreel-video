import { useState, useCallback, useMemo } from "react";
import {
  Copy,
  Download,
  FileCode,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from "@/icons/lucide-compat";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json";
import { vs2015 } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent } from "@openreel/ui";
import { ToolcraftFileDropControl as FileInput } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
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
  const { project } = useProjectStore();
  const [activeTab, setActiveTab] = useState<"export" | "import">("export");
  const [importJson, setImportJson] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const storage = useMemo(() => createStorageEngine(), []);
  const serializer = useMemo(() => createProjectSerializer(storage), [storage]);
  const fullProject = useMemo(
    () => useProjectStore.getState().getFullProject(),
    [project],
  );

  const exportedJson = useMemo(() => {
    if (!fullProject) return "";
    return serializer.exportToJsonWithMetadata(
      fullProject,
      `Exported from ${fullProject.name}`,
    );
  }, [fullProject, serializer]);

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
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} width={896} purpose="form">
      <Layout
        header={
          <DialogHeader
            title="Project JSON"
            subtitle="Export or import project as JSON"
            onOpenChange={(open) => !open && onClose()}
            startContent={<FileCode size={20} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="flex h-[70vh] flex-col overflow-hidden p-0">
        <div className="border-b border-border p-2">
          <ToolcraftSegmentedControl<"export" | "import">
            ariaLabel="Project JSON mode"
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { value: "export", label: "Export JSON" },
              { value: "import", label: "Import" },
            ]}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab === "export" && (
            <>
              {exportedJson ? (
                <>
                  <div className="flex gap-2 p-3 border-b border-border">
                    <Button
                      label={copySuccess ? "Copied!" : "Copy"}
                      variant="secondary"
                      size="sm"
                      icon={
                        copySuccess ? (
                          <CheckCircle2 size={16} className="text-primary" aria-hidden />
                        ) : (
                          <Copy size={16} aria-hidden />
                        )
                      }
                      onClick={handleCopy}
                    />
                    <Button
                      label="Download JSON"
                      variant="secondary"
                      size="sm"
                      icon={<Download size={16} aria-hidden />}
                      onClick={handleDownload}
                    />
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
                  <Text type="body" color="secondary">
                    No project data to export.
                  </Text>
                </div>
              )}
            </>
          )}

          {activeTab === "import" && (
            <div className="flex-1 flex flex-col gap-4 p-4 overflow-auto">
              <FileInput
                label="Project JSON file"
                isLabelHidden
                value={null}
                onChange={(picked) => {
                  if (picked instanceof File) {
                    if (picked.type === "application/json" || picked.name.endsWith(".json")) {
                      handleFileUpload(picked);
                    } else {
                      setValidation({
                        valid: false,
                        errors: ["Please upload a .json file"],
                        warnings: [],
                      });
                    }
                  }
                }}
                accept=".json,application/json"
                mode="dropzone"
                placeholder="Drop a JSON file here or click to browse"
                description="Accepts .json project files"
                width="100%"
              />

              {/* Show loaded file info */}
              {importJson && (
                <Card variant="muted" padding={3}>
                <div className="flex items-center gap-2">
                  <FileCode size={16} className="text-text-secondary" />
                  <Text type="body" className="flex-1 text-sm">
                    {importJson.length.toLocaleString()} characters loaded
                  </Text>
                  <Button
                    label="Clear"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setImportJson("");
                      setValidation(null);
                    }}
                  />
                  <Button
                    label={isValidating ? "Validating..." : "Re-validate"}
                    variant="secondary"
                    size="sm"
                    onClick={handleValidate}
                    isDisabled={isValidating}
                  />
                </div>
                </Card>
              )}

              {/* Validation results */}
              {validation && (
                <div className="space-y-2">
                  {validation.valid && (
                    <Card variant="green" padding={3} className="flex items-center gap-2 border border-primary/30">
                      <CheckCircle2 size={16} className="text-primary" />
                      <Text type="body" className="text-primary">
                        Valid project JSON — ready to import
                      </Text>
                    </Card>
                  )}

                  {validation.errors.length > 0 && (
                    <Card variant="muted" padding={3} className="space-y-1 border border-error/30 bg-error/10">
                      <div className="flex items-center gap-2 text-error font-medium text-sm">
                        <AlertCircle size={16} />
                        Errors
                      </div>
                      <ul className="list-disc list-inside text-xs text-error/80 space-y-0.5">
                        {validation.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </Card>
                  )}

                  {validation.warnings.length > 0 && (
                    <Card variant="muted" padding={3} className="space-y-1 border border-warning/30 bg-warning/10">
                      <div className="flex items-center gap-2 text-warning font-medium text-sm">
                        <AlertTriangle size={16} />
                        Warnings
                      </div>
                      <ul className="list-disc list-inside text-xs text-warning/80 space-y-0.5">
                        {validation.warnings.map((warning, i) => (
                          <li key={i}>{warning}</li>
                        ))}
                      </ul>
                    </Card>
                  )}

                  {validation.missingAssets &&
                    validation.missingAssets.length > 0 && (
                      <Card variant="muted" padding={3} className="space-y-1 border border-border">
                        <Text type="body" color="secondary" weight="bold" display="block" className="text-sm">
                          Missing Assets ({validation.missingAssets.length})
                        </Text>
                        <Text type="supporting" color="secondary" display="block">
                          These assets will be imported as placeholders and can
                          be replaced later.
                        </Text>
                      </Card>
                    )}
                </div>
              )}

              {/* Import button */}
              {importJson && (
                <Button
                  label="Import Project"
                  icon={<Upload size={16} aria-hidden />}
                  variant="primary"
                  onClick={handleImport}
                  isDisabled={!validation?.valid}
                />
              )}
            </div>
          )}
        </div>
          </LayoutContent>
        }
      />
    </Dialog>
  );
};
