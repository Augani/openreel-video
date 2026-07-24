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
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
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
          <span className="text-[11px] font-medium text-fg">
            {placeholder.label}
          </span>
          {placeholder.required && (
            <span className="text-red-400 text-[10px]">*</span>
          )}
        </div>
        {isModified && (
          <IconButton
            label="Reset to default"
            icon={<Undo2 size={10} />}
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="p-1 text-fg-3 hover:text-fg"
          />
        )}
      </div>

      {placeholder.description && (
        <Text type="supporting" color="secondary" display="block" className="text-[9px]">
          {placeholder.description}
        </Text>
      )}

      <ToolcraftTextAreaControl
        label={placeholder.label}
        isLabelHidden
        value={text}
        onChange={handleChange}
        maxLength={maxLength}
        rows={Math.min(4, Math.ceil((text.length || 20) / 40))}
        inputClassName="w-full px-2 py-1.5 text-[11px] text-fg bg-bg-2 border border-border rounded-lg focus:border-primary focus:outline-none resize-none"
        placeholder={placeholder.defaultValue || "Enter text..."}
      />

      <div className="flex justify-between text-[9px] text-fg-3">
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
          <span className="text-[11px] font-medium text-fg">
            {placeholder.label}
          </span>
          {placeholder.required && (
            <span className="text-red-400 text-[10px]">*</span>
          )}
        </div>
        {isModified && (
          <IconButton
            label="Reset"
            icon={<Undo2 size={10} />}
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="p-1 text-fg-3 hover:text-fg"
          />
        )}
      </div>

      {placeholder.description && (
        <Text type="supporting" color="secondary" display="block" className="text-[9px]">
          {placeholder.description}
        </Text>
      )}

      {availableMedia.length === 0 ? (
        <div className="p-4 border border-dashed border-border rounded-lg text-center">
          <Upload size={16} className="mx-auto mb-2 text-fg-3" />
          <Text type="supporting" color="secondary" display="block" className="text-[10px]">
            No media available
          </Text>
          <Text type="supporting" color="secondary" display="block" className="mt-1 text-[9px]">
            Import media to use here
          </Text>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto">
          {availableMedia.map((media) => (
            <SelectableCard
              key={media.id}
              label={media.name}
              isSelected={selectedMediaId === media.id}
              onChange={() => handleSelect(media.id)}
              onClick={() => handleSelect(media.id)}
              padding={0}
              variant={selectedMediaId === media.id ? "green" : "muted"}
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
                <div className="w-full h-full bg-bg-1 flex items-center justify-center">
                  {media.type === "video" ? (
                    <Video size={14} className="text-fg-3" />
                  ) : (
                    <Image size={14} className="text-fg-3" />
                  )}
                </div>
              )}
              {selectedMediaId === media.id && (
                <div className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                  <Check size={10} className="text-white" />
                </div>
              )}
            </SelectableCard>
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
          <span className="text-[11px] font-medium text-fg">
            {placeholder.label}
          </span>
          {placeholder.required && (
            <span className="text-red-400 text-[10px]">*</span>
          )}
        </div>
        {isModified && (
          <IconButton
            label="Reset to default"
            icon={<Undo2 size={10} />}
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="p-1 text-fg-3 hover:text-fg"
          />
        )}
      </div>

      {placeholder.description && (
        <Text type="supporting" color="secondary" display="block" className="text-[9px]">
          {placeholder.description}
        </Text>
      )}

      <ToolcraftTextInputControl
        label={placeholder.label}
        isLabelHidden
        value={text}
        onChange={handleChange}
        className="w-full px-2 py-1.5 text-[11px] text-fg bg-bg-2 border border-border rounded-lg focus:border-primary focus:outline-none"
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
          className="mx-auto mb-2 text-fg-3 opacity-50"
        />
        <Text type="supporting" color="secondary" display="block" className="text-[10px]">
          Select a template to edit variables
        </Text>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 size={14} className="text-primary" />
          <span className="text-[11px] font-medium text-fg">
            Template Variables
          </span>
          <span className="text-[9px] text-fg-3 bg-bg-2 px-1.5 py-0.5 rounded">
            {placeholders.length}
          </span>
        </div>
        {hasChanges && (
          <Button
            label="Reset All"
            variant="ghost"
            icon={<RotateCcw size={10} />}
            onClick={handleResetAll}
            className="flex items-center gap-1 text-[10px] text-fg-3 hover:text-fg"
          />
        )}
      </div>

      {placeholders.length === 0 ? (
        <div className="text-center py-6">
          <Text type="supporting" color="secondary" display="block" className="text-[10px]">
            This template has no editable variables
          </Text>
        </div>
      ) : (
        <div className="space-y-4">
          {placeholders.map((placeholder) => (
            <div
              key={placeholder.id}
              className="p-3 bg-bg-2 rounded-lg border border-border"
            >
              {renderPlaceholderInput(placeholder)}
            </div>
          ))}
        </div>
      )}

      {missingRequired.length > 0 && (
        <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <Text type="supporting" display="block" className="text-[10px] text-amber-400">
            Fill in required fields:{" "}
            {missingRequired.map((p) => p.label).join(", ")}
          </Text>
        </div>
      )}

      {onApply && (
        <Button
          label="Apply Template"
          variant="primary"
          onClick={onApply}
          isDisabled={!canApply}
          className={`w-full py-2 rounded-lg text-[11px] font-medium transition-all ${
            canApply
              ? "bg-primary text-white hover:bg-primary/90"
              : "bg-bg-2 text-fg-3 cursor-not-allowed"
          }`}
        />
      )}
    </div>
  );
};

export default TemplateVariablesPanel;
