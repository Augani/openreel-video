import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftProgressBarProps
  extends React.HTMLAttributes<HTMLDivElement> {
  hasValueLabel?: boolean
  isLabelHidden?: boolean
  label?: string
  max?: number
  value: number
  variant?: string
}

export function ToolcraftProgressBar({
  className,
  hasValueLabel = false,
  isLabelHidden = false,
  label = "Progress",
  max = 100,
  value,
  variant = "accent",
  ...props
}: ToolcraftProgressBarProps): React.JSX.Element {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0

  return (
    <div className={cn("min-w-0 space-y-1.5", className)} {...props}>
      {(!isLabelHidden || hasValueLabel) && (
        <div className="flex items-center justify-between gap-3 text-[11px] font-medium text-fg-muted">
          {!isLabelHidden ? <span className="truncate">{label}</span> : <span />}
          {hasValueLabel ? <span className="shrink-0 font-mono">{Math.round(percent)}%</span> : null}
        </div>
      )}
      <div
        aria-label={label}
        aria-valuemax={max}
        aria-valuemin={0}
        aria-valuenow={value}
        className="h-1.5 overflow-hidden rounded-full bg-bg-3"
        role="progressbar"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            progressVariantClassName[variant] ?? progressVariantClassName.accent,
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

const progressVariantClassName: Record<string, string> = {
  accent: "bg-accent",
  error: "bg-status-error",
  success: "bg-status-success",
  warning: "bg-status-warning",
}
