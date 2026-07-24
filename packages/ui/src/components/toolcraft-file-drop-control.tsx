import * as React from "react"
import { Loader2, UploadCloud } from "lucide-react"

import { cn } from "../lib/utils"

export interface ToolcraftFileDropControlProps {
  accept?: string
  className?: string
  description?: React.ReactNode
  disabled?: boolean
  icon?: React.ReactNode
  isDisabled?: boolean
  isLabelHidden?: boolean
  isLoading?: boolean
  label: React.ReactNode
  mode?: "dropzone" | "input" | "button"
  multiple?: boolean
  onChange?: (files: File | File[] | null) => void
  onFileSelect?: (file: File) => void
  onFilesSelect?: (files: File[]) => void
  placeholder?: React.ReactNode
  style?: React.CSSProperties
  triggerClassName?: string
  value?: File | File[] | null
  variant?: "button" | "dropzone"
  width?: number | string
}

export const ToolcraftFileDropControl = React.forwardRef<
  HTMLInputElement,
  ToolcraftFileDropControlProps
>(
  (
    {
      accept,
      className,
      description,
      disabled = false,
      icon,
      isDisabled = false,
      isLoading = false,
      label,
      mode,
      multiple = false,
      onChange,
      onFileSelect,
      onFilesSelect,
      placeholder,
      style,
      triggerClassName,
      value,
      variant = "dropzone",
      width,
    },
    ref,
  ) => {
    const localInputRef = React.useRef<HTMLInputElement>(null)
    const [dragOver, setDragOver] = React.useState(false)
    const resolvedDisabled = disabled || isDisabled || isLoading
    const resolvedVariant = mode === "input" || mode === "button" ? "button" : variant

    React.useImperativeHandle(ref, () => localInputRef.current as HTMLInputElement)

    const displayLabel = getDisplayLabel({ label, placeholder, value })
    const labelText = getReactNodeText(label).trim() || getReactNodeText(displayLabel).trim() || "Import file"

    const handleFiles = React.useCallback(
      (fileList: FileList | readonly File[] | null | undefined) => {
        const files = Array.from(fileList ?? [])

        if (files.length === 0) {
          onChange?.(null)
          return
        }

        if (multiple) {
          onFilesSelect?.(files)
          onChange?.(files)
          if (!onFilesSelect) {
            files.forEach((file) => onFileSelect?.(file))
          }
          return
        }

        const file = files[0]
        if (!file) return
        onFileSelect?.(file)
        onChange?.(file)
      },
      [multiple, onChange, onFileSelect, onFilesSelect],
    )

    const openFileDialog = React.useCallback(() => {
      if (resolvedDisabled) return
      localInputRef.current?.click()
    }, [resolvedDisabled])

    const onDrop = React.useCallback(
      (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault()
        setDragOver(false)
        if (resolvedDisabled) return
        handleFiles(event.dataTransfer?.files)
      },
      [resolvedDisabled, handleFiles],
    )

    const onKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        openFileDialog()
      },
      [openFileDialog],
    )

    return (
      <div
        className={cn("min-w-0", className)}
        data-toolcraft-file-drop-control=""
        style={{
          width: width ? toCssSize(width) : undefined,
          ...style,
        }}
      >
        <input
          ref={localInputRef}
          accept={accept}
          aria-hidden="true"
          className="hidden"
          disabled={resolvedDisabled}
          multiple={multiple}
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            handleFiles(event.currentTarget.files)
            event.currentTarget.value = ""
          }}
        />
        <div
          aria-disabled={resolvedDisabled ? "true" : undefined}
          aria-label={labelText}
          className={cn(
            "flex min-w-0 cursor-pointer items-center justify-center gap-2 rounded-[7px] border border-dashed border-border bg-bg-2 text-center text-[12px] font-semibold text-fg-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            resolvedVariant === "dropzone" && "min-h-16 flex-col px-3 py-3",
            resolvedVariant === "button" && "h-8 border-solid px-2.5",
            dragOver && "border-accent bg-selected text-accent",
            resolvedDisabled && "cursor-not-allowed opacity-50",
            triggerClassName,
          )}
          data-drag-over={dragOver ? "true" : undefined}
          onClick={openFileDialog}
          onDragEnter={(event) => {
            event.preventDefault()
            if (!resolvedDisabled) setDragOver(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragOver(false)
            }
          }}
          onDragOver={(event) => {
            event.preventDefault()
            if (!resolvedDisabled) setDragOver(true)
          }}
          onDrop={onDrop}
          onKeyDown={onKeyDown}
          role="button"
          tabIndex={resolvedDisabled ? -1 : 0}
        >
          <span className="flex shrink-0 items-center justify-center text-fg-muted">
            {isLoading ? (
              <Loader2
                size={resolvedVariant === "button" ? 14 : 17}
                className="animate-spin"
                aria-hidden
              />
            ) : (
              icon ?? <UploadCloud size={resolvedVariant === "button" ? 14 : 17} aria-hidden />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate">{displayLabel}</span>
            {description && resolvedVariant === "dropzone" ? (
              <span className="mt-0.5 block text-[11px] font-medium leading-4 text-fg-muted">
                {description}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    )
  },
)

ToolcraftFileDropControl.displayName = "ToolcraftFileDropControl"

function getDisplayLabel({
  label,
  placeholder,
  value,
}: {
  label: React.ReactNode
  placeholder?: React.ReactNode
  value?: File | File[] | null
}) {
  if (value instanceof File) {
    return value.name
  }

  if (Array.isArray(value) && value.length > 0) {
    return value.length === 1 ? value[0].name : `${value.length} files selected`
  }

  return placeholder ?? label
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
