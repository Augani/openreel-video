import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Settings2,
  Type,
  Image,
  Video,
  FileText,
  Undo2,
  RotateCcw,
  Upload,
  Check,
} from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import type {
  Template,
  TemplatePlaceholder,
  TemplateReplacements,
  PlaceholderReplacement,
} from "@openreel/core";

interface PlaceholderInputProps {
  placeholder: TemplatePlaceholder;
  value: PlaceholderReplacement | undefined;
  onChange: (value: PlaceholderReplacement) => void;
  onClear: () => void;
}

const TextPlaceholderInput: React.FC<PlaceholderInputProps> = ({
  placeholder,
  value,
  onChange,
  onClear,
}) => {
  const [text, setText] = useState(
    value?.value || placeholder.defaultValue || "",
  );

  useEffect(() => {
    if (value?.value !== undefined) {
      setText(value.value);
    }
  }, [value?.value]);

  const handleChange = useCallback(
    (newText: string) => {
      setText(newText);
      onChange({ type: "text", value: newText });
    },
    [onChange],
  );

  const isModified =
    value?.value !== undefined && value.value !== placeholder.defaultValue;
  const maxLength = placeholder.constraints?.maxLength || 500;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Type size={12} className="text-primary" />
          <span className="text-[11px] font-medium text-text-primary">
            {placeholder.label}
          </span>
          {placeholder.required && (
            <span className="text-red-400 text-[10px]">*</span>
          )}
        </div>
        {isModified && (
          <button
            onClick={onClear}
            className="p-1 text-text-muted hover:text-text-primary"
            title="Reset to default"
          >
            <Undo2 size={10} />
          </button>
        )}
      </div>

      {placeholder.description && (
        <p className="text-[9px] text-text-muted">{placeholder.description}</p>
      )}

      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        maxLength={maxLength}
        rows={Math.min(4, Math.ceil((text.length || 20) / 40))}
        className="w-full px-2 py-1.5 text-[11px] text-text-primary bg-background-tertiary border border-border rounded-lg focus:border-primary focus:outline-none resize-none"
        placeholder={placeholder.defaultValue || "Enter text..."}
      />

      <div className="flex justify-between text-[9px] text-text-muted">
        <span>
          {text.length} / {maxLength} characters
        </span>
      </div>
    </div>
  );
};

const MediaPlaceholderInput: React.FC<PlaceholderInputProps> = ({
  placeholder,
  value,
  onChange,
  onClear,
}) => {
  const project = useProjectStore((state) => state.project);
  const [selectedMediaId, setSelectedMediaId] = useState(value?.value || "");

  const allowedTypes = placeholder.constraints?.mediaTypes || [
    "video",
    "image",
  ];

  const availableMedia = useMemo(() => {
    return project.mediaLibrary.items.filter((item) => {
      if (allowedTypes.includes("video") && item.type === "video") return true;
      if (allowedTypes.includes("image") && item.type === "image") return true;
      if (allowedTypes.includes("audio") && item.type === "audio") return true;
      return false;
    });
  }, [project.mediaLibrary.items, allowedTypes]);

  const handleSelect = useCallback(
    (mediaId: string) => {
      setSelectedMediaId(mediaId);
      const mediaItem = project.mediaLibrary.items.find(
        (m) => m.id === mediaId,
      );
      if (mediaItem) {
        onChange({ type: "media", value: mediaId });
      }
    },
    [onChange, project.mediaLibrary.items],
  );

  const isModified = value?.value !== undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {allowedTypes.includes("video") ? (
            <Video size={12} className="text-green-400" />
          ) : (
            <Image size={12} className="text-primary" />
          )}
          <span className="text-[11px] font-medium text-text-primary">
            {placeholder.label}
          </span>
          {placeholder.required && (
            <span className="text-red-400 text-[10px]">*</span>
          )}
        </div>
        {isModified && (
          <button
            onClick={onClear}
            className="p-1 text-text-muted hover:text-text-primary"
            title="Reset"
          >
            <Undo2 size={10} />
          </button>
        )}
      </div>

      {placeholder.description && (
        <p className="text-[9px] text-text-muted">{placeholder.description}</p>
      )}

      {availableMedia.length === 0 ? (
        <div className="p-4 border border-dashed border-border rounded-lg text-center">
          <Upload size={16} className="mx-auto mb-2 text-text-muted" />
          <p className="text-[10px] text-text-muted">No media available</p>
          <p className="text-[9px] text-text-muted mt-1">
            Import media to use here
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto">
          {availableMedia.map((media) => (
            <button
              key={media.id}
              onClick={() => handleSelect(media.id)}
              className={`relative aspect-video rounded overflow-hidden border-2 transition-all ${
                selectedMediaId === media.id
                  ? "border-primary ring-1 ring-primary"
                  : "border-transparent hover:border-text-muted"
              }`}
            >
              {media.thumbnailUrl ? (
                <img
                  src={media.thumbnailUrl}
                  alt={media.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-background-secondary flex items-center justify-center">
                  {media.type === "video" ? (
                    <Video size={14} className="text-text-muted" />
                  ) : (
                    <Image size={14} className="text-text-muted" />
                  )}
                </div>
              )}
              {selectedMediaId === media.id && (
                <div className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                  <Check size={10} className="text-white" />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SubtitlePlaceholderInput: React.FC<PlaceholderInputProps> = ({
  placeholder,
  value,
  onChange,
  onClear,
}) => {
  const [text, setText] = useState(
    value?.value || placeholder.defaultValue || "",
  );

  useEffect(() => {
    if (value?.value !== undefined) {
      setText(value.value);
    }
  }, [value?.value]);

  const handleChange = useCallback(
    (newText: string) => {
      setText(newText);
      onChange({ type: "subtitle", value: newText });
    },
    [onChange],
  );

  const isModified =
    value?.value !== undefined && value.value !== placeholder.defaultValue;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={12} className="text-yellow-400" />
          <span className="text-[11px] font-medium text-text-primary">
            {placeholder.label}
          </span>
          {placeholder.required && (
            <span className="text-red-400 text-[10px]">*</span>
          )}
        </div>
        {isModified && (
          <button
            onClick={onClear}
            className="p-1 text-text-muted hover:text-text-primary"
            title="Reset to default"
          >
            <Undo2 size={10} />
          </button>
        )}
      </div>

      {placeholder.description && (
        <p className="text-[9px] text-text-muted">{placeholder.description}</p>
      )}

      <input
        type="text"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full px-2 py-1.5 text-[11px] text-text-primary bg-background-tertiary border border-border rounded-lg focus:border-primary focus:outline-none"
        placeholder={placeholder.defaultValue || "Enter subtitle text..."}
      />
    </div>
  );
};

interface TemplateVariablesPanelProps {
  template: Template | null;
  values: TemplateReplacements;
  onChange: (values: TemplateReplacements) => void;
  onApply?: () => void;
}

export const TemplateVariablesPanel: React.FC<TemplateVariablesPanelProps> = ({
  template,
  values,
  onChange,
  onApply,
}) => {
  const placeholders = useMemo(() => {
    return template?.placeholders ?? [];
  }, [template]);

  const handlePlaceholderChange = useCallback(
    (placeholderId: string, value: PlaceholderReplacement) => {
      onChange({
        ...values,
        [placeholderId]: value,
      });
    },
    [values, onChange],
  );

  const handlePlaceholderClear = useCallback(
    (placeholderId: string) => {
      const newValues = { ...values };
      delete newValues[placeholderId];
      onChange(newValues);
    },
    [values, onChange],
  );

  const handleResetAll = useCallback(() => {
    onChange({});
  }, [onChange]);

  const hasChanges = Object.keys(values).length > 0;

  const missingRequired = useMemo(() => {
    return placeholders.filter(
      (p) => p.required && !values[p.id]?.value && !p.defaultValue,
    );
  }, [placeholders, values]);

  const canApply = missingRequired.length === 0;

  const renderPlaceholderInput = useCallback(
    (placeholder: TemplatePlaceholder) => {
      const props = {
        placeholder,
        value: values[placeholder.id],
        onChange: (value: PlaceholderReplacement) =>
          handlePlaceholderChange(placeholder.id, value),
        onClear: () => handlePlaceholderClear(placeholder.id),
      };

      switch (placeholder.type) {
        case "text":
          return <TextPlaceholderInput key={placeholder.id} {...props} />;
        case "media":
          return <MediaPlaceholderInput key={placeholder.id} {...props} />;
        case "subtitle":
          return <SubtitlePlaceholderInput key={placeholder.id} {...props} />;
        default:
          return null;
      }
    },
    [values, handlePlaceholderChange, handlePlaceholderClear],
  );

  if (!template) {
    return (
      <div className="p-4 text-center">
        <Settings2
          size={24}
          className="mx-auto mb-2 text-text-muted opacity-50"
        />
        <p className="text-[10px] text-text-muted">
          Select a template to edit variables
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 size={14} className="text-primary" />
          <span className="text-[11px] font-medium text-text-primary">
            Template Variables
          </span>
          <span className="text-[9px] text-text-muted bg-background-tertiary px-1.5 py-0.5 rounded">
            {placeholders.length}
          </span>
        </div>
        {hasChanges && (
          <button
            onClick={handleResetAll}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary"
          >
            <RotateCcw size={10} />
            Reset All
          </button>
        )}
      </div>

      {placeholders.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-[10px] text-text-muted">
            This template has no editable variables
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {placeholders.map((placeholder) => (
            <div
              key={placeholder.id}
              className="p-3 bg-background-tertiary rounded-lg border border-border"
            >
              {renderPlaceholderInput(placeholder)}
            </div>
          ))}
        </div>
      )}

      {missingRequired.length > 0 && (
        <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <p className="text-[10px] text-amber-400">
            Fill in required fields:{" "}
            {missingRequired.map((p) => p.label).join(", ")}
          </p>
        </div>
      )}

      {onApply && (
        <button
          onClick={onApply}
          disabled={!canApply}
          className={`w-full py-2 rounded-lg text-[11px] font-medium transition-all ${
            canApply
              ? "bg-primary text-white hover:bg-primary/90"
              : "bg-background-tertiary text-text-muted cursor-not-allowed"
          }`}
        >
          Apply Template
        </button>
      )}
    </div>
  );
};

export default TemplateVariablesPanel;
