import type { JSX } from "react";
import {
  createElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import {
  Button as OpenReelButton,
  ColorPicker,
  cn,
  ToolcraftPanelSection,
  ToolcraftNumberInputControl,
  ToolcraftSegmentedControl,
  ToolcraftSelectControl,
  ToolcraftSliderControl,
  ToolcraftSwitchControl,
  ToolcraftTextAreaControl,
  ToolcraftTextInputControl,
} from "@openreel/ui";
import type { LucideIcon } from "@/icons/lucide-compat";

type IconButtonVariant =
  | "ghost"
  | "solid"
  | "outline"
  | "danger"
  | "secondary"
  | "primary"
  | "destructive";
type IconButtonSize = "sm" | "md";
type ButtonVariant =
  | "ghost"
  | "solid"
  | "outline"
  | "danger"
  | "secondary"
  | "primary"
  | "destructive";
type ButtonSize = "sm" | "md" | "lg";

function mapButtonVariant(variant: ButtonVariant, active = false) {
  return variant === "solid"
    || variant === "primary"
    ? "default"
    : variant === "danger" || variant === "destructive"
      ? "destructive"
      : variant === "secondary"
        ? "secondary"
      : active
        ? "secondary"
        : variant === "outline"
          ? "outline"
          : "ghost";
}

function mapButtonSize(size: ButtonSize) {
  return size === "lg" ? "lg" : size === "md" ? "default" : "sm";
}

function mapIconButtonSize(size: IconButtonSize) {
  return size === "md" ? "icon-sm" : "icon-xs";
}

interface MotionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children?: ReactNode;
  disabled?: boolean;
  endContent?: ReactNode;
  hideLabel?: boolean;
  icon?: LucideIcon | ReactNode;
  isDisabled?: boolean;
  label: string;
  size?: ButtonSize;
  tooltip?: string;
  variant?: ButtonVariant;
}

export function Button({
  label,
  onClick,
  icon: Icon,
  disabled = false,
  isDisabled = false,
  variant = "outline",
  size = "sm",
  className,
  children,
  endContent,
  hideLabel = false,
  tooltip,
  type = "button",
  ...buttonProps
}: MotionButtonProps): JSX.Element {
  return (
    <OpenReelButton
      type={type}
      aria-label={label}
      title={tooltip ?? label}
      size={mapButtonSize(size)}
      variant={mapButtonVariant(variant)}
      disabled={disabled || isDisabled}
      onClick={onClick}
      className={cn("rounded-[7px] text-[12px] font-semibold", className)}
      {...buttonProps}
    >
      {renderIcon(Icon, 14)}
      {children ?? (hideLabel ? null : label)}
      {endContent}
    </OpenReelButton>
  );
}

interface MotionIconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  active?: boolean;
  disabled?: boolean;
  icon: LucideIcon | ReactNode;
  iconSize?: number;
  isDisabled?: boolean;
  label: string;
  onClick?: () => void;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
}

export function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
  isDisabled = false,
  variant = "ghost",
  size = "md",
  iconSize = 16,
  className,
  ...buttonProps
}: MotionIconButtonProps): JSX.Element {
  return (
    <OpenReelButton
      type="button"
      aria-label={label}
      title={label}
      size={mapIconButtonSize(size)}
      variant={mapButtonVariant(variant, active)}
      disabled={disabled || isDisabled}
      onClick={onClick}
      className={cn(
        "rounded-[7px] text-fg-3 hover:text-fg",
        active && "text-fg",
        className,
      )}
      {...buttonProps}
    >
      {renderIcon(Icon, iconSize)}
    </OpenReelButton>
  );
}

function renderIcon(icon: LucideIcon | ReactNode | undefined, size: number): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  return isIconComponent(icon)
    ? createElement(icon, { size, "aria-hidden": true })
    : icon;
}

function isIconComponent(icon: LucideIcon | ReactNode): icon is LucideIcon {
  return (
    typeof icon === "function" ||
    (typeof icon === "object" &&
      icon !== null &&
      "$$typeof" in icon &&
      "render" in icon)
  );
}

export function PanelHeader({
  title,
  icon: Icon,
  actions,
}: {
  title: string;
  icon?: LucideIcon;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3.5">
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon size={14} aria-hidden className="shrink-0 text-fg-muted" /> : null}
        <span className="truncate text-[13px] font-semibold text-fg">{title}</span>
      </div>
      {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  const inputId = useId();
  return (
    <div className="astryx-field min-w-0 space-y-1.5" data-toolcraft-field="">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <label
          htmlFor={inputId}
          className="truncate text-[11px] font-medium text-text-secondary"
        >
          {label}
        </label>
        {hint ? (
          <span className="shrink-0 text-[10.5px] font-medium text-fg-muted">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-h-[8rem] flex-col items-center justify-center gap-2.5 rounded-[7px] border border-dashed border-border bg-bg-2 p-4 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-[7px] border border-border bg-bg-1 text-fg-muted">
        <Icon size={19} aria-hidden />
      </div>
      <div className="space-y-1">
        <div className="text-[13px] font-semibold text-fg">{title}</div>
        {description ? (
          <div className="text-[11px] leading-4 text-fg-muted">{description}</div>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function InlineText({
  children,
  tone = "secondary",
  className,
}: {
  children: ReactNode;
  tone?: "primary" | "secondary" | "disabled" | "active";
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        "text-[12px] leading-5",
        tone === "primary" && "text-fg",
        tone === "secondary" && "text-fg-2",
        tone === "disabled" && "text-fg-muted",
        tone === "active" && "text-accent",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PanelText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <p className={cn("text-[12px] leading-5 text-fg-2", className)}>
      {children}
    </p>
  );
}

export const SectionDefaultsContext = createContext<{ collapseAll?: boolean }>(
  {},
);

export function Section({
  title,
  icon: Icon,
  defaultOpen = true,
  keepOpenInAccordion = false,
  action,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  keepOpenInAccordion?: boolean;
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const { collapseAll } = useContext(SectionDefaultsContext);
  const [open, setOpen] = useState(
    collapseAll ? keepOpenInAccordion : defaultOpen,
  );
  const prevKeepOpen = useRef(keepOpenInAccordion);
  useEffect(() => {
    if (collapseAll && keepOpenInAccordion !== prevKeepOpen.current) {
      setOpen(keepOpenInAccordion);
    }
    prevKeepOpen.current = keepOpenInAccordion;
  }, [collapseAll, keepOpenInAccordion]);
  return (
    <ToolcraftPanelSection
      title={title}
      icon={Icon ? <Icon size={13} aria-hidden /> : undefined}
      action={action}
      collapsed={!open}
      onCollapsedChange={(collapsed) => setOpen(!collapsed)}
    >
      {children}
    </ToolcraftPanelSection>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <ToolcraftTextInputControl
      ariaLabel={placeholder || "Text input"}
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): JSX.Element {
  return (
    <ToolcraftTextAreaControl
      ariaLabel={placeholder || "Text area"}
      rows={3}
      value={value}
      placeholder={placeholder}
      onChange={onChange}
    />
  );
}

export function SelectInput<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: T | "";
  options: Array<{ value: T | ""; label: string }>;
  onChange: (value: T | "") => void;
  placeholder?: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <ToolcraftSelectControl
      ariaLabel={placeholder || "Select option"}
      value={value}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function SwitchInput({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <ToolcraftSwitchControl
      label={label}
      description={description}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  icon: Icon,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}): JSX.Element {
  return (
    <ToolcraftNumberInputControl
      ariaLabel={unit ? `Value in ${unit}` : "Number value"}
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      unit={unit}
      disabled={disabled}
      leading={Icon ? <Icon size={12} aria-hidden /> : undefined}
      onChange={onChange}
    />
  );
}

export function ColorInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}): JSX.Element {
  const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  return (
    <ToolcraftTextInputControl
      ariaLabel="Color value"
      value={value}
      onChange={onChange}
      disabled={disabled}
      inputClassName="font-mono lowercase"
      leading={
        <span
          aria-hidden
          className="block h-4 w-4 rounded-sm border border-border"
          style={{
            background:
              value === "transparent"
                ? "repeating-conic-gradient(var(--bg-3) 0% 25%, transparent 0% 50%) 50% / 8px 8px"
                : isHex
                  ? value
                  : "transparent",
          }}
        />
      }
    />
  );
}

export function ColorSelector({
  value,
  onChange,
  disabled = false,
  label = "Select color",
  allowTransparent = false,
  fallback = "#000000",
  showValue = true,
  showAlpha = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  allowTransparent?: boolean;
  fallback?: string;
  showValue?: boolean;
  showAlpha?: boolean;
}): JSX.Element {
  return (
    <div title={label} className={showValue ? "min-w-[8rem]" : "w-11"}>
      <ColorPicker
        value={value.trim() || fallback}
        onChange={onChange}
        label={label}
        disabled={disabled}
        allowTransparent={allowTransparent}
        showAlpha={showAlpha}
        className={showValue ? "w-full" : "w-11 justify-center px-0 [&>span:last-child]:sr-only"}
      />
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}): JSX.Element {
  return (
    <ToolcraftSliderControl
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      formatValue={(nextValue) =>
        `${Math.round(((nextValue - min) / (max - min)) * 100)}%`
      }
      parseValue={(draft) => {
        const parsed = Number.parseFloat(draft.replace("%", ""));
        return Number.isFinite(parsed) ? min + ((max - min) * parsed) / 100 : null;
      }}
      className="min-w-0 flex-1"
    />
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label?: string; icon?: LucideIcon }>;
  onChange: (value: T) => void;
}): JSX.Element {
  return (
    <ToolcraftSegmentedControl
      ariaLabel="Segmented control"
      value={value}
      onChange={onChange}
      options={options.map((option) => {
        const Icon = option.icon;
        return {
          value: option.value,
          label: option.label,
          icon: Icon ? <Icon size={13} aria-hidden /> : undefined,
        };
      })}
    />
  );
}
