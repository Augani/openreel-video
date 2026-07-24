import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftHeadingProps
  extends React.HTMLAttributes<HTMLHeadingElement> {
  color?: "primary" | "secondary" | string
  level?: 1 | 2 | 3 | 4 | 5 | 6
}

export function ToolcraftHeading({
  children,
  className,
  color = "primary",
  level = 2,
  ...props
}: ToolcraftHeadingProps): React.JSX.Element {
  const Component = `h${level}` as const

  return React.createElement(
    Component,
    {
      className: cn(
        "font-semibold tracking-normal",
        headingLevelClassName[level],
        headingColorClassName[color] ?? headingColorClassName.primary,
        className,
      ),
      ...props,
    },
    children,
  )
}

const headingLevelClassName: Record<NonNullable<ToolcraftHeadingProps["level"]>, string> = {
  1: "text-xl leading-7",
  2: "text-base leading-6",
  3: "text-sm leading-5",
  4: "text-sm leading-5",
  5: "text-xs leading-4",
  6: "text-xs leading-4",
}

const headingColorClassName: Record<string, string> = {
  primary: "text-fg",
  secondary: "text-fg-2",
}
