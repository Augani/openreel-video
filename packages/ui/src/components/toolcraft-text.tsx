import * as React from "react"

import { cn } from "../lib/utils"

export type ToolcraftTextType =
  | "body"
  | "code"
  | "label"
  | "large"
  | "supporting"
  | "title"
export type ToolcraftTextColor =
  | "active"
  | "danger"
  | "disabled"
  | "inherit"
  | "muted"
  | "primary"
  | "secondary"
  | "success"
export type ToolcraftTextWeight = "bold" | "medium" | "regular" | "semibold"
export type ToolcraftTextDisplay = "block" | "inline" | "inline-block"
export type ToolcraftTextJustify = "center" | "left" | "right"

export interface ToolcraftTextProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "color"> {
  as?: React.ElementType
  children?: React.ReactNode
  className?: string
  color?: ToolcraftTextColor
  display?: ToolcraftTextDisplay
  justify?: ToolcraftTextJustify
  maxLines?: number
  type?: ToolcraftTextType
  weight?: ToolcraftTextWeight
}

export function ToolcraftText({
  as: Component = "span",
  children,
  className,
  color = "secondary",
  display,
  justify,
  maxLines,
  style,
  type = "body",
  weight = "regular",
  ...props
}: ToolcraftTextProps): React.JSX.Element {
  const maxLinesStyle =
    typeof maxLines === "number" && maxLines > 0
      ? {
          WebkitBoxOrient: "vertical" as const,
          WebkitLineClamp: maxLines,
          display: "-webkit-box",
        }
      : undefined

  return React.createElement(
    Component,
    {
      className: cn(
        textTypeClassName[type],
        textColorClassName[color],
        textWeightClassName[weight],
        display && displayClassName[display],
        justify && justifyClassName[justify],
        typeof maxLines === "number" && maxLines > 0 && "overflow-hidden",
        className,
      ),
      style: maxLinesStyle ? { ...style, ...maxLinesStyle } : style,
      ...props,
    },
    children,
  )
}

const textTypeClassName: Record<ToolcraftTextType, string> = {
  body: "text-[13px] leading-5",
  code: "font-mono text-[12px] leading-5",
  label: "text-[12px] leading-4",
  large: "text-[15px] leading-5",
  supporting: "text-[12px] leading-5",
  title: "text-[14px] leading-5",
}

const textColorClassName: Record<ToolcraftTextColor, string> = {
  active: "text-accent",
  danger: "text-status-error",
  disabled: "text-fg-muted",
  inherit: "text-inherit",
  muted: "text-fg-muted",
  primary: "text-fg",
  secondary: "text-fg-2",
  success: "text-status-success",
}

const textWeightClassName: Record<ToolcraftTextWeight, string> = {
  bold: "font-bold",
  medium: "font-medium",
  regular: "font-normal",
  semibold: "font-semibold",
}

const displayClassName: Record<ToolcraftTextDisplay, string> = {
  block: "block",
  inline: "inline",
  "inline-block": "inline-block",
}

const justifyClassName: Record<ToolcraftTextJustify, string> = {
  center: "text-center",
  left: "text-left",
  right: "text-right",
}
