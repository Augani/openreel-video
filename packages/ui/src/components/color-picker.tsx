"use client"

import * as React from "react"
import { Check, Slash } from "lucide-react"

import { cn } from "@openreel/ui/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { Slider } from "./slider"

interface ParsedColor {
  hex: string
  alpha: number
  isTransparent: boolean
}

export interface ColorPickerProps {
  value: string
  onChange: (value: string) => void
  showAlpha?: boolean
  allowTransparent?: boolean
  disabled?: boolean
  className?: string
}

const DEFAULT_HEX = "#000000"
const TRANSPARENT = "transparent"
const CHECKERBOARD_BACKGROUND =
  "linear-gradient(45deg, rgba(148, 163, 184, 0.35) 25%, transparent 25%, transparent 75%, rgba(148, 163, 184, 0.35) 75%), linear-gradient(45deg, rgba(148, 163, 184, 0.35) 25%, transparent 25%, transparent 75%, rgba(148, 163, 184, 0.35) 75%)"
const CHECKERBOARD_STYLE = {
  backgroundImage: CHECKERBOARD_BACKGROUND,
  backgroundPosition: "0 0, 4px 4px",
  backgroundSize: "8px 8px",
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")
}

function normalizeHex(hex: string): string | null {
  const value = hex.trim()
  if (!value.startsWith("#")) {
    return null
  }

  const body = value.slice(1)
  if (/^[0-9a-fA-F]{3}$/.test(body)) {
    return `#${body
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`
  }

  if (/^[0-9a-fA-F]{4}$/.test(body)) {
    return `#${body
      .slice(0, 3)
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`
  }

  if (/^[0-9a-fA-F]{6}$/.test(body)) {
    return `#${body.toLowerCase()}`
  }

  if (/^[0-9a-fA-F]{8}$/.test(body)) {
    return `#${body.slice(0, 6).toLowerCase()}`
  }

  return null
}

function parseRgbChannel(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.slice(0, -1))
    if (Number.isNaN(percent)) {
      return null
    }
    return clamp((percent / 100) * 255, 0, 255)
  }

  const channel = Number.parseFloat(trimmed)
  return Number.isNaN(channel) ? null : clamp(channel, 0, 255)
}

function parseAlphaChannel(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.slice(0, -1))
    if (Number.isNaN(percent)) {
      return null
    }
    return clamp(percent / 100, 0, 1)
  }

  const alpha = Number.parseFloat(trimmed)
  return Number.isNaN(alpha) ? null : clamp(alpha, 0, 1)
}

function parseColor(value: string): ParsedColor {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === TRANSPARENT) {
    return { hex: DEFAULT_HEX, alpha: 0, isTransparent: true }
  }

  const hex = normalizeHex(normalized)
  if (hex) {
    const body = normalized.slice(1)
    const alpha =
      body.length === 4
        ? parseInt(`${body[3]}${body[3]}`, 16) / 255
        : body.length === 8
          ? parseInt(body.slice(6, 8), 16) / 255
          : 1

    return { hex, alpha, isTransparent: false }
  }

  const rgbMatch = normalized.match(
    /^rgba?\(\s*([^\s,]+)\s*,\s*([^\s,]+)\s*,\s*([^\s,\/\)]+)(?:\s*[,\/]\s*([^\s\)]+))?\s*\)$/,
  )
  if (rgbMatch) {
    const red = parseRgbChannel(rgbMatch[1])
    const green = parseRgbChannel(rgbMatch[2])
    const blue = parseRgbChannel(rgbMatch[3])
    const alpha = rgbMatch[4] ? parseAlphaChannel(rgbMatch[4]) : 1

    if (
      red !== null &&
      green !== null &&
      blue !== null &&
      alpha !== null
    ) {
      return {
        hex: `#${toHex(red)}${toHex(green)}${toHex(blue)}`,
        alpha,
        isTransparent: false,
      }
    }
  }

  return { hex: DEFAULT_HEX, alpha: 1, isTransparent: false }
}

function formatAlpha(alpha: number): string {
  if (alpha <= 0) {
    return "0"
  }

  if (alpha >= 1) {
    return "1"
  }

  return alpha.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

function formatColor(hex: string, alpha: number, useAlpha: boolean): string {
  if (useAlpha && alpha <= 0) {
    return TRANSPARENT
  }

  if (!useAlpha || alpha >= 1) {
    return hex
  }

  const red = parseInt(hex.slice(1, 3), 16)
  const green = parseInt(hex.slice(3, 5), 16)
  const blue = parseInt(hex.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${formatAlpha(alpha)})`
}

export const ColorPicker = React.forwardRef<HTMLButtonElement, ColorPickerProps>(
  (
    {
      value,
      onChange,
      showAlpha = false,
      allowTransparent = false,
      disabled = false,
      className,
    },
    ref,
  ) => {
    const parsed = React.useMemo(() => parseColor(value), [value])
    const [isOpen, setIsOpen] = React.useState(false)
    const [textValue, setTextValue] = React.useState(value || "")

    React.useEffect(() => {
      setTextValue(value || "")
    }, [value])

    const committedValue = React.useMemo(
      () => formatColor(parsed.hex, parsed.alpha, showAlpha),
      [parsed.alpha, parsed.hex, showAlpha],
    )

    const commit = React.useCallback(
      (nextHex: string, nextAlpha: number, nextTransparent = false) => {
        if (allowTransparent && nextTransparent) {
          onChange(TRANSPARENT)
          return
        }

        onChange(formatColor(nextHex, nextAlpha, showAlpha))
      },
      [allowTransparent, onChange, showAlpha],
    )

    const handleColorChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        commit(
          event.target.value,
          showAlpha ? (parsed.isTransparent ? 1 : Math.max(parsed.alpha, 0)) : 1,
        )
      },
      [commit, parsed.alpha, parsed.isTransparent, showAlpha],
    )

    const handleAlphaChange = React.useCallback(
      ([nextAlpha]: number[]) => {
        commit(parsed.hex, nextAlpha)
      },
      [commit, parsed.hex],
    )

    const handleTextChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const nextValue = event.target.value
        setTextValue(nextValue)

        if (allowTransparent && nextValue.trim().toLowerCase() === TRANSPARENT) {
          onChange(TRANSPARENT)
          return
        }

        const nextParsed = parseColor(nextValue)
        const normalizedHex = normalizeHex(nextValue)
        const isRgbString = /^rgba?\(/i.test(nextValue.trim())

        if (normalizedHex || isRgbString) {
          onChange(formatColor(nextParsed.hex, nextParsed.alpha, showAlpha))
        }
      },
      [allowTransparent, onChange, showAlpha],
    )

    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md border border-border bg-background-tertiary px-2 text-left text-[10px] text-text-primary transition-colors hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
          >
            <span
              className="relative h-4 w-4 shrink-0 overflow-hidden rounded border border-border"
              style={CHECKERBOARD_STYLE}
            >
              {!parsed.isTransparent && (
                <span
                  className="absolute inset-0"
                  style={{
                    backgroundColor: parsed.hex,
                    opacity: showAlpha ? parsed.alpha : 1,
                  }}
                />
              )}
              {parsed.isTransparent && (
                <Slash className="absolute inset-0 m-auto h-3 w-3 text-text-muted" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono uppercase text-text-muted">
              {parsed.isTransparent ? TRANSPARENT : committedValue}
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-64 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                Color
              </span>
              {allowTransparent && (
                <button
                  type="button"
                  onClick={() => commit(parsed.hex, 0, true)}
                  className="text-[10px] text-text-muted transition-colors hover:text-text-primary"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span
                className="relative h-10 w-10 overflow-hidden rounded-md border border-border"
                style={CHECKERBOARD_STYLE}
              >
                {!parsed.isTransparent && (
                  <span
                    className="absolute inset-0"
                    style={{
                      backgroundColor: parsed.hex,
                      opacity: showAlpha ? parsed.alpha : 1,
                    }}
                  />
                )}
              </span>

              <input
                type="color"
                value={parsed.hex}
                onChange={handleColorChange}
                className="h-10 w-full cursor-pointer rounded-md border border-border bg-background"
              />
            </div>
          </div>

          {showAlpha && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] text-text-secondary">
                <span className="font-medium uppercase tracking-wide">Opacity</span>
                <span className="font-mono text-text-muted">
                  {Math.round(parsed.alpha * 100)}%
                </span>
              </div>
              <Slider
                value={[parsed.alpha]}
                onValueChange={handleAlphaChange}
                min={0}
                max={1}
                step={0.01}
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-[10px] font-medium uppercase tracking-wide text-text-secondary">
              Value
            </label>
            <input
              type="text"
              value={textValue}
              onChange={handleTextChange}
              placeholder={allowTransparent ? "#000000 or transparent" : "#000000"}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-mono text-text-primary outline-none transition-colors focus:border-primary"
            />
          </div>

          {allowTransparent && parsed.isTransparent && (
            <div className="flex items-center gap-1 text-[10px] text-text-muted">
              <Check className="h-3 w-3" />
              Transparent background is active
            </div>
          )}
        </PopoverContent>
      </Popover>
    )
  },
)

ColorPicker.displayName = "ColorPicker"
