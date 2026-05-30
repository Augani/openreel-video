import * as React from "react"
import { Slider } from "./slider"
import { cn } from "@openreel/ui/lib/utils"

export interface LabeledSliderProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  defaultValue?: number
  className?: string
}

const LabeledSlider = React.forwardRef<HTMLDivElement, LabeledSliderProps>(
  ({ label, value, onChange, min = 0, max = 100, step = 1, unit = "", defaultValue, className }, ref) => {
    const displayValue = step < 1 ? value.toFixed(1) : Math.round(value)
    const [editing, setEditing] = React.useState(false)
    const [draft, setDraft] = React.useState("")
    const clickTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const enterEdit = () => {
      setDraft(String(value))
      setEditing(true)
    }

    const clamp = (n: number) => Math.min(max, Math.max(min, n))
    const commit = () => {
      const parsed = parseFloat(draft)
      if (!Number.isNaN(parsed)) onChange(clamp(parsed))
      setEditing(false)
    }

    return (
      <div ref={ref} className={cn("space-y-1", className)}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary">{label}</span>
          {editing ? (
            <input
              autoFocus
              type="number"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit()
                if (e.key === "Escape") setEditing(false)
              }}
              className="w-14 text-[10px] font-mono text-text-primary bg-background-tertiary px-1 py-0.5 rounded border border-border text-right"
            />
          ) : (
            <span
              role="button"
              tabIndex={0}
              title={defaultValue !== undefined ? "Click to edit, double-click to reset" : "Click to edit"}
              onClick={() => {
                if (defaultValue === undefined) {
                  enterEdit()
                  return
                }
                if (clickTimer.current) clearTimeout(clickTimer.current)
                clickTimer.current = setTimeout(() => {
                  enterEdit()
                  clickTimer.current = null
                }, 200)
              }}
              onDoubleClick={() => {
                if (defaultValue === undefined) return
                if (clickTimer.current) {
                  clearTimeout(clickTimer.current)
                  clickTimer.current = null
                }
                onChange(defaultValue)
              }}
              className="text-[10px] font-mono text-text-primary bg-background-tertiary px-1.5 py-0.5 rounded border border-border cursor-text select-none"
            >
              {displayValue}
              {unit}
            </span>
          )}
        </div>
        <Slider
          value={[value]}
          onValueChange={(values) => onChange(values[0])}
          min={min}
          max={max}
          step={step}
          className="h-1.5"
        />
      </div>
    )
  }
)
LabeledSlider.displayName = "LabeledSlider"

export interface InspectorSliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
}

const InspectorSlider = React.forwardRef<HTMLDivElement, InspectorSliderProps>(
  ({ value, onChange, min = 0, max = 100, step = 1, className }, ref) => {
    return (
      <div ref={ref} className={cn("flex items-center gap-3", className)}>
        <Slider
          value={[value]}
          onValueChange={(values) => onChange(values[0])}
          min={min}
          max={max}
          step={step}
          className="flex-1 h-1.5"
        />
        <span className="text-[10px] font-mono text-text-primary w-8 text-right bg-background-tertiary px-1 py-0.5 rounded border border-border">
          {Math.round(value)}
        </span>
      </div>
    )
  }
)
InspectorSlider.displayName = "InspectorSlider"

export { LabeledSlider, InspectorSlider }
