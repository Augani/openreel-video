import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftSliderProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "disabled" | "max" | "min" | "onChange" | "step" | "type" | "value"
  > {
  disabled?: boolean
  isDisabled?: boolean
  isLabelHidden?: boolean
  label: React.ReactNode
  max?: number
  min?: number
  onChange?: (value: number) => void
  orientation?: "horizontal" | "vertical"
  step?: number
  value: number
  valueDisplay?: "auto" | "none"
}

export const ToolcraftSlider = React.forwardRef<
  HTMLInputElement,
  ToolcraftSliderProps
>(
  (
    {
      className,
      disabled = false,
      isDisabled = false,
      isLabelHidden = false,
      label,
      max = 100,
      min = 0,
      onChange,
      orientation = "horizontal",
      step = 1,
      value,
      valueDisplay = "auto",
      ...props
    },
    ref,
  ) => {
    const labelText = getReactNodeText(label).trim() || "Slider"
    const resolvedDisabled = disabled || isDisabled

    return (
      <label className={cn("min-w-0", isLabelHidden && "contents")}>
        {!isLabelHidden ? (
          <span className="mb-1 block truncate text-[11px] font-medium text-fg-muted">
            {label}
          </span>
        ) : null}
        <input
          ref={ref}
          aria-label={isLabelHidden ? labelText : undefined}
          aria-orientation={orientation}
          className={cn(
            "accent-accent disabled:pointer-events-none disabled:opacity-50",
            className,
          )}
          disabled={resolvedDisabled}
          max={max}
          min={min}
          step={step}
          type="range"
          value={value}
          onChange={(event) => onChange?.(Number(event.currentTarget.value))}
          {...props}
        />
        {valueDisplay !== "none" ? (
          <span className="sr-only">{value}</span>
        ) : null}
      </label>
    )
  },
)

ToolcraftSlider.displayName = "ToolcraftSlider"

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
