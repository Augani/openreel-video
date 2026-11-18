import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@openreel/ui/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, "aria-label": ariaLabel, "aria-valuetext": ariaValueText, "aria-valuemin": ariaValueMin, "aria-valuemax": ariaValueMax, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    data-slot="slider"
    className={cn(
      "relative flex w-full touch-none select-none items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5 data-[orientation=vertical]:flex-col",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-background-tertiary data-[orientation=vertical]:h-full">
      <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-text-secondary data-[orientation=vertical]:h-auto data-[orientation=vertical]:w-full" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      aria-label={ariaLabel}
      aria-valuetext={ariaValueText}
      {...(ariaValueMin === undefined ? {} : { "aria-valuemin": ariaValueMin })}
      {...(ariaValueMax === undefined ? {} : { "aria-valuemax": ariaValueMax })}
      aria-disabled={props.disabled || undefined}
      className="block h-2.5 w-2.5 rounded-full bg-white shadow-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
