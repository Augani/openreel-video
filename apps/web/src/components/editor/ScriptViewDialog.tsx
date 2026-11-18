import {
  Label as RadioLabel,
  Dialog as ShadcnDialog,
  DialogContent as ShadcnDialogContent,
  DialogHeader as ShadcnDialogHeader,
  DialogTitle as ShadcnDialogTitle,
  DialogDescription as ShadcnDialogDescription,
  DialogClose as ShadcnDialogClose,
  RadioGroup as ShadcnRadioGroup,
  RadioGroupItem as ShadcnRadioGroupItem,
  Input as ShadcnInput,
  cn as uiCn,
  Button,
  Card,
} from "@openreel/ui";

import {
  X as DialogCloseIcon,
  UploadCloud as FileUploadIcon,
  Copy,
  Download,
  FileCode,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from "@/icons/lucide-compat";

import {
  useRef as useImportInputRef,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";

import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json";
import { vs2015 } from "react-syntax-highlighter/dist/esm/styles/hljs";

import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { createProjectSerializer, createStorageEngine } from "@openreel/core";
import type { ValidationResult } from "@openreel/core/storage/schema-types";
import { saveCurrentProjectForReplacement } from "../../services/project-replacement";

SyntaxHighlighter.registerLanguage("json", json);

interface ScriptViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ScriptViewDialog: React.FC<ScriptViewDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const shadcnFileInput0 = useImportInputRef<HTMLInputElement>(null);

  const project = useProjectStore((state) => (isOpen ? state.project : null));
  const [activeTab, setActiveTab] = useState<"export" | "import">("export");
  const [importJson, setImportJson] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importing = useRef(false);
  const importRequest = useRef(0);
  const activeReader = useRef<FileReader | null>(null);
  const cancelImport = useCallback(() => {
    importRequest.current++;
    activeReader.current?.abort();
    activeReader.current = null;
  }, []);
  useEffect(() => {
    if (!isOpen) cancelImport();
    return cancelImport;
  }, [isOpen, cancelImport]);

  const storage = useMemo(() => createStorageEngine(), []);
  const serializer = useMemo(() => createProjectSerializer(storage), [storage]);
  const fullProject = useMemo(
    () => (project ? useProjectStore.getState().getFullProject() : null),
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
      importRequest.current++;
      activeReader.current?.abort();
      activeReader.current = null;
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
      const request = ++importRequest.current;
      activeReader.current?.abort();
      setValidation(null);
      setImportJson("");
      const reader = new FileReader();
      activeReader.current = reader;
      reader.onload = (e) => {
        if (
          request !== importRequest.current ||
          activeReader.current !== reader
        )
          return;
        activeReader.current = null;
        const content = e.target?.result;
        if (typeof content === "string") {
          processImportJson(content);
        }
      };
      reader.onerror = () => {
        if (
          request !== importRequest.current ||
          activeReader.current !== reader
        )
          return;
        activeReader.current = null;
        setValidation({
          valid: false,
          errors: ["Could not read this JSON file"],
          warnings: [],
        });
      };
      reader.readAsText(file);
    },
    [processImportJson],
  );

  const handleProjectFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      if (file.type === "application/json" || file.name.endsWith(".json")) {
        handleFileUpload(file);
      } else {
        cancelImport();
        setValidation({
          valid: false,
          errors: ["Please upload a .json file"],
          warnings: [],
        });
      }
    },
    [cancelImport, handleFileUpload],
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

  const handleImport = useCallback(async () => {
    if (!validation?.valid || importing.current) return;
    const projectId = useProjectStore.getState().project.id;
    const request = ++importRequest.current;
    importing.current = true;
    setIsImporting(true);

    try {
      const { project: importedProject } =
        serializer.importFromJsonWithValidation(importJson);
      if (importedProject) {
        await saveCurrentProjectForReplacement(projectId);
        if (request !== importRequest.current) return;
        useProjectStore.getState().loadProject(importedProject);
        onClose();
        const missingCount = importedProject.mediaLibrary.items.filter(
          (item) => item.isPlaceholder,
        ).length;
        if (missingCount > 0) {
          toast.warning(
            `${missingCount} asset${missingCount !== 1 ? "s" : ""} need relinking`,
            'Go to Assets panel → click "Relink from Folder" to restore missing media.',
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
    } finally {
      importing.current = false;
      setIsImporting(false);
    }
  }, [importJson, validation, serializer, onClose]);

  if (!isOpen) return null;

  return (
    <ShadcnDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <ShadcnDialogContent
        hideCloseButton
        className="!p-0 gap-0 overflow-hidden border-border bg-bg-1 text-fg shadow-xl"
        style={{ maxWidth: 896, width: "calc(100vw - 32px)" }}
      >
        <div className="flex max-h-[90vh] min-h-0 flex-col">
          {
            <ShadcnDialogHeader className="flex-row items-start gap-3 space-y-0 border-b border-border bg-bg-1 px-5 py-4">
              <span className="mt-0.5 flex shrink-0 items-center justify-center">
                {<FileCode size={20} className="text-primary" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <ShadcnDialogTitle className="truncate text-[15px] font-semibold leading-5 text-fg">
                  {"Project JSON"}
                </ShadcnDialogTitle>
                <ShadcnDialogDescription className="mt-1 text-[12px] leading-4 text-fg-muted">
                  {"Export or import project as JSON"}
                </ShadcnDialogDescription>
              </div>
              <ShadcnDialogClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label="Close dialog"
                  className="size-7 shrink-0 rounded-[7px] p-0 text-fg-muted hover:bg-bg-2 hover:text-fg"
                >
                  <DialogCloseIcon size={15} aria-hidden />
                </Button>
              </ShadcnDialogClose>
            </ShadcnDialogHeader>
          }
          {
            <div
              className={uiCn(
                "min-h-0 flex-1 overflow-auto p-4",
                false,
                "flex h-[70vh] flex-col overflow-hidden p-0",
              )}
            >
              <div className="border-b border-border p-2">
                <ShadcnRadioGroup
                  aria-label={"Project JSON mode"}
                  value={activeTab}
                  onValueChange={(next) => {
                    if (next)
                      setActiveTab(next as Parameters<typeof setActiveTab>[0]);
                  }}
                  className="grid min-h-8 min-w-0 gap-0 rounded-[7px] border border-border bg-bg-1 p-0.5"
                  style={{
                    gridTemplateColumns: `repeat(${
                      [
                        { value: "export", label: "Export JSON" },
                        { value: "import", label: "Import" },
                      ].length
                    }, minmax(0,1fr))`,
                  }}
                >
                  {[
                    { value: "export", label: "Export JSON" },
                    { value: "import", label: "Import" },
                  ].map((option) => (
                    <RadioLabel
                      key={option.value}
                      className="flex h-7 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[5px] px-2 text-[12px] font-semibold text-fg-muted focus-within:ring-2 focus-within:ring-ring has-[[data-state=checked]]:bg-bg-3 has-[[data-state=checked]]:text-fg"
                    >
                      <ShadcnRadioGroupItem
                        data-value={option.value}
                        value={option.value}
                        aria-label={option.label ?? option.value}
                        className="sr-only"
                      />
                      {option.label}
                    </RadioLabel>
                  ))}
                </ShadcnRadioGroup>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {activeTab === "export" && (
                  <>
                    {exportedJson ? (
                      <>
                        <div className="flex gap-2 p-3 border-b border-border">
                          <Button
                            onClick={handleCopy}
                            type="button"
                            aria-label={
                              (copySuccess ? "Copied!" : "Copy").trim() ||
                              undefined
                            }
                            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"
                          >
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                              {copySuccess ? (
                                <CheckCircle2
                                  size={16}
                                  className="text-primary"
                                  aria-hidden
                                />
                              ) : (
                                <Copy size={16} aria-hidden />
                              )}
                            </span>
                            <span className="truncate">
                              {copySuccess ? "Copied!" : "Copy"}
                            </span>
                          </Button>
                          <Button
                            onClick={handleDownload}
                            type="button"
                            aria-label="Download JSON"
                            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"
                          >
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                              {<Download size={16} aria-hidden />}
                            </span>
                            <span className="truncate">{"Download JSON"}</span>
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
                        <span className="text-[13px] leading-5 text-fg-2 font-normal">
                          No project data to export.
                        </span>
                      </div>
                    )}
                  </>
                )}

                {activeTab === "import" && (
                  <div className="flex-1 flex flex-col gap-4 p-4 overflow-auto">
                    <div
                      className={uiCn("min-w-0", undefined)}
                      style={{ width: "100%" }}
                    >
                      <ShadcnInput
                        ref={shadcnFileInput0}
                        type="file"
                        accept={".json,application/json"}
                        className="hidden"
                        aria-hidden
                        tabIndex={-1}
                        disabled={false}
                        onChange={(event) => {
                          handleProjectFile(
                            event.currentTarget.files?.[0] ?? null,
                          );
                          event.currentTarget.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={"Project JSON file"}
                        disabled={false}
                        onClick={() => shadcnFileInput0.current?.click()}
                        className={uiCn(
                          "flex h-auto w-full min-w-0 cursor-pointer items-center justify-center gap-2 whitespace-normal rounded-[7px] border border-dashed border-border bg-bg-2 text-center text-[12px] font-semibold leading-[1.4] text-fg-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[drag-over=true]:border-accent data-[drag-over=true]:bg-selected data-[drag-over=true]:text-accent",
                          "min-h-16 flex-col px-3 py-3 [&_svg]:size-[17px]",
                          undefined,
                        )}
                        onDragEnter={(event) => {
                          event.preventDefault();
                          event.currentTarget.dataset.dragOver = "true";
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.currentTarget.dataset.dragOver = "true";
                        }}
                        onDragLeave={(event) => {
                          if (
                            !event.currentTarget.contains(
                              event.relatedTarget as Node | null,
                            )
                          )
                            delete event.currentTarget.dataset.dragOver;
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          delete event.currentTarget.dataset.dragOver;
                          handleProjectFile(
                            (event.dataTransfer?.files ?? null)?.[0] ?? null,
                          );
                        }}
                      >
                        <span className="flex shrink-0 items-center justify-center text-fg-muted">
                          {<FileUploadIcon aria-hidden size={17} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">
                            {"Drop a JSON file here or click to browse"}
                          </span>
                          <span className="mt-0.5 block text-[11px] font-medium leading-4 text-fg-muted">
                            {"Accepts .json project files"}
                          </span>
                        </span>
                      </Button>
                    </div>

                    {/* Show loaded file info */}
                    {importJson && (
                      <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3">
                        <div className="flex items-center gap-2">
                          <FileCode size={16} className="text-text-secondary" />
                          <span className="text-fg-2 font-normal flex-1 text-sm">
                            {importJson.length.toLocaleString()} characters
                            loaded
                          </span>
                          <Button
                            onClick={() => {
                              cancelImport();
                              setImportJson("");
                              setValidation(null);
                            }}
                            type="button"
                            aria-label="Clear"
                            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"
                          >
                            <span className="truncate">{"Clear"}</span>
                          </Button>
                          <Button
                            onClick={handleValidate}
                            type="button"
                            aria-label={
                              (isValidating
                                ? "Validating..."
                                : "Re-validate"
                              ).trim() || undefined
                            }
                            disabled={isValidating}
                            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"
                          >
                            <span className="truncate">
                              {isValidating ? "Validating..." : "Re-validate"}
                            </span>
                          </Button>
                        </div>
                      </Card>
                    )}

                    {/* Validation results */}
                    {validation && (
                      <div className="space-y-2">
                        {validation.valid && (
                          <Card className="min-w-0 rounded-[7px] shadow-none bg-status-success/10 text-fg p-3 flex items-center gap-2 border border-primary/30">
                            <CheckCircle2 size={16} className="text-primary" />
                            <span className="text-[13px] leading-5 font-normal text-primary">
                              Valid project JSON — ready to import
                            </span>
                          </Card>
                        )}

                        {validation.errors.length > 0 && (
                          <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-3 space-y-1 border border-error/30 bg-error/10">
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
                          <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-3 space-y-1 border border-warning/30 bg-warning/10">
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
                            <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-3 space-y-1 border border-border">
                              <span className="text-fg-2 font-bold block text-sm">
                                Missing Assets (
                                {validation.missingAssets.length})
                              </span>
                              <span className="text-[12px] leading-5 text-fg-2 font-normal block">
                                These assets will be imported as placeholders
                                and can be replaced later.
                              </span>
                            </Card>
                          )}
                      </div>
                    )}

                    {/* Import button */}
                    {importJson && (
                      <Button
                        onClick={handleImport}
                        type="button"
                        aria-label="Import Project"
                        disabled={
                          !validation?.valid || isImporting || isImporting
                        }
                        className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90"
                      >
                        {isImporting ? (
                          <span
                            aria-hidden
                            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80"
                          />
                        ) : (
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                            {<Upload size={16} aria-hidden />}
                          </span>
                        )}
                        <span className="truncate">{"Import Project"}</span>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          }
        </div>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
};
