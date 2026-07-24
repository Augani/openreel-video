import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftCardProps
  extends React.HTMLAttributes<HTMLDivElement> {
  height?: number | string
  padding?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | number
  variant?: string
  width?: number | string
}

export const ToolcraftCard = React.forwardRef<HTMLDivElement, ToolcraftCardProps>(
  (
    {
      children,
      className,
      height,
      padding = 3,
      style,
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
      <div
        ref={ref}
        className={cn(
          "min-w-0 rounded-[7px] border",
          cardVariantClassName[variant] ?? cardVariantClassName.default,
          paddingClassName[padding],
          className,
        )}
        style={resolvedStyle}
        data-toolcraft-card=""
        {...props}
      >
        {children}
      </div>
    )
  },
)

ToolcraftCard.displayName = "ToolcraftCard"

const cardVariantClassName: Record<string, string> = {
  blue: "border-accent/25 bg-accent/10 text-fg",
  default: "border-border bg-bg-1 text-fg",
  green: "border-status-success/25 bg-status-success/10 text-fg",
  muted: "border-transparent bg-bg-2 text-fg",
  red: "border-status-error/25 bg-status-error/10 text-fg",
  transparent: "border-transparent bg-transparent text-fg",
  yellow: "border-status-warning/25 bg-status-warning/10 text-fg",
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
