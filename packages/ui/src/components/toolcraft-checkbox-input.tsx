import * as React from "react"

import { Checkbox } from "./checkbox"
import { cn } from "../lib/utils"

export interface ToolcraftCheckboxInputProps {
  className?: string
  isDisabled?: boolean
  label: React.ReactNode
  labelIcon?: React.ReactNode
  onChange: (value: boolean) => void
  value: boolean
}

export function ToolcraftCheckboxInput({
  className,
  isDisabled = false,
  label,
  labelIcon,
  onChange,
  value,
}: ToolcraftCheckboxInputProps): React.JSX.Element {
  const id = React.useId()

  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-2 rounded-[7px] border border-border bg-bg-2 px-2.5 py-2 text-[12px] font-medium text-fg-2 transition-colors hover:bg-bg-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        className,
      )}
    >
      <Checkbox
        id={id}
        checked={value}
        disabled={isDisabled}
        onCheckedChange={(checked) => onChange(Boolean(checked))}
      />
      {labelIcon ? <span className="shrink-0 text-fg-muted">{labelIcon}</span> : null}
      <span className="truncate">{label}</span>
    </label>
  )
}
