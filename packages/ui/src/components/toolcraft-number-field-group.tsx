import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftNumberFieldEntry {
  axis: string
  onChange: (next: string) => void
  value: string
}

export interface ToolcraftNumberFieldGroupProps {
  className?: string
  fields: readonly ToolcraftNumberFieldEntry[]
  label: string
}

export function ToolcraftNumberFieldGroup({
  className,
  fields,
  label,
}: ToolcraftNumberFieldGroupProps): React.JSX.Element {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-3", className)}
      data-toolcraft-number-field-group=""
    >
      <span className="w-[90px] flex-none truncate text-[12px] font-medium text-fg-3">
        {label}
      </span>
      <div
        className="grid min-w-0 flex-1 gap-2"
        style={{
          gridTemplateColumns: `repeat(${Math.max(fields.length, 1)}, minmax(0, 1fr))`,
        }}
      >
        {fields.map((field) => {
          return (
            <label
              key={field.axis}
              className="flex min-w-0 items-center gap-1.5 rounded-[7px] border border-border bg-bg-1 px-2 py-1.5 transition-colors focus-within:border-accent"
            >
              <span className="shrink-0 text-[11px] font-semibold uppercase text-fg-muted">
                {field.axis}
              </span>
              <input
                aria-label={`${label} ${field.axis}`}
                inputMode="decimal"
                type="text"
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                className="h-5 w-full min-w-0 bg-transparent text-[12px] font-medium text-fg-2 outline-none"
              />
            </label>
          )
        })}
      </div>
    </div>
  )
}
