import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftClickableCardProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  active?: boolean
  children?: React.ReactNode
  height?: number | string
  isDisabled?: boolean
  label: string
  padding?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | number
  variant?: "default" | "muted" | "selected" | "transparent" | string
  width?: number | string
}

export const ToolcraftClickableCard = React.forwardRef<
  HTMLButtonElement,
  ToolcraftClickableCardProps
>(
  (
    {
      active = false,
      children,
      className,
      disabled,
      height,
      isDisabled = false,
      label,
      padding = 3,
      style,
      type = "button",
      variant = "default",
      width,
      ...props
    },
    ref,
  ) => {
    const resolvedStyle = {
      ...style,
      ...(width ? { width: typeof width === "number" ? `${width}px` : width } : null),
      ...(height ? { height: typeof height === "number" ? `${height}px` : height } : null),
    }

    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        disabled={disabled || isDisabled}
        className={cn(
          "group/toolcraft-clickable-card min-w-0 rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          variant === "default" && "border-border bg-bg-1 hover:bg-bg-2",
          variant === "muted" && "border-transparent bg-bg-2 hover:bg-bg-3",
          variant === "transparent" && "border-transparent bg-transparent hover:bg-bg-2",
          (variant === "selected" || active) &&
            "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
          paddingClassName[padding],
          className,
        )}
        data-active={active ? "true" : undefined}
        data-toolcraft-clickable-card=""
        style={resolvedStyle}
        {...props}
      >
        {children}
      </button>
    )
  },
)

ToolcraftClickableCard.displayName = "ToolcraftClickableCard"

const paddingClassName: Record<number, string> = {
  0: "p-0",
  1: "p-1",
  2: "p-2",
  3: "p-3",
  4: "p-4",
  5: "p-5",
  6: "p-6",
}
