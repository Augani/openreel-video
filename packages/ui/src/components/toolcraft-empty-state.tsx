import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftEmptyStateProps {
  action?: React.ReactNode
  className?: string
  description?: React.ReactNode
  icon?: React.ReactNode
  isCompact?: boolean
  title: React.ReactNode
}

export function ToolcraftEmptyState({
  action,
  className,
  description,
  icon,
  isCompact = false,
  title,
}: ToolcraftEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center justify-center text-center text-fg-muted",
        isCompact ? "gap-2 px-3 py-5" : "gap-3 px-6 py-10",
        className,
      )}
    >
      {icon ? <div className="flex items-center justify-center">{icon}</div> : null}
      <div className="space-y-1">
        <p className={cn("font-semibold text-fg-2", isCompact ? "text-xs" : "text-sm")}>
          {title}
        </p>
        {description ? (
          <p className={cn("text-fg-muted", isCompact ? "text-[11px]" : "text-xs")}>
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  )
}
