import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  color?: "primary" | "secondary" | "muted" | string
  isExternalLink?: boolean
  label?: string
}

export function ToolcraftLink({
  children,
  className,
  color = "primary",
  isExternalLink = false,
  label,
  target,
  rel,
  ...props
}: ToolcraftLinkProps): React.JSX.Element {
  return (
    <a
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        linkColorClassName[color] ?? linkColorClassName.primary,
        className,
      )}
      target={isExternalLink ? target ?? "_blank" : target}
      rel={isExternalLink ? rel ?? "noreferrer" : rel}
      {...props}
    >
      {children ?? label}
    </a>
  )
}

const linkColorClassName: Record<string, string> = {
  muted: "text-fg-muted hover:text-fg",
  primary: "text-accent hover:text-accent/85",
  secondary: "text-fg-2 hover:text-fg",
}
