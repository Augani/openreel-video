import * as React from "react"

import { cn } from "../lib/utils"

export type ToolcraftBadgeVariant =
  | "accent"
  | "danger"
  | "neutral"
  | "success"
  | "warning"

export interface ToolcraftBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  label: React.ReactNode
  variant?: ToolcraftBadgeVariant
}

export function ToolcraftBadge({
  className,
  label,
  variant = "neutral",
  ...props
}: ToolcraftBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center rounded-[5px] border px-1.5 text-[10px] font-semibold leading-none",
        badgeVariantClassName[variant],
        className,
      )}
      data-toolcraft-badge=""
      {...props}
    >
      <span className="truncate">{label}</span>
    </span>
  )
}

const badgeVariantClassName: Record<ToolcraftBadgeVariant, string> = {
  accent: "border-accent/30 bg-accent-soft text-accent",
  danger: "border-status-error/30 bg-status-error/10 text-status-error",
  neutral: "border-border bg-bg-2 text-fg-2",
  success: "border-status-success/30 bg-status-success/10 text-status-success",
  warning: "border-status-warning/30 bg-status-warning/10 text-status-warning",
}
