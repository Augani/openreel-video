import { memo, useId, useMemo, useState } from "react";
import {
  Button,
  Card,
  ColorPicker,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea,
  cn,
} from "@openreel/ui";
import {
  Type,
  Image,
  Layers,
  Palette,
  Sliders,
  ToggleLeft,
  Hash,
  Music,
  Play,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "@/icons/lucide-compat";
import type {
  ExtendedPlaceholder,
  ExtendedPlaceholderType,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import {
  displayTemplateField,
  templateColorHex,
  templateFieldUsesJson,
  type TemplateFieldDraft,
} from "../../services/template-customization";

const icons: Record<ExtendedPlaceholderType, React.ElementType> = {
  text: Type,
  subtitle: Type,
  media: Image,
  audio: Music,
  shape: Layers,
  effect: Sliders,
  transform: Sliders,
  keyframe: Sliders,
  style: Palette,
  color: Palette,
  number: Hash,
  boolean: ToggleLeft,
  font: Type,
  animation: Play,
};
const defaultMediaTypes = ["video", "image"] as const;
const audioTypes = ["audio"] as const;
const inputClass =
  "h-9 w-full min-w-0 rounded-lg border-border bg-bg-2 text-sm text-fg";
interface Props {
  field: ExtendedPlaceholder;
  draft: TemplateFieldDraft | undefined;
  error?: string;
  disabled: boolean;
  onChange: (id: string, value: TemplateFieldDraft) => void;
  onReset: (id: string) => void;
}

export const TemplatePlaceholderField = memo(function TemplatePlaceholderField({
  field,
  draft,
  error,
  disabled,
  onChange,
  onReset,
}: Props) {
  const id = useId(),
    value = draft ?? displayTemplateField(field),
    text = String(value);
  const Icon = icons[field.type];
  const json = templateFieldUsesJson(field);
  const allowed =
    field.constraints?.allowedValues ??
    (field.type === "font"
      ? field.constraints?.allowedFonts
      : field.type === "animation"
        ? field.constraints?.allowedAnimations
        : undefined);
  const options = allowed
    ? allowed.map((item) => ({
        value: item,
        label:
          field.uiHints?.options?.find((option) => option.value === item)
            ?.label ?? item,
      }))
    : field.uiHints?.options;
  const choices = options?.filter(
    (option, index, items) =>
      option.value &&
      items.findIndex((candidate) => candidate.value === option.value) ===
        index,
  );
  const describedBy =
    [
      field.description ? `${id}-description` : null,
      error ? `${id}-error` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const attributes = {
    id: `${id}-input`,
    disabled,
    "aria-invalid": Boolean(error),
    "aria-describedby": describedBy,
    "aria-required": field.required,
  };
  const change = (next: TemplateFieldDraft) => onChange(field.id, next);
  let control;
  if (field.type === "boolean") {
    control = (
      <div className="flex items-center gap-3">
        <Switch
          {...attributes}
          checked={Boolean(value)}
          onCheckedChange={change}
        />
        <span
          id={field.description ? `${id}-description` : undefined}
          className="text-xs text-fg-3"
        >
          {field.description ?? "Enabled"}
        </span>
      </div>
    );
  } else if (choices?.length && !json) {
    control = (
      <Select
        value={text || undefined}
        onValueChange={change}
        disabled={disabled}
      >
        <SelectTrigger {...attributes} className={inputClass}>
          <SelectValue placeholder="Choose a value" />
        </SelectTrigger>
        <SelectContent>
          {text && !choices.some((option) => option.value === text) && (
            <SelectItem value={text}>{text}</SelectItem>
          )}
          {choices.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (field.type === "number") {
    const numeric = Number(text),
      finite = text.trim() !== "" && Number.isFinite(numeric);
    const min = field.constraints?.min ?? Math.min(0, finite ? numeric : 0),
      max = field.constraints?.max ?? Math.max(100, finite ? numeric : 100);
    const step =
      field.constraints?.step !== undefined &&
      Number.isFinite(field.constraints.step) &&
      field.constraints.step > 0
        ? field.constraints.step
        : 1;
    control = (
      <div className="flex items-center gap-3">
        {field.uiHints?.inputType === "slider" && max > min && (
          <Slider
            aria-label={`${field.label} slider`}
            aria-valuetext={finite ? text : "No value"}
            value={[finite ? Math.max(min, Math.min(max, numeric)) : min]}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onValueChange={([next]) => change(String(next))}
            className="flex-1"
          />
        )}
        <Input
          {...attributes}
          type="number"
          inputMode="decimal"
          value={text}
          min={field.constraints?.min}
          max={field.constraints?.max}
          step={field.constraints?.step ?? "any"}
          onChange={(event) => change(event.target.value)}
          className={cn(
            inputClass,
            field.uiHints?.inputType === "slider" && "w-24 shrink-0 font-mono",
          )}
        />
      </div>
    );
  } else if (field.type === "color") {
    control = (
      <div className="flex items-center gap-3">
        <ColorPicker
          label={`${field.label} picker`}
          value={text || "#000000"}
          onChange={(next) => {
            const hex = templateColorHex(next);
            if (hex) change(hex);
          }}
          showAlpha
          showValue={false}
          disabled={disabled}
        />
        <Input
          {...attributes}
          value={text}
          onChange={(event) => change(event.target.value)}
          placeholder="#000000"
          className={cn(inputClass, "flex-1 font-mono")}
        />
      </div>
    );
  } else if (
    json ||
    field.type === "text" ||
    field.type === "subtitle" ||
    field.uiHints?.inputType === "textarea"
  ) {
    control = (
      <div className="space-y-1">
        <Textarea
          {...attributes}
          value={text}
          onChange={(event) => change(event.target.value)}
          maxLength={json ? undefined : field.constraints?.maxLength}
          rows={json ? 5 : 2}
          spellCheck={!json}
          className={cn(
            "min-h-20 w-full resize-y rounded-lg border-border bg-bg-2 text-sm text-fg",
            json && "font-mono text-xs",
          )}
        />
        {json ? (
          <p className="text-[10px] text-fg-3">
            Edit the structured values as JSON.
          </p>
        ) : (
          field.constraints?.maxLength !== undefined && (
            <p className="text-right text-[10px] text-fg-3">
              {text.length}/{field.constraints.maxLength}
            </p>
          )
        )}
      </div>
    );
  } else {
    control = (
      <Input
        {...attributes}
        value={text}
        onChange={(event) => change(event.target.value)}
        placeholder={
          typeof field.defaultValue === "string" ? field.defaultValue : ""
        }
        className={inputClass}
      />
    );
  }
  return (
    <Card
      data-template-field={field.id}
      className="min-w-0 space-y-2 rounded-lg border-border bg-transparent p-3 shadow-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={14} aria-hidden className="shrink-0 text-fg-3" />
          <Label
            id={`${id}-label`}
            htmlFor={`${id}-input`}
            className="text-sm font-medium text-fg"
          >
            {field.label}
          </Label>
          {field.required && (
            <span aria-hidden className="text-red-400">
              *
            </span>
          )}
        </div>
        {draft !== undefined && (
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            disabled={disabled}
            aria-label={`Reset ${field.label}`}
            onClick={() => onReset(field.id)}
          >
            <RotateCcw size={12} aria-hidden />
          </Button>
        )}
      </div>
      {field.description && field.type !== "boolean" && (
        <p id={`${id}-description`} className="text-xs text-fg-3">
          {field.description}
        </p>
      )}
      {control}
      {(field.type === "media" || field.type === "audio") && (
        <LibraryMediaChoices
          field={field}
          value={text}
          disabled={disabled}
          onChange={onChange}
        />
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </Card>
  );
});

function LibraryMediaChoices({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ExtendedPlaceholder;
  value: string;
  disabled: boolean;
  onChange: Props["onChange"];
}) {
  const items = useProjectStore((state) => state.project.mediaLibrary.items);
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const allowed =
    field.constraints?.mediaTypes ??
    (field.type === "audio" ? audioTypes : defaultMediaTypes);
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        allowed.some((type) => type === item.type) &&
        (!query || item.name.toLowerCase().includes(query)),
    );
  }, [items, allowed, search]);
  const pages = Math.max(1, Math.ceil(matches.length / 24)),
    activePage = Math.min(page, pages - 1);
  if (!items.length)
    return (
      <p className="text-[10px] text-fg-3">
        Enter a media reference, or import media to choose from your library.
      </p>
    );
  return (
    <div className="space-y-2">
      <Input
        aria-label={`Search ${field.label} library`}
        value={search}
        disabled={disabled}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(0);
        }}
        placeholder="Search current media..."
        className="h-8 border-border bg-bg-2 text-xs"
      />
      {!matches.length ? (
        <p className="text-[10px] text-fg-3">No matching media</p>
      ) : (
        <RadioGroup
          aria-label={`${field.label} library`}
          value={value}
          onValueChange={(next) => onChange(field.id, next)}
          disabled={disabled}
          className="grid grid-cols-3 gap-2"
        >
          {matches.slice(activePage * 24, (activePage + 1) * 24).map((item) => (
            <Label
              key={item.id}
              className={cn(
                "relative min-w-0 cursor-pointer overflow-hidden rounded-md border border-border bg-bg-2 p-2 focus-within:ring-2 focus-within:ring-ring",
                value === item.id && "border-primary bg-primary/10",
                (disabled || item.isPending || item.kieaiError) &&
                  "cursor-not-allowed opacity-50",
              )}
            >
              <RadioGroupItem
                value={item.id}
                aria-label={item.name}
                disabled={disabled || item.isPending || item.kieaiError}
                className="sr-only"
              />
              {item.thumbnailUrl && (
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="mb-1 aspect-video w-full object-cover"
                />
              )}
              <span className="block truncate text-[10px] text-fg-2">
                {item.name}
              </span>
            </Label>
          ))}
        </RadioGroup>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between text-[10px] text-fg-3">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={`Previous ${field.label} library page`}
            disabled={disabled || activePage === 0}
            onClick={() => setPage(activePage - 1)}
          >
            <ChevronLeft size={12} aria-hidden />
          </Button>
          <span>
            {activePage * 24 + 1}–
            {Math.min(matches.length, (activePage + 1) * 24)} of{" "}
            {matches.length}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={`Next ${field.label} library page`}
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
