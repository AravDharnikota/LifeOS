import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "plain" | "destructive" | "danger-filled";
type Size = "md" | "lg" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  full?: boolean;
  leading?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent active:brightness-90",
  secondary: "bg-surface-2 text-primary active:bg-pressed",
  plain: "text-accent-text active:opacity-60 px-2",
  destructive: "text-danger-text active:opacity-60 px-2",
  "danger-filled": "bg-danger text-white active:brightness-90",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-subhead font-semibold",
  md: "h-11 px-5 text-headline",
  lg: "h-[50px] px-5 text-headline",
};

/** Three styles only (primary, secondary, plain) plus destructive. Labels are verbs in Title Case. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", loading, full, leading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn("pressable inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap select-none", variants[variant], sizes[size], full && "w-full", (disabled || loading) && "opacity-40 pointer-events-none", className)}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : leading}
      <span className={cn(loading && "invisible")}>{children}</span>
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tinted?: boolean;
}

/** 44x44 hit area, 22px glyph. Tinted only when it is the screen's primary action. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, tinted, className, children, ...rest }, ref) {
  return (
    <button ref={ref} type="button" aria-label={label} title={label} className={cn("hit-44 inline-flex items-center justify-center rounded-md active:bg-pressed transition-colors duration-100", tinted ? "text-accent-text" : "text-primary", className)} {...rest}>
      {children}
    </button>
  );
});
