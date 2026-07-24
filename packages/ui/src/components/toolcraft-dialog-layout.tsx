import * as React from "react"
import { X } from "lucide-react"

import {
  Dialog as DialogRoot,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog"
import { cn } from "../lib/utils"

export interface ToolcraftDialogProps {
  children: React.ReactNode
  className?: string
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  purpose?: string
  width?: number | string
}

export function ToolcraftDialog({
  children,
  className,
  isOpen,
  onOpenChange,
  width = 512,
}: ToolcraftDialogProps) {
  return (
    <DialogRoot open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className={cn(
          "!p-0 gap-0 overflow-hidden border-border bg-bg-1 text-fg shadow-xl",
          className,
        )}
        style={{
          maxWidth: toCssSize(width),
          width: "calc(100vw - 32px)",
        }}
      >
        {children}
      </DialogContent>
    </DialogRoot>
  )
}

export interface ToolcraftDialogHeaderProps {
  className?: string
  endContent?: React.ReactNode
  onOpenChange?: (open: boolean) => void
  startContent?: React.ReactNode
  subtitle?: React.ReactNode
  title: React.ReactNode
}

export function ToolcraftDialogHeader({
  className,
  endContent,
  onOpenChange,
  startContent,
  subtitle,
  title,
}: ToolcraftDialogHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b border-border bg-bg-1 px-5 py-4",
        className,
      )}
    >
      {startContent ? (
        <span className="mt-0.5 flex shrink-0 items-center justify-center">
          {startContent}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <DialogTitle className="truncate text-[15px] font-semibold leading-5 text-fg">
          {title}
        </DialogTitle>
        {subtitle ? (
          <DialogDescription className="mt-1 text-[12px] leading-4 text-fg-muted">
            {subtitle}
          </DialogDescription>
        ) : null}
      </div>
      {endContent ? (
        <span className="flex shrink-0 items-center justify-center">
          {endContent}
        </span>
      ) : null}
      {onOpenChange ? (
        <button
          type="button"
          aria-label="Close dialog"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-fg-muted transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpenChange(false)}
        >
          <X size={15} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

export interface ToolcraftLayoutProps {
  children?: React.ReactNode
  className?: string
  content?: React.ReactNode
  footer?: React.ReactNode
  header?: React.ReactNode
}

export function ToolcraftLayout({
  children,
  className,
  content,
  footer,
  header,
}: ToolcraftLayoutProps) {
  return (
    <div className={cn("flex max-h-[90vh] min-h-0 flex-col", className)}>
      {header}
      {content ?? children}
      {footer}
    </div>
  )
}

export interface ToolcraftLayoutContentProps
  extends React.HTMLAttributes<HTMLDivElement> {}

export function ToolcraftLayoutContent({
  className,
  ...props
}: ToolcraftLayoutContentProps) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-auto p-4", className)}
      {...props}
    />
  )
}

export interface ToolcraftLayoutFooterProps
  extends React.HTMLAttributes<HTMLDivElement> {
  hasDivider?: boolean
}

export function ToolcraftLayoutFooter({
  className,
  hasDivider = false,
  ...props
}: ToolcraftLayoutFooterProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-2 bg-bg-1 px-5 py-4",
        hasDivider && "border-t border-border",
        className,
      )}
      {...props}
    />
  )
}

function toCssSize(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value
}
