import * as React from "react"
import { ChevronRight } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible"
import { cn } from "../lib/utils"

export interface ToolcraftCollapsibleProps {
  children: React.ReactNode
  className?: string
  contentClassName?: string
  defaultIsOpen?: boolean
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  trigger: React.ReactNode
  triggerClassName?: string
}

export function ToolcraftCollapsible({
  children,
  className,
  contentClassName,
  defaultIsOpen = false,
  isOpen,
  onOpenChange,
  trigger,
  triggerClassName,
}: ToolcraftCollapsibleProps) {
  return (
    <Collapsible
      className={className}
      defaultOpen={defaultIsOpen}
      open={isOpen}
      onOpenChange={onOpenChange}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-bg-2",
            triggerClassName,
          )}
        >
          <span className="min-w-0">{trigger}</span>
          <ChevronRight
            size={12}
            className="shrink-0 text-fg-muted transition-transform group-data-[state=open]:rotate-90"
            aria-hidden
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className={contentClassName}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
