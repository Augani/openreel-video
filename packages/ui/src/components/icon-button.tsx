import * as React from "react"
import { Button, type ButtonProps } from "./button"
import { cn } from "@openreel/ui/lib/utils"

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  icon: React.ElementType
  iconSize?: number
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, iconSize = 14, className, variant = "ghost", size = "icon-xs", ...props }, ref) => {
    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        className={cn(
          "text-text-secondary hover:text-text-primary hover:bg-background-elevated",
          className
        )}
        {...props}
      >
        <Icon size={iconSize} />
      </Button>
    )
  }
)
IconButton.displayName = "IconButton"

export { IconButton }
