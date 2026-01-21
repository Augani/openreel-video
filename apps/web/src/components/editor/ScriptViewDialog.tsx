import { useState, useCallback, useMemo } from "react";
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
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
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
  const [importJson, setImportJson] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

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
    a.download = `${project?.name || "project"}-script.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [exportedJson, project?.name]);

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
      <DialogContent className="max-w-6xl max-h-[90vh] p-0 gap-0 bg-background-secondary border-border overflow-hidden flex flex-col">
        <DialogHeader className="p-4 border-b border-border space-y-0">
          <div className="flex items-center gap-3">
            <FileCode size={20} className="text-primary" />
            <div>
              <DialogTitle className="text-lg font-semibold text-text-primary">
                Script View
              </DialogTitle>
              <DialogDescription className="text-xs text-text-muted">
                View and import project JSON
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="view" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="flex gap-1 p-2 border-b border-border bg-transparent rounded-none justify-start">
            <TabsTrigger
              value="view"
              className="px-4 py-2 rounded-lg text-sm font-medium data-[state=active]:bg-background-tertiary data-[state=active]:text-text-primary text-text-secondary hover:text-text-primary hover:bg-background-elevated"
            >
              View & Export
            </TabsTrigger>
            <TabsTrigger
              value="import"
              className="px-4 py-2 rounded-lg text-sm font-medium data-[state=active]:bg-background-tertiary data-[state=active]:text-text-primary text-text-secondary hover:text-text-primary hover:bg-background-elevated"
            >
              Import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="view" className="flex-1 flex flex-col overflow-hidden mt-0">
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
                    Copy
                  </>
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download size={16} />
                Download
              </Button>
              <div className="flex-1" />
              <a
                href="/llm.txt"
                download="openreel-llm-documentation.txt"
                className="flex items-center gap-2 px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-sm transition-colors"
              >
                <FileCode size={16} />
                Download LLM.txt
              </a>
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
          </TabsContent>

          <TabsContent value="import" className="flex-1 flex flex-col gap-4 p-4 overflow-auto mt-0">
            <div className="flex-1 flex flex-col gap-2">
              <label className="text-sm font-medium text-text-secondary">
                Paste JSON
              </label>
              <textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder="Paste project JSON here..."
                className="flex-1 p-3 bg-background-tertiary border border-border rounded-lg text-text-primary font-mono text-xs resize-none focus:outline-none focus:border-primary"
              />
            </div>

            <Button
              variant="outline"
              onClick={handleValidate}
              disabled={!importJson || isValidating}
            >
              {isValidating ? "Validating..." : "Validate"}
            </Button>

            {validation && (
              <div className="space-y-2">
                {validation.valid && (
                  <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                    <CheckCircle2 size={16} className="text-primary" />
                    <span className="text-sm text-primary">
                      Valid JSON - Ready to import
                    </span>
                  </div>
                )}

                {validation.errors.length > 0 && (
                  <div className="p-3 bg-error/10 border border-error/30 rounded-lg space-y-1">
                    <div className="flex items-center gap-2 text-error font-medium text-sm">
                      <AlertCircle size={16} />
                      Errors
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
                      Warnings
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
                        Missing Assets ({validation.missingAssets.length})
                      </div>
                      <p className="text-xs text-text-muted">
                        These assets will be imported as placeholders and can
                        be replaced later.
                      </p>
                    </div>
                  )}
              </div>
            )}

            <Button onClick={handleImport} disabled={!validation?.valid}>
              <Upload size={16} />
              Import Project
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
