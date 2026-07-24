import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "../lib/utils"

export interface ToolcraftSwitchControlProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel?: string
  className?: string
  description?: React.ReactNode
  disabled?: boolean
  label?: React.ReactNode
  labelClassName?: string
  showLabel?: boolean
}

export const ToolcraftSwitchControl = React.forwardRef<
  HTMLButtonElement,
  ToolcraftSwitchControlProps
>(
  (
    {
      checked,
      onCheckedChange,
      ariaLabel,
      className,
      description,
      disabled = false,
      label,
      labelClassName,
      showLabel = true,
    },
    ref,
  ) => {
    const labelText = getReactNodeText(label).trim()
    const switchLabel = ariaLabel ?? (showLabel ? labelText : undefined) ?? "Toggle"

    return (
      <div
        className={cn(
          "flex min-w-0 items-center justify-between gap-3 py-1",
          className,
        )}
        data-toolcraft-switch-control=""
      >
        {showLabel && label ? (
          <span className="min-w-0">
            <span
              className={cn(
                "block truncate text-[12px] font-medium text-fg-2",
                labelClassName,
              )}
            >
              {label}
            </span>
            {description ? (
              <span className="mt-0.5 block text-[11px] leading-4 text-fg-muted">
                {description}
              </span>
            ) : null}
          </span>
        ) : null}
        <SwitchPrimitive.Root
          ref={ref}
          aria-label={switchLabel}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          className={cn(
            "relative inline-flex h-[21px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border p-[2px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent",
            !showLabel && "flex-none",
          )}
        >
          <SwitchPrimitive.Thumb
            className="pointer-events-none block h-[17px] w-[17px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.22)] transition-transform data-[state=checked]:translate-x-[17px] data-[state=unchecked]:translate-x-0"
          />
        </SwitchPrimitive.Root>
      </div>
    )
  },
)

ToolcraftSwitchControl.displayName = "ToolcraftSwitchControl"

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
