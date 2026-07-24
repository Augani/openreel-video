import * as React from "react"

import { cn } from "../lib/utils"
import { Slider } from "./slider"

export interface ToolcraftSliderControlProps {
  ariaLabel?: string
  label?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  defaultValue?: number
  disabled?: boolean
  isDisabled?: boolean
  isLabelHidden?: boolean
  className?: string
  sliderClassName?: string
  showValueLabel?: boolean
  formatValue?: (value: number) => string
  parseValue?: (value: string) => number | null
  valueDisplay?: "auto" | "none"
  width?: number | string
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const decimalPlaces = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  const normalized = value.toString().toLowerCase()
  if (normalized.includes("e-")) {
    return Number(normalized.split("e-")[1] ?? 0)
  }
  return normalized.split(".")[1]?.length ?? 0
}

const trimNumber = (value: string): string =>
  value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "")

const snap = (value: number, min: number, step: number): number => {
  if (!Number.isFinite(step) || step <= 0) return value
  const precision = Math.min(Math.max(decimalPlaces(step), decimalPlaces(min)), 6)
  const snapped = min + Math.round((value - min) / step) * step
  return Number(snapped.toFixed(precision))
}

const parseNumericValue = (
  value: string,
  { max, min }: { max: number; min: number },
): number | null => {
  const match = value.trim().match(/-?\d+(?:\.\d+)?/u)
  if (!match) return null
  const parsed = Number.parseFloat(match[0])
  if (!Number.isFinite(parsed)) return null

  if (value.includes("%") && min >= 0 && max <= 1) {
    return min + ((max - min) * parsed) / 100
  }

  return parsed
}

function defaultFormatValue(value: number, step: number, unit?: string): string {
  const precision = step < 1 ? Math.min(Math.max(decimalPlaces(step), 1), 3) : 0
  const formatted =
    precision > 0 ? trimNumber(value.toFixed(precision)) : String(Math.round(value))
  return unit ? `${formatted}${unit}` : formatted
}

export const ToolcraftSliderControl = React.forwardRef<
  HTMLDivElement,
  ToolcraftSliderControlProps
>(
  (
    {
      label,
      ariaLabel,
      value,
      onChange,
      min = 0,
      max = 100,
      step = 1,
      unit,
      defaultValue,
      disabled = false,
      isDisabled = false,
      isLabelHidden = false,
      className,
      sliderClassName,
      showValueLabel = true,
      formatValue,
      parseValue,
      valueDisplay,
      width,
    },
    ref,
  ) => {
    const [editing, setEditing] = React.useState(false)
    const [draft, setDraft] = React.useState("")
    const inputRef = React.useRef<HTMLInputElement>(null)
    const format = React.useCallback(
      (nextValue: number) =>
        formatValue?.(nextValue) ?? defaultFormatValue(nextValue, step, unit),
      [formatValue, step, unit],
    )
    const parse = React.useCallback(
      (nextDraft: string) =>
        parseValue?.(nextDraft) ?? parseNumericValue(nextDraft, { max, min }),
      [max, min, parseValue],
    )

    const resolvedDisabled = disabled || isDisabled
    const resolvedShowValueLabel = valueDisplay === "none" ? false : showValueLabel
    const visibleLabel = isLabelHidden ? undefined : label
    const accessibleLabel = ariaLabel ?? label
    const fieldStyle = width
      ? { width: typeof width === "number" ? `${width}px` : width }
      : undefined
    const normalizedValue = clamp(value, min, max)
    const valueLabel = format(normalizedValue)
    const canReset =
      typeof defaultValue === "number" && Number.isFinite(defaultValue) && !resolvedDisabled

    React.useEffect(() => {
      if (!editing) return
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.select()
    }, [editing])

    const commitValue = React.useCallback(
      (nextValue: number) => {
        const clamped = clamp(snap(nextValue, min, step), min, max)
        onChange(clamped)
      },
      [max, min, onChange, step],
    )

    const beginEditing = React.useCallback(() => {
      if (resolvedDisabled) return
      setDraft(valueLabel)
      setEditing(true)
    }, [resolvedDisabled, valueLabel])

    const commitDraft = React.useCallback(() => {
      const parsed = parse(draft)
      if (typeof parsed === "number") {
        commitValue(parsed)
      }
      setEditing(false)
    }, [commitValue, draft, parse])

    const resetToDefault = React.useCallback(() => {
      if (!canReset) return
      commitValue(defaultValue)
      setEditing(false)
    }, [canReset, commitValue, defaultValue])

    const stepDraft = React.useCallback(
      (direction: -1 | 1) => {
        const parsedDraft = parse(draft)
        const base = typeof parsedDraft === "number" ? parsedDraft : normalizedValue
        const nextValue = clamp(snap(base + direction * step, min, step), min, max)
        setDraft(format(nextValue))
        commitValue(nextValue)
      },
      [commitValue, draft, format, max, min, normalizedValue, parse, step],
    )

    return (
      <div
        ref={ref}
        className={cn("min-w-0 space-y-1.5", className)}
        style={fieldStyle}
      >
        {(visibleLabel || resolvedShowValueLabel) && (
          <div className="flex min-w-0 items-center justify-between gap-3">
            {visibleLabel ? (
              <span className="min-w-0 truncate text-[11px] font-medium text-text-secondary">
                {visibleLabel}
              </span>
            ) : (
              <span aria-hidden className="min-w-0" />
            )}
            {resolvedShowValueLabel && (
              <span className="inline-grid h-5 min-w-[4ch] shrink-0 place-items-center">
                {editing ? (
                  <input
                    ref={inputRef}
                    aria-label={accessibleLabel ? `${accessibleLabel} value` : "Slider value"}
                    value={draft}
                    onBlur={commitDraft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        commitDraft()
                      }
                      if (event.key === "Escape") {
                        event.preventDefault()
                        setEditing(false)
                      }
                      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                        event.preventDefault()
                        stepDraft(event.key === "ArrowUp" ? 1 : -1)
                      }
                    }}
                    className="h-5 w-full min-w-[4ch] rounded border border-border bg-background-tertiary px-1 text-right font-mono text-[11px] leading-5 text-text-primary outline-none focus:border-primary"
                  />
                ) : (
                  <button
                    type="button"
                    aria-label={accessibleLabel ? `Edit ${accessibleLabel} value` : "Edit slider value"}
                    disabled={resolvedDisabled}
                    title={
                      canReset
                        ? "Click to edit, double-click to reset"
                        : "Click to edit"
                    }
                    onClick={beginEditing}
                    onDoubleClick={resetToDefault}
                    className="h-5 min-w-[4ch] cursor-text rounded border border-transparent px-1 text-right font-mono text-[11px] leading-5 tabular-nums text-text-muted transition-colors hover:border-border hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {valueLabel}
                  </button>
                )}
              </span>
            )}
          </div>
        )}
        <Slider
          value={[normalizedValue]}
          onValueChange={(values) => {
            const nextValue = values[0]
            if (typeof nextValue === "number") {
              commitValue(nextValue)
            }
          }}
          min={min}
          max={max}
          step={step}
          disabled={resolvedDisabled}
          aria-label={accessibleLabel}
          className={cn("h-2", sliderClassName)}
        />
      </div>
    )
  },
)

ToolcraftSliderControl.displayName = "ToolcraftSliderControl"
