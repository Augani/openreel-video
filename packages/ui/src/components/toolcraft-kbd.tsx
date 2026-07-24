import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftKbdProps
  extends React.HTMLAttributes<HTMLElement> {
  keys: string
}

export function ToolcraftKbd({
  className,
  keys,
  ...props
}: ToolcraftKbdProps): React.JSX.Element {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-bg-2 px-1.5 font-mono text-[10px] font-semibold uppercase leading-none text-fg-2 shadow-sm",
        className,
      )}
      {...props}
    >
      {keys}
    </kbd>
  )
}
