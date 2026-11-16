"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@openreel/ui/lib/utils"

interface TabsContextValue {
  activeValue: string | undefined
}

const TabsContext = React.createContext<TabsContextValue>({ activeValue: undefined })

interface TabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  defaultValue?: string
  value?: string
}

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  TabsProps
>(({ value, defaultValue, onValueChange, children, ...props }, ref) => {
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const activeValue = value ?? internalValue

  const handleValueChange = React.useCallback((newValue: string) => {
    setInternalValue(newValue)
    onValueChange?.(newValue)
  }, [onValueChange])

  return (
    <TabsContext.Provider value={{ activeValue }}>
      <TabsPrimitive.Root
        ref={ref}
        value={activeValue}
        onValueChange={handleValueChange}
        {...props}
      >
        {children}
      </TabsPrimitive.Root>
    </TabsContext.Provider>
  )
})
Tabs.displayName = "Tabs"

interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  layoutId?: string
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, layoutId: _layoutId, children, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground relative",
      className
    )}
    {...props}
  >
    {children}
  </TabsPrimitive.List>
))
TabsList.displayName = TabsPrimitive.List.displayName

interface TabsTriggerProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {}

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, value, children, ...props }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 relative z-10 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.Trigger>
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    asChild
    {...props}
  >
    <div
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
    >
      {children}
    </div>
  </TabsPrimitive.Content>
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
