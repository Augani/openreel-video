import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "../lib/utils"

export interface ToolcraftPanelSectionProps {
  action?: React.ReactNode
  bodyClassName?: string
  children: React.ReactNode
  className?: string
  collapsed?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
  headerClassName?: string
  icon?: React.ReactNode
  onCollapsedChange?: (collapsed: boolean) => void
  sectionId?: string
  title: React.ReactNode
}

export function ToolcraftPanelSection({
  action,
  bodyClassName,
  children,
  className,
  collapsed: controlledCollapsed,
  collapsible = true,
  defaultCollapsed = false,
  headerClassName,
  icon,
  onCollapsedChange,
  sectionId,
  title,
}: ToolcraftPanelSectionProps): React.JSX.Element {
  const [uncontrolledCollapsed, setUncontrolledCollapsed] =
    React.useState(defaultCollapsed)
  const collapsed = controlledCollapsed ?? uncontrolledCollapsed
  const titleText = getReactNodeText(title).trim() || "section"
  const collapseLabel = collapsed
    ? `Expand ${titleText} section`
    : `Collapse ${titleText} section`

  const toggleCollapsed = React.useCallback(() => {
    if (!collapsible) return
    const nextCollapsed = !collapsed
    if (controlledCollapsed === undefined) {
      setUncontrolledCollapsed(nextCollapsed)
    }
    onCollapsedChange?.(nextCollapsed)
  }, [collapsed, collapsible, controlledCollapsed, onCollapsedChange])

  return (
    <section
      className={cn(
        "group/toolcraft-panel-section border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-[color:color-mix(in_oklab,var(--fg)_3%,transparent)]",
        className,
      )}
      data-collapsed={collapsible ? String(collapsed) : undefined}
      data-section-id={sectionId}
      data-toolcraft-panel-section=""
    >
      <div
        className={cn(
          "flex min-h-10 min-w-0 items-center justify-between gap-2 px-3.5 py-2.5",
          collapsible && "cursor-pointer select-none",
          headerClassName,
        )}
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        aria-label={collapsible ? collapseLabel : undefined}
        onClick={toggleCollapsed}
        onKeyDown={(event) => {
          if (!collapsible || (event.key !== "Enter" && event.key !== " ")) {
            return
          }
          event.preventDefault()
          toggleCollapsed()
        }}
        data-slot="toolcraft-panel-section-header"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <ChevronRight
            size={13}
            aria-hidden
            className={cn(
              "shrink-0 text-fg-muted transition-transform duration-150 group-hover/toolcraft-panel-section:text-fg-3",
              !collapsed && "rotate-90",
            )}
          />
          {icon ? (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted">
              {icon}
            </span>
          ) : null}
          <span className="min-w-0 truncate text-[13px] font-semibold text-fg">
            {title}
          </span>
        </div>
        {action ? (
          <div
            className="inline-flex shrink-0 items-center gap-1"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {action}
          </div>
        ) : null}
      </div>
      <ToolcraftPanelSectionBody collapsed={Boolean(collapsible && collapsed)}>
        <div className={cn("space-y-3 px-3.5 pb-4", bodyClassName)}>
          {children}
        </div>
      </ToolcraftPanelSectionBody>
    </section>
  )
}

function ToolcraftPanelSectionBody({
  children,
  collapsed,
}: {
  children: React.ReactNode
  collapsed: boolean
}): React.JSX.Element | null {
  const [shouldRender, setShouldRender] = React.useState(!collapsed)
  const [isVisuallyCollapsed, setIsVisuallyCollapsed] = React.useState(collapsed)
  const suppressTransitions = useInitialControlTransitionSuppression(
    `${collapsed ? "collapsed" : "expanded"}:${shouldRender ? "mounted" : "unmounted"}`,
  )

  React.useEffect(() => {
    if (collapsed) {
      setIsVisuallyCollapsed(true)
      return
    }

    if (shouldRender) {
      setIsVisuallyCollapsed(false)
      return
    }

    setShouldRender(true)
    setIsVisuallyCollapsed(true)
    const frame = window.requestAnimationFrame(() => {
      setIsVisuallyCollapsed(false)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [collapsed, shouldRender])

  if (!shouldRender) {
    return null
  }

  return (
    <div
      aria-hidden={collapsed ? "true" : undefined}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none",
        isVisuallyCollapsed
          ? "pointer-events-none grid-rows-[0fr] opacity-0"
          : "grid-rows-[1fr] opacity-100",
      )}
      data-collapsed={String(collapsed)}
      data-slot="toolcraft-panel-section-body"
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && collapsed) {
          setShouldRender(false)
        }
      }}
    >
      <div
        className="min-h-0 overflow-hidden"
        data-toolcraft-controls-mounting={suppressTransitions ? "true" : undefined}
      >
        {children}
      </div>
    </div>
  )
}

function useInitialControlTransitionSuppression(dependency: unknown): boolean {
  const [suppressionState, setSuppressionState] = React.useState(() => ({
    dependency,
    isSuppressing: true,
  }))

  React.useEffect(() => {
    setSuppressionState({ dependency, isSuppressing: true })

    if (typeof window === "undefined") return undefined

    if (typeof window.requestAnimationFrame !== "function") {
      const timeout = window.setTimeout(() => {
        setSuppressionState({ dependency, isSuppressing: false })
      }, 0)

      return () => window.clearTimeout(timeout)
    }

    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setSuppressionState({ dependency, isSuppressing: false })
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [dependency])

  return (
    suppressionState.dependency !== dependency || suppressionState.isSuppressing
  )
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
