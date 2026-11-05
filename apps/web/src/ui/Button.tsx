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

// Primary: solid ink pill (or clinical-blue gradient via className="btn-accent").
// Secondary: frosted glass pill. Plain/destructive: text only.
const variants: Record<Variant, string> = {
  primary: "bg-primary text-canvas shadow-thumb active:opacity-85",
  secondary: "glass text-primary active:bg-pressed",
  plain: "text-accent-text active:opacity-60 px-2",
  destructive: "text-danger-text active:opacity-60 px-2",
  "danger-filled": "bg-danger text-white active:brightness-95",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-[14px] font-medium",
  md: "h-11 px-5 text-[15px] font-medium",
  lg: "h-[52px] px-6 text-[16px] font-medium",
};

/** Pill buttons. Primary is solid ink; secondary is glass. Labels are verbs in Title Case. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", loading, full, leading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn("pressable-spring inline-flex items-center justify-center gap-2 rounded-full whitespace-nowrap select-none", variants[variant], sizes[size], full && "w-full", (disabled || loading) && "opacity-40 pointer-events-none", className)}
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

/** 44x44 hit area. Use className="glass w-10 h-10" for the round frosted header buttons. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, tinted, className, children, ...rest }, ref) {
  return (
    <button ref={ref} type="button" aria-label={label} title={label} className={cn("hit-44 inline-flex items-center justify-center rounded-full active:bg-pressed active:scale-95 transition-[transform,background-color] duration-150", tinted ? "text-accent-text" : "text-primary", className)} {...rest}>
      {children}
    </button>
  );
});
