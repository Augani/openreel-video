import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftIconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  disabled?: boolean
  icon: React.ElementType | React.ReactNode
  iconSize?: number
  isDisabled?: boolean
  label: string
  size?: "sm" | "md" | "lg" | string
  variant?: string
}

export const ToolcraftIconButton = React.forwardRef<
  HTMLButtonElement,
  ToolcraftIconButtonProps
>(
  (
    {
      className,
      disabled,
      icon,
      iconSize = 14,
      isDisabled = false,
      label,
      size = "sm",
      title,
      type = "button",
      variant = "ghost",
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
        title={title ?? label}
        disabled={resolvedDisabled}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          iconButtonSizeClassName[size] ?? iconButtonSizeClassName.sm,
          iconButtonVariantClassName[variant] ?? iconButtonVariantClassName.ghost,
          className,
        )}
        {...props}
      >
        {renderIcon(icon, iconSize)}
      </button>
    )
  },
)

ToolcraftIconButton.displayName = "ToolcraftIconButton"

const iconButtonSizeClassName: Record<string, string> = {
  lg: "h-9 w-9",
  md: "h-8 w-8",
  sm: "h-7 w-7",
}

const iconButtonVariantClassName: Record<string, string> = {
  destructive: "bg-status-error/12 text-status-error hover:bg-status-error/20",
  ghost: "bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg",
  primary: "bg-accent text-accent-fg hover:bg-accent/90",
  secondary: "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg",
}

function renderIcon(
  icon: React.ElementType | React.ReactNode,
  size: number,
): React.ReactNode {
  if (React.isValidElement(icon)) {
    return icon
  }

  if (
    typeof icon === "function" ||
    (typeof icon === "object" && icon !== null && ("render" in icon || "$$typeof" in icon))
  ) {
    return React.createElement(icon as React.ElementType, {
      "aria-hidden": true,
      size,
    })
  }

  return icon
}
