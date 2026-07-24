import * as React from "react"

import {
  Popover as PopoverRoot,
  PopoverContent,
  PopoverTrigger,
} from "./popover"
import { cn } from "../lib/utils"

type ToolcraftPopoverPlacement =
  | "above"
  | "below"
  | "start"
  | "end"
  | "top"
  | "bottom"
  | "left"
  | "right"

type ToolcraftPopoverAlignment = "start" | "center" | "end"

export interface ToolcraftPopoverProps {
  alignment?: ToolcraftPopoverAlignment
  children: React.ReactNode
  className?: string
  content: React.ReactNode
  isOpen?: boolean
  label?: string
  onOpenChange?: (open: boolean) => void
  placement?: ToolcraftPopoverPlacement
  width?: number | string
}

export function ToolcraftPopover({
  alignment = "center",
  children,
  className,
  content,
  isOpen,
  label,
  onOpenChange,
  placement = "below",
  width,
}: ToolcraftPopoverProps) {
  return (
    <PopoverRoot open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={alignment}
        aria-label={label}
        side={toSide(placement)}
        className={cn("!w-auto !p-0 overflow-hidden", className)}
        style={width ? { width: toCssSize(width) } : undefined}
      >
        {content}
      </PopoverContent>
    </PopoverRoot>
  )
}

function toSide(placement: ToolcraftPopoverPlacement) {
  switch (placement) {
    case "above":
    case "top":
      return "top"
    case "start":
    case "left":
      return "left"
    case "end":
    case "right":
      return "right"
    case "below":
    case "bottom":
    default:
      return "bottom"
  }
}

function toCssSize(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value
}
