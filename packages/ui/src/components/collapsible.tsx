"use client"

import * as React from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { motion, AnimatePresence } from "motion/react"

import { cn } from "@openreel/ui/lib/utils"

type CollapsibleContextValue = {
  open: boolean
}

const CollapsibleContext = React.createContext<CollapsibleContextValue>({ open: false })

interface CollapsibleProps extends React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Root> {
  defaultOpen?: boolean
}

const Collapsible = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Root>,
  CollapsibleProps
>(({ open: controlledOpen, onOpenChange, defaultOpen = false, children, ...props }, ref) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const isOpen = controlledOpen ?? internalOpen

  const handleOpenChange = React.useCallback((newOpen: boolean) => {
    setInternalOpen(newOpen)
    onOpenChange?.(newOpen)
  }, [onOpenChange])

  return (
    <CollapsibleContext.Provider value={{ open: isOpen }}>
      <CollapsiblePrimitive.Root
        ref={ref}
        open={isOpen}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </CollapsiblePrimitive.Root>
    </CollapsibleContext.Provider>
  )
})
Collapsible.displayName = "Collapsible"

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

interface CollapsibleContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleContent>, 'forceMount'> {}

const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof motion.div>,
  CollapsibleContentProps
>(({ className, children, ...props }, ref) => {
  const { open } = React.useContext(CollapsibleContext)

  return (
    <AnimatePresence initial={false}>
      {open && (
        <CollapsiblePrimitive.CollapsibleContent forceMount asChild {...props}>
          <motion.div
            ref={ref}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { type: "spring", stiffness: 500, damping: 40 },
              opacity: { duration: 0.15 }
            }}
            className={cn("overflow-hidden", className)}
          >
            {children}
          </motion.div>
        </CollapsiblePrimitive.CollapsibleContent>
      )}
    </AnimatePresence>
  )
})
CollapsibleContent.displayName = "CollapsibleContent"

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
