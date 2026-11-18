import { useRef, useState } from "react";
import { Button } from "@openreel/ui";
import {
  exportPresetsManager,
  isValidVideoExportSettings,
  type PlatformExportPreset,
} from "../../services/export-presets";

interface ExportPresetManagerProps {
  /** The settings currently in effect; saved when the user names a preset. */
  currentSettings: PlatformExportPreset["settings"];
  selectedPreset: PlatformExportPreset | null;
  onSelect: (preset: PlatformExportPreset) => void;
  /** Called after a selected custom preset was deleted. */
  onDeleted?: (id: string) => void;
  /** "save" shows only the save-as-preset row (used on the Custom tab). */
  variant?: "full" | "save";
}

/** Largest preset file accepted on import. */
export const MAX_PRESET_FILE_BYTES = 1024 * 1024;

function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Save / rename / delete / import / export of user export presets. */
export function ExportPresetManager({
  currentSettings,
  selectedPreset,
  onSelect,
  onDeleted,
  variant = "full",
}: ExportPresetManagerProps) {
  const full = variant === "full";
  const settingsValid = isValidVideoExportSettings(currentSettings);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedCustom =
    selectedPreset && exportPresetsManager.isCustomPreset(selectedPreset.id)
      ? selectedPreset
      : null;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || !settingsValid) return;
    const created = exportPresetsManager.addCustomPreset({
      name: trimmed,
      description: "Saved from export settings",
      platform: "Custom",
      category: "custom",
      settings: structuredClone(currentSettings),
    });
    setName("");
    setMessage(`Saved preset "${created.name}".`);
    onSelect(created);
  };

  const commitRename = () => {
    if (!selectedCustom) return;
    if (exportPresetsManager.renameCustomPreset(selectedCustom.id, renameDraft)) {
      const updated = exportPresetsManager.getPreset(selectedCustom.id);
      if (updated) onSelect(updated);
      setMessage("Preset renamed.");
    }
    setRenaming(false);
  };

  const remove = () => {
    if (!selectedCustom) return;
    setConfirmingDelete(false);
    exportPresetsManager.deleteCustomPreset(selectedCustom.id);
    onDeleted?.(selectedCustom.id);
    setMessage(`Deleted preset "${selectedCustom.name}".`);
    setRenaming(false);
  };

  const exportAll = () => {
    const custom = exportPresetsManager.getCustomPresets();
    if (custom.length === 0) {
      setMessage("No saved presets to export.");
      return;
    }
    downloadJson(
      "openreel-export-presets.json",
      exportPresetsManager.exportCustomPresets(),
    );
    setMessage(
      `Exported ${custom.length} preset${custom.length === 1 ? "" : "s"}.`,
    );
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_PRESET_FILE_BYTES) {
      setMessage("That file is too large to be a preset file (limit 1 MB).");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    try {
      const { imported, skipped, duplicates } = exportPresetsManager.importCustomPresets(
        await file.text(),
      );
      setMessage(
        `Imported ${imported.length} preset${imported.length === 1 ? "" : "s"}` +
          (skipped ? `, skipped ${skipped} invalid` : "") +
          (duplicates ? `, ${duplicates} already saved` : "") +
          ".",
      );
      if (imported[0]) onSelect(imported[0]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <section
      aria-label={full ? "Manage export presets" : "Save as preset"}
      data-testid="export-preset-manager"
      className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-border bg-bg-2 p-2 text-[12px]"
    >
      <div className="flex min-w-[260px] flex-[4] flex-wrap items-center gap-2">
        <input
          aria-label="New preset name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && save()}
          placeholder="Preset name"
          maxLength={60}
          className="h-7 min-w-0 flex-1 rounded border border-border bg-bg-1 px-2 text-[12px] text-fg"
        />
        <Button
          size="sm"
          className="h-7 px-2.5 text-[12px]"
          variant="secondary"
          disabled={!name.trim() || !settingsValid}
          onClick={save}
        >
          Save current settings
        </Button>
      </div>
      {!settingsValid && (
        <p className="w-full text-[11px] text-fg-muted">
          Complete the export settings (for example the bitrate) to save them.
        </p>
      )}
      {full && (
      <div className="contents">
        {selectedCustom && !renaming && !confirmingDelete && (
          <>
            <Button
              size="sm"
          className="h-7 px-2.5 text-[12px]"
              variant="ghost"
              onClick={() => {
                setRenameDraft(selectedCustom.name);
                setRenaming(true);
              }}
            >
              Rename
            </Button>
            <Button
              size="sm"
          className="h-7 px-2.5 text-[12px]"
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          </>
        )}
        {selectedCustom && confirmingDelete && (
          <>
            <span>Delete "{selectedCustom.name}"? This cannot be undone.</span>
            <Button size="sm"
          className="h-7 px-2.5 text-[12px]" variant="secondary" onClick={remove}>
              Confirm delete
            </Button>
            <Button
              size="sm"
          className="h-7 px-2.5 text-[12px]"
              variant="ghost"
              onClick={() => setConfirmingDelete(false)}
            >
              Keep preset
            </Button>
          </>
        )}
        {selectedCustom && renaming && (
          <>
            <input
              aria-label="Rename preset"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && commitRename()}
              maxLength={60}
              className="h-7 min-w-0 flex-1 rounded border border-border bg-bg-1 px-2 text-[12px] text-fg"
            />
            <Button
              size="sm"
          className="h-7 px-2.5 text-[12px]"
              variant="secondary"
              disabled={!renameDraft.trim()}
              onClick={commitRename}
            >
              Apply name
            </Button>
            <Button
              size="sm"
          className="h-7 px-2.5 text-[12px]"
              variant="ghost"
              onClick={() => setRenaming(false)}
            >
              Cancel
            </Button>
          </>
        )}
        <span className="flex-1" />
        <Button
          size="sm"
          className="h-7 px-2.5 text-[12px]"
          variant="ghost"
          onClick={() => fileInput.current?.click()}
        >
          Import presets
        </Button>
        <Button size="sm"
          className="h-7 px-2.5 text-[12px]" variant="ghost" onClick={exportAll}>
          Export presets
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Import presets file"
          className="sr-only"
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
      </div>
      )}
      {message && (
        <p role="status" className="w-full text-[11px] text-fg-muted">
          {message}
        </p>
      )}
    </section>
  );
}
