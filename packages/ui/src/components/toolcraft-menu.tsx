import * as React from "react"
import { ChevronDown } from "lucide-react"

import {
  ContextMenu as ContextMenuRoot,
  ContextMenuContent,
  ContextMenuItem as ContextMenuPrimitiveItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu"
import {
  DropdownMenu as DropdownMenuRoot,
  DropdownMenuContent,
  DropdownMenuItem as DropdownMenuPrimitiveItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import { ToolcraftButton, type ToolcraftButtonProps } from "./toolcraft-button"
import { ToolcraftIconButton } from "./toolcraft-icon-button"
import { cn } from "../lib/utils"

type ToolcraftMenuPlacement =
  | "above"
  | "below"
  | "start"
  | "end"
  | "top"
  | "bottom"
  | "left"
  | "right"

type ToolcraftMenuAlignment = "start" | "center" | "end"

type ToolcraftMenuSize = "sm" | "md" | "lg" | string

type ToolcraftMenuButtonConfig = Omit<ToolcraftButtonProps, "children"> & {
  isIconOnly?: boolean
}

type ToolcraftMenuActionItem = {
  className?: string
  description?: React.ReactNode
  endContent?: React.ReactNode
  icon?: React.ReactNode
  isDisabled?: boolean
  label: React.ReactNode
  onClick?: () => void
  type?: "item"
}

type ToolcraftMenuDividerItem = {
  type: "divider"
}

type ToolcraftMenuSectionItem = {
  items: ToolcraftMenuOption[]
  title?: React.ReactNode
  type: "section"
}

export type ToolcraftMenuOption =
  | ToolcraftMenuActionItem
  | ToolcraftMenuDividerItem
  | ToolcraftMenuSectionItem

export type ToolcraftDropdownMenuOption = ToolcraftMenuOption
export type ToolcraftContextMenuOption = ToolcraftMenuOption

export interface ToolcraftDropdownMenuProps {
  alignment?: ToolcraftMenuAlignment
  button?: ToolcraftMenuButtonConfig
  children?: React.ReactNode
  className?: string
  hasChevron?: boolean
  isMenuOpen?: boolean
  items?: ToolcraftDropdownMenuOption[]
  menuWidth?: number | string
  onOpenChange?: (open: boolean) => void
  placement?: ToolcraftMenuPlacement
  size?: ToolcraftMenuSize
}

export function ToolcraftDropdownMenu({
  alignment = "center",
  button,
  children,
  className,
  hasChevron = false,
  isMenuOpen,
  items,
  menuWidth,
  onOpenChange,
  placement = "below",
  size = "md",
}: ToolcraftDropdownMenuProps) {
  return (
    <DropdownMenuRoot open={isMenuOpen} onOpenChange={onOpenChange}>
      {button ? (
        <DropdownMenuTrigger asChild>
          {renderMenuButton(button, hasChevron)}
        </DropdownMenuTrigger>
      ) : null}
      <DropdownMenuContent
        align={alignment}
        side={toSide(placement)}
        className={cn("min-w-40", className)}
        style={menuWidth ? { width: toCssSize(menuWidth) } : undefined}
      >
        {children ?? renderDropdownOptions(items ?? [], size)}
      </DropdownMenuContent>
    </DropdownMenuRoot>
  )
}

export interface ToolcraftDropdownMenuItemProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitiveItem>,
    "children" | "disabled" | "onClick"
  > {
  description?: React.ReactNode
  endContent?: React.ReactNode
  icon?: React.ReactNode
  isDisabled?: boolean
  label: React.ReactNode
  onClick?: () => void
  size?: ToolcraftMenuSize
}

export const ToolcraftDropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitiveItem>,
  ToolcraftDropdownMenuItemProps
>(
  (
    {
      className,
      description,
      endContent,
      icon,
      isDisabled = false,
      label,
      onClick,
      onSelect,
      size = "md",
      ...props
    },
    ref,
  ) => (
    <DropdownMenuPrimitiveItem
      ref={ref}
      className={cn(menuItemSizeClassName[size] ?? menuItemSizeClassName.md, className)}
      disabled={isDisabled}
      onSelect={(event) => {
        onSelect?.(event)
        if (!event.defaultPrevented) {
          onClick?.()
        }
      }}
      {...props}
    >
      {renderItemContent({ description, endContent, icon, label })}
    </DropdownMenuPrimitiveItem>
  ),
)

ToolcraftDropdownMenuItem.displayName = "ToolcraftDropdownMenuItem"

export interface ToolcraftContextMenuProps {
  children: React.ReactNode
  className?: string
  items?: ToolcraftContextMenuOption[]
  menuWidth?: number | string
  size?: ToolcraftMenuSize
}

export function ToolcraftContextMenu({
  children,
  className,
  items = [],
  menuWidth,
  size = "md",
}: ToolcraftContextMenuProps) {
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className={cn("min-w-40", className)}
        style={menuWidth ? { width: toCssSize(menuWidth) } : undefined}
      >
        {renderContextOptions(items, size)}
      </ContextMenuContent>
    </ContextMenuRoot>
  )
}

export interface ToolcraftContextMenuItemProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof ContextMenuPrimitiveItem>,
    "children" | "disabled" | "onClick"
  > {
  description?: React.ReactNode
  endContent?: React.ReactNode
  icon?: React.ReactNode
  isDisabled?: boolean
  label: React.ReactNode
  onClick?: () => void
  size?: ToolcraftMenuSize
}

export const ToolcraftContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitiveItem>,
  ToolcraftContextMenuItemProps
>(
  (
    {
      className,
      description,
      endContent,
      icon,
      isDisabled = false,
      label,
      onClick,
      onSelect,
      size = "md",
      ...props
    },
    ref,
  ) => (
    <ContextMenuPrimitiveItem
      ref={ref}
      className={cn(menuItemSizeClassName[size] ?? menuItemSizeClassName.md, className)}
      disabled={isDisabled}
      onSelect={(event) => {
        onSelect?.(event)
        if (!event.defaultPrevented) {
          onClick?.()
        }
      }}
      {...props}
    >
      {renderItemContent({ description, endContent, icon, label })}
    </ContextMenuPrimitiveItem>
  ),
)

ToolcraftContextMenuItem.displayName = "ToolcraftContextMenuItem"

const menuItemSizeClassName: Record<string, string> = {
  lg: "px-3 py-2 text-sm",
  md: "px-2 py-1.5 text-sm",
  sm: "px-2 py-1 text-xs",
}

function renderDropdownOptions(
  options: ToolcraftDropdownMenuOption[],
  size: ToolcraftMenuSize,
): React.ReactNode {
  return options.map((option, index) => {
    if (option.type === "divider") {
      return <DropdownMenuSeparator key={`divider-${index}`} />
    }

    if (option.type === "section") {
      return (
        <React.Fragment key={`section-${index}`}>
          {option.title ? (
            <DropdownMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-wide text-fg-muted">
              {option.title}
            </DropdownMenuLabel>
          ) : null}
          {renderDropdownOptions(option.items, size)}
        </React.Fragment>
      )
    }

    return (
      <ToolcraftDropdownMenuItem
        key={`item-${index}`}
        description={option.description}
        endContent={option.endContent}
        icon={option.icon}
        isDisabled={option.isDisabled}
        label={option.label}
        onClick={option.onClick}
        size={size}
        className={option.className}
      />
    )
  })
}

function renderContextOptions(
  options: ToolcraftContextMenuOption[],
  size: ToolcraftMenuSize,
): React.ReactNode {
  return options.map((option, index) => {
    if (option.type === "divider") {
      return <ContextMenuSeparator key={`divider-${index}`} />
    }

    if (option.type === "section") {
      return (
        <React.Fragment key={`section-${index}`}>
          {option.title ? (
            <ContextMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-wide text-fg-muted">
              {option.title}
            </ContextMenuLabel>
          ) : null}
          {renderContextOptions(option.items, size)}
        </React.Fragment>
      )
    }

    return (
      <ToolcraftContextMenuItem
        key={`item-${index}`}
        description={option.description}
        endContent={option.endContent}
        icon={option.icon}
        isDisabled={option.isDisabled}
        label={option.label}
        onClick={option.onClick}
        size={size}
        className={option.className}
      />
    )
  })
}

function renderItemContent({
  description,
  endContent,
  icon,
  label,
}: Pick<ToolcraftMenuActionItem, "description" | "endContent" | "icon" | "label">) {
  return (
    <>
      {icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate">{label}</span>
        {description ? (
          <span className="min-w-0 truncate text-[11px] font-normal text-fg-muted">
            {description}
          </span>
        ) : null}
      </span>
      {endContent ? (
        <span className="ml-auto flex shrink-0 items-center justify-center text-fg-muted">
          {endContent}
        </span>
      ) : null}
    </>
  )
}

function renderMenuButton(
  button: ToolcraftMenuButtonConfig,
  hasChevron: boolean,
): React.ReactElement {
  const {
    endContent,
    icon,
    isIconOnly = false,
    label = "Open menu",
    ...buttonProps
  } = button
  const labelText = getReactNodeText(label).trim() || "Open menu"

  if (isIconOnly && icon) {
    return (
      <ToolcraftIconButton
        {...buttonProps}
        icon={icon}
        label={labelText}
      />
    )
  }

  return (
    <ToolcraftButton
      {...buttonProps}
      endContent={
        endContent ??
        (hasChevron ? <ChevronDown size={12} aria-hidden /> : undefined)
      }
      icon={icon}
      label={label}
    />
  )
}

function toSide(placement: ToolcraftMenuPlacement) {
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

function getReactNodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(getReactNodeText).join("")
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getReactNodeText(node.props.children)
  }

  return ""
}
