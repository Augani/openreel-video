import * as React from "react"
import { ChevronDown, X } from "lucide-react"

import { cn } from "../lib/utils"

interface ToolcraftOption<T extends string = string> {
  disabled?: boolean
  label: string
  value: T
}

interface ToolcraftOptionSection<T extends string = string> {
  options: readonly ToolcraftOption<T>[]
  title: string
  type: "section"
}

type ToolcraftSelectEntry<T extends string = string> =
  | ToolcraftOption<T>
  | ToolcraftOptionSection<T>

interface ToolcraftBaseFieldProps {
  ariaLabel?: string
  className?: string
  disabled?: boolean
  id?: string
  inputClassName?: string
  label?: React.ReactNode
  leading?: React.ReactNode
  placeholder?: string
}

export interface ToolcraftTextInputControlProps
  extends ToolcraftBaseFieldProps,
    Omit<
      React.InputHTMLAttributes<HTMLInputElement>,
      "className" | "disabled" | "onChange" | "size" | "value"
    > {
  autoFocus?: boolean
  clearable?: boolean
  hasAutoFocus?: boolean
  isDisabled?: boolean
  isLabelHidden?: boolean
  isRequired?: boolean
  onChange?: (value: string) => void
  size?: "sm" | "md" | "lg"
  startIcon?: React.ReactNode
  value: string
  width?: number | string
}

export interface ToolcraftTextAreaControlProps
  extends Omit<ToolcraftBaseFieldProps, "leading">,
    Omit<
      React.TextareaHTMLAttributes<HTMLTextAreaElement>,
      "className" | "disabled" | "onChange" | "value"
    > {
  autoFocus?: boolean
  hasAutoFocus?: boolean
  isDisabled?: boolean
  isLabelHidden?: boolean
  isRequired?: boolean
  onChange?: (value: string) => void
  rows?: number
  size?: "sm" | "md" | "lg"
  value: string
  width?: number | string
}

export interface ToolcraftNumberInputControlProps
  extends ToolcraftBaseFieldProps,
    Omit<
      React.InputHTMLAttributes<HTMLInputElement>,
      "className" | "disabled" | "max" | "min" | "onChange" | "size" | "step" | "type" | "value"
    > {
  autoFocus?: boolean
  hasAutoFocus?: boolean
  isDisabled?: boolean
  isLabelHidden?: boolean
  isRequired?: boolean
  max?: number
  min?: number
  onChange?: (value: number) => void
  size?: "sm" | "md" | "lg"
  step?: number
  unit?: string
  units?: string | null
  value: number | null
  width?: number | string
}

export interface ToolcraftSelectControlProps<T extends string = string>
  extends Omit<ToolcraftBaseFieldProps, "leading"> {
  hasSearch?: boolean
  isDisabled?: boolean
  isLabelHidden?: boolean
  onChange: (value: T) => void
  options: readonly ToolcraftSelectEntry<T>[]
  searchPlaceholder?: string
  size?: "sm" | "md" | "lg"
  value: T
  width?: number | string
}

export const ToolcraftTextInputControl = React.forwardRef<
  HTMLInputElement,
  ToolcraftTextInputControlProps
>(
  (
    {
      ariaLabel,
      autoFocus = false,
      className,
      clearable = false,
      disabled = false,
      hasAutoFocus = false,
      id,
      inputClassName,
      isDisabled = false,
      isLabelHidden = false,
      isRequired = false,
      label,
      leading,
      onChange,
      placeholder,
      required = false,
      size,
      startIcon,
      type = "text",
      value,
      width,
      ...inputProps
    },
    ref,
  ): React.JSX.Element => {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const fieldLabel = isLabelHidden ? undefined : label
  const hiddenLabel = isLabelHidden ? getReactNodeText(label).trim() : ""
  const resolvedLeading = leading ?? startIcon
  const resolvedDisabled = disabled || isDisabled
  const inputAriaLabel =
    ariaLabel ?? (hiddenLabel !== "" ? hiddenLabel : undefined) ?? placeholder ?? "Text input"
  const fieldStyle = width
    ? { width: typeof width === "number" ? `${width}px` : width }
    : undefined

  return (
    <ToolcraftFieldFrame
      className={className}
      controlId={inputId}
      label={fieldLabel}
      style={fieldStyle}
      dataSlot="toolcraft-text-input-control"
    >
      <div className="relative min-w-0">
        {resolvedLeading ? (
          <span className="pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2 items-center text-fg-muted">
            {resolvedLeading}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-label={fieldLabel ? undefined : inputAriaLabel}
          autoFocus={autoFocus || hasAutoFocus}
          disabled={resolvedDisabled}
          placeholder={placeholder}
          required={required || isRequired}
          type={type}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          className={cn(
            toolcraftInputClassName,
            size === "sm" && "h-7 text-[12px]",
            size === "lg" && "h-9 text-[14px]",
            resolvedLeading && "pl-8",
            clearable && value !== "" && "pr-8",
            inputClassName,
          )}
          {...inputProps}
        />
        {clearable && value !== "" ? (
          <button
            type="button"
            aria-label="Clear text"
            disabled={resolvedDisabled}
            onClick={() => onChange?.("")}
            className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-3 hover:text-fg disabled:pointer-events-none"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </ToolcraftFieldFrame>
  )
  },
)

ToolcraftTextInputControl.displayName = "ToolcraftTextInputControl"

export const ToolcraftTextAreaControl = React.forwardRef<
  HTMLTextAreaElement,
  ToolcraftTextAreaControlProps
>(
  (
    {
      ariaLabel,
      autoFocus = false,
      className,
      disabled = false,
      hasAutoFocus = false,
      id,
      inputClassName,
      isDisabled = false,
      isLabelHidden = false,
      isRequired = false,
      label,
      onChange,
      placeholder,
      required = false,
      rows = 3,
      size,
      value,
      width,
      ...textareaProps
    },
    ref,
  ): React.JSX.Element => {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const fieldLabel = isLabelHidden ? undefined : label
  const hiddenLabel = isLabelHidden ? getReactNodeText(label).trim() : ""
  const inputAriaLabel =
    ariaLabel ?? (hiddenLabel !== "" ? hiddenLabel : undefined) ?? placeholder ?? "Text area"
  const resolvedDisabled = disabled || isDisabled
  const fieldStyle = width
    ? { width: typeof width === "number" ? `${width}px` : width }
    : undefined

  return (
    <ToolcraftFieldFrame
      className={className}
      controlId={inputId}
      label={fieldLabel}
      style={fieldStyle}
      dataSlot="toolcraft-textarea-control"
    >
      <textarea
        ref={ref}
        id={inputId}
        aria-label={fieldLabel ? undefined : inputAriaLabel}
        autoFocus={autoFocus || hasAutoFocus}
        disabled={resolvedDisabled}
        placeholder={placeholder}
        required={required || isRequired}
        rows={rows}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className={cn(
          toolcraftInputClassName,
          "min-h-[5.75rem] resize-y leading-5",
          size === "sm" && "text-[12px]",
          size === "lg" && "text-[14px]",
          inputClassName,
        )}
        {...textareaProps}
      />
    </ToolcraftFieldFrame>
  )
  },
)

ToolcraftTextAreaControl.displayName = "ToolcraftTextAreaControl"

export function ToolcraftNumberInputControl({
  ariaLabel,
  autoFocus = false,
  className,
  disabled = false,
  hasAutoFocus = false,
  id,
  inputClassName,
  isDisabled = false,
  isLabelHidden = false,
  isRequired = false,
  label,
  leading,
  max,
  min,
  onChange,
  placeholder,
  required = false,
  size,
  step = 1,
  unit,
  units,
  value,
  width,
  ...inputProps
}: ToolcraftNumberInputControlProps): React.JSX.Element {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const fieldLabel = isLabelHidden ? undefined : label
  const hiddenLabel = isLabelHidden ? getReactNodeText(label).trim() : ""
  const inputAriaLabel =
    ariaLabel ?? (hiddenLabel !== "" ? hiddenLabel : undefined) ?? "Number value"
  const resolvedDisabled = disabled || isDisabled
  const resolvedUnit = unit ?? units ?? undefined
  const fieldStyle = width
    ? { width: typeof width === "number" ? `${width}px` : width }
    : undefined
  const normalizedValue = Number.isFinite(value) ? Number(value) : 0
  const [draft, setDraft] = React.useState(() => String(normalizedValue))
  const [editing, setEditing] = React.useState(false)

  React.useEffect(() => {
    if (!editing) {
      setDraft(String(normalizedValue))
    }
  }, [editing, normalizedValue])

  const commitDraft = React.useCallback(
    (nextDraft = draft) => {
      const parsed = Number.parseFloat(nextDraft)
      if (!Number.isFinite(parsed)) {
        setDraft(String(normalizedValue))
        setEditing(false)
        return
      }

      const clamped = clamp(parsed, min, max)
      setDraft(String(clamped))
      setEditing(false)
      onChange?.(clamped)
    },
    [draft, max, min, normalizedValue, onChange],
  )

  const stepDraft = React.useCallback(
    (direction: -1 | 1) => {
      const parsed = Number.parseFloat(draft)
      const base = Number.isFinite(parsed) ? parsed : normalizedValue
      const nextValue = clamp(base + direction * step, min, max)
      setDraft(String(nextValue))
      onChange?.(nextValue)
    },
    [draft, max, min, normalizedValue, onChange, step],
  )

  return (
    <ToolcraftFieldFrame
      className={className}
      controlId={inputId}
      label={fieldLabel}
      style={fieldStyle}
      dataSlot="toolcraft-number-input-control"
    >
      <div className="relative min-w-0">
        {leading ? (
          <span className="pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2 items-center text-fg-muted">
            {leading}
          </span>
        ) : null}
        <input
          id={inputId}
          aria-label={fieldLabel ? undefined : inputAriaLabel}
          autoFocus={autoFocus || hasAutoFocus}
          disabled={resolvedDisabled}
          inputMode="decimal"
          max={max}
          min={min}
          placeholder={placeholder}
          required={required || isRequired}
          step={step}
          type="number"
          value={draft}
          onBlur={() => commitDraft()}
          onChange={(event) => {
            const nextDraft = event.target.value
            setDraft(nextDraft)
            const parsed = Number.parseFloat(nextDraft)
            if (Number.isFinite(parsed)) {
              onChange?.(parsed)
            }
          }}
          onFocus={() => setEditing(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commitDraft(event.currentTarget.value)
              event.currentTarget.blur()
            }
            if (event.key === "Escape") {
              event.preventDefault()
              setDraft(String(normalizedValue))
              setEditing(false)
              event.currentTarget.blur()
            }
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault()
              stepDraft(event.key === "ArrowUp" ? 1 : -1)
            }
          }}
          className={cn(
            toolcraftInputClassName,
            "font-mono tabular-nums",
            size === "sm" && "h-7 text-[12px]",
            size === "lg" && "h-9 text-[14px]",
            leading && "pl-8",
            resolvedUnit && "pr-9",
            inputClassName,
          )}
          {...inputProps}
        />
        {resolvedUnit ? (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-fg-muted">
            {resolvedUnit}
          </span>
        ) : null}
      </div>
    </ToolcraftFieldFrame>
  )
}

export function ToolcraftSelectControl<T extends string = string>({
  ariaLabel,
  className,
  disabled = false,
  hasSearch: _hasSearch = false,
  id,
  inputClassName,
  isDisabled = false,
  isLabelHidden = false,
  label,
  onChange,
  options,
  placeholder,
  searchPlaceholder: _searchPlaceholder,
  size,
  value,
  width,
}: ToolcraftSelectControlProps<T>): React.JSX.Element {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const fieldLabel = isLabelHidden ? undefined : label
  const hiddenLabel = isLabelHidden ? getReactNodeText(label).trim() : ""
  const inputAriaLabel =
    ariaLabel ?? (hiddenLabel !== "" ? hiddenLabel : undefined) ?? placeholder ?? "Select option"
  const resolvedDisabled = disabled || isDisabled
  const fieldStyle = width
    ? { width: typeof width === "number" ? `${width}px` : width }
    : undefined
  const flatOptions = flattenSelectOptions(options)
  const sectionTitles = options
    .filter(isSelectSection)
    .map((option) => option.title)

  return (
    <ToolcraftFieldFrame
      className={className}
      controlId={inputId}
      label={fieldLabel}
      style={fieldStyle}
      dataSlot="toolcraft-select-control"
    >
      <div className="relative min-w-0">
        <select
          id={inputId}
          aria-label={fieldLabel ? undefined : inputAriaLabel}
          disabled={resolvedDisabled}
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          className={cn(
            toolcraftInputClassName,
            "cursor-pointer appearance-none pr-8 disabled:cursor-not-allowed",
            size === "sm" && "h-7 text-[12px]",
            size === "lg" && "h-9 text-[14px]",
            inputClassName,
          )}
        >
          {placeholder && !flatOptions.some((option) => option.value === "") ? (
            <option value="">{placeholder}</option>
          ) : null}
          {options.map((option, index) =>
            isSelectSection(option) ? (
              <optgroup key={`section-${option.title}-${index}`} label={option.title}>
                {option.options.map((sectionOption) =>
                  renderSelectOption(sectionOption, `${option.title}-`, onChange),
                )}
              </optgroup>
            ) : (
              renderSelectOption(option, "", onChange)
            ),
          )}
        </select>
        {sectionTitles.length > 0 ? (
          <div aria-hidden className="sr-only">
            {sectionTitles.map((title) => (
              <span key={title}>{title}</span>
            ))}
          </div>
        ) : null}
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
        />
      </div>
    </ToolcraftFieldFrame>
  )
}

function isSelectSection<T extends string>(
  option: ToolcraftSelectEntry<T>,
): option is ToolcraftOptionSection<T> {
  return "type" in option && option.type === "section"
}

function flattenSelectOptions<T extends string>(
  options: readonly ToolcraftSelectEntry<T>[],
): ToolcraftOption<T>[] {
  return options.flatMap((option) =>
    isSelectSection(option) ? [...option.options] : [option],
  )
}

function renderSelectOption<T extends string>(
  option: ToolcraftOption<T>,
  keyPrefix = "",
  onSelect?: (value: T) => void,
): React.ReactNode {
  return (
    <option
      key={`${keyPrefix}${option.value}`}
      disabled={option.disabled}
      onClick={() => onSelect?.(option.value)}
      value={option.value}
    >
      {option.label}
    </option>
  )
}

function ToolcraftFieldFrame({
  children,
  className,
  controlId,
  dataSlot,
  label,
  style,
}: {
  children: React.ReactNode
  className?: string
  controlId: string
  dataSlot: string
  label?: React.ReactNode
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <div
      className={cn("astryx-field min-w-0 space-y-1.5", className)}
      data-slot={dataSlot}
      style={style}
    >
      {label ? (
        <label
          htmlFor={controlId}
          className="block truncate text-[11px] font-medium text-text-secondary"
        >
          {label}
        </label>
      ) : null}
      {children}
    </div>
  )
}

const toolcraftInputClassName =
  "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"

function clamp(value: number, min?: number, max?: number): number {
  let nextValue = value
  if (typeof min === "number" && Number.isFinite(min)) {
    nextValue = Math.max(min, nextValue)
  }
  if (typeof max === "number" && Number.isFinite(max)) {
    nextValue = Math.min(max, nextValue)
  }
  return nextValue
}

function getReactNodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(getReactNodeText).join("")
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getReactNodeText(node.props.children)
  }

  return ""
}
