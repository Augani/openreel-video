import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftSegmentedOption<T extends string = string> {
  icon?: React.ReactNode
  label?: string
  value: T
}

export interface ToolcraftSegmentedControlProps<T extends string = string> {
  ariaLabel?: string
  className?: string
  disabled?: boolean
  onChange: (value: T) => void
  options: readonly ToolcraftSegmentedOption<T>[]
  value: T
}

export function ToolcraftSegmentedControl<T extends string = string>({
  ariaLabel = "Segmented control",
  className,
  disabled = false,
  onChange,
  options,
  value,
}: ToolcraftSegmentedControlProps<T>): React.JSX.Element {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "grid min-h-8 min-w-0 rounded-[7px] border border-border bg-bg-1 p-0.5",
        className,
      )}
      data-toolcraft-segmented-control=""
      role="radiogroup"
      style={{
        gridTemplateColumns: `repeat(${Math.max(options.length, 1)}, minmax(0, 1fr))`,
      }}
    >
      {options.map((option) => {
        const isSelected = option.value === value
        const label = option.label ?? option.value

        return (
          <button
            key={option.value}
            type="button"
            aria-checked={isSelected}
            aria-label={label}
            data-value={option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            role="radio"
            className={cn(
              "inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-[5px] px-2 text-[12px] font-semibold text-fg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              isSelected
                ? "bg-bg-3 text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                : "hover:bg-bg-2 hover:text-fg-2",
            )}
          >
            {option.icon ? (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {option.icon}
              </span>
            ) : null}
            {option.label ? <span className="truncate">{option.label}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
