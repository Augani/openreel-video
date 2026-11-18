import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "@/icons/lucide-compat";
import {
  Button,
  Card,
  Input,
  Textarea,
  Label,
  RadioGroup,
  RadioGroupItem,
  cn,
} from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import type {
  Template,
  TemplatePlaceholder,
  TemplateReplacements,
  PlaceholderReplacement,
} from "@openreel/core";

const DEFAULT_MEDIA_TYPES: NonNullable<
  NonNullable<TemplatePlaceholder["constraints"]>["mediaTypes"]
> = ["video", "image"];
interface FieldProps {
  placeholder: TemplatePlaceholder;
  value: PlaceholderReplacement | undefined;
  disabled: boolean;
  onChange: (id: string, value: PlaceholderReplacement) => void;
  onClear: (id: string) => void;
}

const PlaceholderField = memo(function PlaceholderField({
  placeholder,
  value,
  disabled,
  onChange,
  onClear,
}: FieldProps) {
  const id = useId();
  const text = value?.value ?? placeholder.defaultValue ?? "";
  const modified =
    value !== undefined &&
    (placeholder.type === "media" || value.value !== placeholder.defaultValue);
  const Icon =
    placeholder.type === "text"
      ? Type
      : placeholder.type === "subtitle"
        ? FileText
        : Video;
  const maxLength = placeholder.constraints?.maxLength ?? 500;
  return (
    <Card className="min-w-0 space-y-2 rounded-lg border-border bg-bg-2 p-3 shadow-none">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={12} className="shrink-0 text-primary" aria-hidden />
          <Label
            htmlFor={`${id}-value`}
            id={`${id}-label`}
            className="text-[11px] font-medium text-fg"
          >
            {placeholder.label}
          </Label>
          {placeholder.required && (
            <span aria-hidden className="text-[10px] text-red-400">
              *
            </span>
          )}
        </div>
        {modified && (
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={`Reset ${placeholder.label}`}
            title="Reset to default"
            disabled={disabled}
            onClick={() => onClear(placeholder.id)}
            className="h-7 w-7 shrink-0 text-fg-3"
          >
            <Undo2 size={10} aria-hidden />
          </Button>
        )}
      </div>
      {placeholder.description && (
        <p id={`${id}-description`} className="text-[9px] text-fg-2">
          {placeholder.description}
        </p>
      )}
      {placeholder.type === "media" ? (
        <MediaField
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={onChange}
          labelId={`${id}-label`}
        />
      ) : placeholder.type === "text" ? (
        <>
          <Textarea
            id={`${id}-value`}
            value={text}
            disabled={disabled}
            required={placeholder.required}
            maxLength={maxLength}
            rows={Math.max(1, Math.min(4, Math.ceil((text.length || 20) / 40)))}
            onChange={(event) =>
              onChange(placeholder.id, {
                type: "text",
                value: event.target.value,
              })
            }
            placeholder={placeholder.defaultValue ?? "Enter text..."}
            aria-describedby={
              placeholder.description ? `${id}-description` : undefined
            }
            className="min-h-[5.75rem] w-full resize-none rounded-lg border-border bg-bg-2 px-2 py-1.5 text-[11px] text-fg focus:border-primary"
          />
          <p className="text-[9px] text-fg-3">
            {text.length} / {maxLength} characters
          </p>
        </>
      ) : (
        <Input
          id={`${id}-value`}
          value={text}
          disabled={disabled}
          required={placeholder.required}
          maxLength={placeholder.constraints?.maxLength}
          onChange={(event) =>
            onChange(placeholder.id, {
              type: "subtitle",
              value: event.target.value,
            })
          }
          placeholder={placeholder.defaultValue ?? "Enter subtitle text..."}
          aria-describedby={
            placeholder.description ? `${id}-description` : undefined
          }
          className="h-8 w-full rounded-lg border-border bg-bg-2 px-2 py-1.5 text-[11px] text-fg focus:border-primary"
        />
      )}
    </Card>
  );
});

function MediaField({
  placeholder,
  value,
  disabled,
  onChange,
  labelId,
}: Omit<FieldProps, "onClear"> & { labelId: string }) {
  const items = useProjectStore((state) => state.project.mediaLibrary.items);
  const allowed = placeholder.constraints?.mediaTypes ?? DEFAULT_MEDIA_TYPES;
  const available = useMemo(
    () => items.filter((item) => allowed.includes(item.type)),
    [items, allowed],
  );
  const [page, setPage] = useState(0);
  const pageSize = 24,
    pages = Math.max(1, Math.ceil(available.length / pageSize)),
    activePage = Math.min(page, pages - 1);
  const visible = available.slice(
    activePage * pageSize,
    (activePage + 1) * pageSize,
  );
  if (!available.length)
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <Upload size={16} className="mx-auto mb-2 text-fg-3" aria-hidden />
        <p className="text-[10px] text-fg-2">No media available</p>
        <p className="mt-1 text-[9px] text-fg-2">Import media to use here</p>
      </div>
    );
  return (
    <div className="space-y-2">
      <RadioGroup
        aria-labelledby={labelId}
        value={value?.value ?? ""}
        disabled={disabled}
        onValueChange={(mediaId) =>
          onChange(placeholder.id, { type: "media", value: mediaId })
        }
        className="grid max-h-32 grid-cols-3 gap-2 overflow-y-auto"
      >
        {visible.map((media) => (
          <Label
            key={media.id}
            className={cn(
              "relative block aspect-video cursor-pointer overflow-hidden rounded border-2 bg-bg-1 transition-colors focus-within:ring-2 focus-within:ring-ring",
              value?.value === media.id
                ? "border-primary ring-1 ring-primary"
                : "border-transparent hover:border-text-muted",
              (disabled || media.isPending || media.kieaiError) &&
                "cursor-not-allowed opacity-50",
            )}
          >
            <RadioGroupItem
              value={media.id}
              aria-label={media.name}
              disabled={disabled || media.isPending || media.kieaiError}
              className="sr-only"
            />
            {media.thumbnailUrl ? (
              <img
                src={media.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                {media.type === "video" ? (
                  <Video size={14} className="text-fg-3" aria-hidden />
                ) : (
                  <Image size={14} className="text-fg-3" aria-hidden />
                )}
              </span>
            )}
            {value?.value === media.id && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                <Check size={10} className="text-white" aria-hidden />
              </span>
            )}
          </Label>
        ))}
      </RadioGroup>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-[9px] text-fg-3">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={`Previous ${placeholder.label} media page`}
            disabled={disabled || activePage === 0}
            onClick={() => setPage(activePage - 1)}
          >
            <ChevronLeft size={12} aria-hidden />
          </Button>
          <span>
            {activePage * pageSize + 1}–
            {Math.min(available.length, (activePage + 1) * pageSize)} of{" "}
            {available.length}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={`Next ${placeholder.label} media page`}
            disabled={disabled || activePage + 1 >= pages}
            onClick={() => setPage(activePage + 1)}
          >
            <ChevronRight size={12} aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

interface TemplateVariablesPanelProps {
  template: Template | null;
  values: TemplateReplacements;
  onChange: (values: TemplateReplacements) => void;
  onApply?: () => void;
  isApplying?: boolean;
}

export function TemplateVariablesPanel({
  template,
  values,
  onChange,
  onApply,
  isApplying = false,
}: TemplateVariablesPanelProps) {
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [template?.id]);
  const change = useCallback(
    (id: string, value: PlaceholderReplacement) => {
      if (isApplying) return;
      const next = { ...valuesRef.current, [id]: value };
      valuesRef.current = next;
      onChange(next);
    },
    [onChange, isApplying],
  );
  const clear = useCallback(
    (id: string) => {
      if (isApplying) return;
      const next = { ...valuesRef.current };
      delete next[id];
      valuesRef.current = next;
      onChange(next);
    },
    [onChange, isApplying],
  );
  if (!template)
    return (
      <div className="p-4 text-center">
        <Settings2
          size={24}
          className="mx-auto mb-2 text-fg-3 opacity-50"
          aria-hidden
        />
        <p className="text-[10px] text-fg-2">
          Select a template to edit variables
        </p>
      </div>
    );
  const placeholders = template.placeholders;
  const missing = placeholders.filter(
    (item) =>
      item.required &&
      !(
        values[item.id]?.mediaBlob ||
        (values[item.id]?.value ?? item.defaultValue ?? "").trim()
      ),
  );
  const pages = Math.max(1, Math.ceil(placeholders.length / 50)),
    activePage = Math.min(page, pages - 1);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Settings2 size={14} className="text-primary" aria-hidden />
          <span className="text-[11px] font-medium text-fg">
            Template Variables
          </span>
          <span className="rounded bg-bg-2 px-1.5 py-0.5 text-[9px] text-fg-3">
            {placeholders.length}
          </span>
        </div>
        {Object.keys(values).length > 0 && (
          <Button
            variant="ghost"
            type="button"
            disabled={isApplying}
            onClick={() => {
              valuesRef.current = {};
              onChange({});
            }}
            className="h-8 gap-1 px-3 text-[10px] text-fg-3"
          >
            <RotateCcw size={10} aria-hidden />
            Reset All
          </Button>
        )}
      </div>
      {!placeholders.length ? (
        <p className="py-6 text-center text-[10px] text-fg-2">
          This template has no editable variables
        </p>
      ) : (
        placeholders
          .slice(activePage * 50, (activePage + 1) * 50)
          .map((placeholder) => (
            <PlaceholderField
              key={`${template.id}:${placeholder.id}`}
              placeholder={placeholder}
              value={values[placeholder.id]}
              disabled={isApplying}
              onChange={change}
              onClear={clear}
            />
          ))
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between text-[10px] text-fg-3">
          <Button
            variant="ghost"
            type="button"
            disabled={isApplying || activePage === 0}
            onClick={() => setPage(activePage - 1)}
          >
            Previous fields
          </Button>
          <span>
            {activePage + 1} / {pages}
          </span>
          <Button
            variant="ghost"
            type="button"
            disabled={isApplying || activePage + 1 >= pages}
            onClick={() => setPage(activePage + 1)}
          >
            Next fields
          </Button>
        </div>
      )}
      {missing.length > 0 && (
        <Card
          role="status"
          className="rounded-lg border-amber-500/30 bg-amber-500/10 p-2 text-[10px] text-amber-400 shadow-none"
        >
          Fill in required fields:{" "}
          {missing.map((item) => item.label).join(", ")}
        </Card>
      )}
      {onApply && (
        <Button
          type="button"
          onClick={onApply}
          disabled={missing.length > 0 || isApplying}
          className="h-8 w-full gap-1.5 rounded-lg bg-accent px-3 text-[11px] text-accent-fg hover:bg-accent/90"
        >
          {isApplying && (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          )}
          Apply Template
        </Button>
      )}
    </div>
  );
}
