import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftSelectableCardProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "disabled" | "onChange"
  > {
  children?: React.ReactNode
  disabled?: boolean
  isDisabled?: boolean
  isSelected?: boolean
  label: string
  onChange?: () => void
  padding?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | number
  variant?: string
}

export const ToolcraftSelectableCard = React.forwardRef<
  HTMLButtonElement,
  ToolcraftSelectableCardProps
>(
  (
    {
      children,
      className,
      disabled,
      isDisabled = false,
      isSelected = false,
      label,
      onChange,
      onClick,
      padding = 3,
      role,
      type = "button",
      variant = "default",
      ...props
    },
    ref,
  ) => {
    const resolvedDisabled = disabled || isDisabled

    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-checked={isSelected}
        disabled={resolvedDisabled}
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented) {
            onChange?.()
          }
        }}
        className={cn(
          "group/toolcraft-selectable-card min-w-0 rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          selectableVariantClassName[variant] ?? selectableVariantClassName.default,
          isSelected && "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
          paddingClassName[padding],
          className,
        )}
        data-selected={isSelected ? "true" : undefined}
        data-toolcraft-selectable-card=""
        role={role ?? "checkbox"}
        {...props}
      >
        {children}
      </button>
    )
  },
)

ToolcraftSelectableCard.displayName = "ToolcraftSelectableCard"

const selectableVariantClassName: Record<string, string> = {
  default: "border-border bg-bg-1 text-fg hover:bg-bg-2",
  green: "border-status-success/25 bg-status-success/10 text-fg hover:bg-status-success/15",
  muted: "border-transparent bg-bg-2 text-fg hover:bg-bg-3",
  red: "border-status-error/25 bg-status-error/10 text-fg hover:bg-status-error/15",
  transparent: "border-transparent bg-transparent text-fg hover:bg-bg-2",
}

const paddingClassName: Record<number, string> = {
  0: "p-0",
  1: "p-1",
  2: "p-2",
  3: "p-3",
  4: "p-4",
  5: "p-5",
  6: "p-6",
}
