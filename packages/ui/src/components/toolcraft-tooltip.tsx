import * as React from "react"

import {
  Tooltip as TooltipRoot,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip"

type ToolcraftTooltipPlacement =
  | "above"
  | "below"
  | "start"
  | "end"
  | "top"
  | "bottom"
  | "left"
  | "right"

export interface ToolcraftTooltipProps {
  children: React.ReactNode
  content: React.ReactNode
  delayDuration?: number
  placement?: ToolcraftTooltipPlacement
}

export function ToolcraftTooltip({
  children,
  content,
  delayDuration = 300,
  placement = "above",
}: ToolcraftTooltipProps) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <TooltipRoot>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={toSide(placement)}>{content}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  )
}

function toSide(placement: ToolcraftTooltipPlacement) {
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
