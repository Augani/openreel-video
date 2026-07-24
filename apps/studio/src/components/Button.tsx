import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Variant = "default" | "primary" | "ghost";
type Size = "default" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: boolean;
}

const VARIANT: Record<Variant, string> = {
  default: "border-border bg-elev1 text-text-primary hover:bg-hover",
  primary: "border-accent bg-accent text-white hover:brightness-110",
  ghost: "border-transparent bg-transparent text-text-secondary hover:bg-hover hover:text-text-primary",
};

export function Button({ variant = "default", size = "default", icon = false, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-6 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-2.5 text-[11px]",
        VARIANT[variant],
        size === "sm" && "h-[22px] px-2 py-0.5 text-[10px]",
        icon && "grid w-6 place-items-center px-0",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
