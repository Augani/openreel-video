import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftSpinnerProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md" | "lg"
}

export function ToolcraftSpinner({
  className,
  size = "md",
  ...props
}: ToolcraftSpinnerProps): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-current border-r-transparent text-fg-muted",
        spinnerSizeClassName[size],
        className,
      )}
      {...props}
    />
  )
}

const spinnerSizeClassName: Record<NonNullable<ToolcraftSpinnerProps["size"]>, string> = {
  lg: "h-5 w-5",
  md: "h-4 w-4",
  sm: "h-3 w-3",
}
