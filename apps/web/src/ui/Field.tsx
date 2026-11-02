import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  trailing?: ReactNode;
  leading?: ReactNode;
}

/** 6px radius, 1px border at rest, 1.5px accent on focus. 16px font prevents iOS focus zoom. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, hint, error, trailing, leading, className, id, ...rest }, ref) {
  const inputId = id ?? (typeof label === "string" ? `f-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <label className={cn("block", className)} htmlFor={inputId}>
      {label != null && <span className="block text-footnote text-secondary mb-1.5">{label}</span>}
      <span className={cn("flex items-center gap-2 h-11 px-3 rounded-sm bg-surface-2 border border-transparent focus-within:border-accent focus-within:bg-surface transition-colors duration-150", Boolean(error) && "border-danger")}>
        {leading}
        <input ref={ref} id={inputId} className="flex-1 min-w-0 h-full text-body outline-none bg-transparent" {...rest} />
        {trailing}
      </span>
      {error != null ? <span className="block text-footnote text-danger-text mt-1.5">{error}</span> : hint != null ? <span className="block text-footnote text-tertiary mt-1.5">{hint}</span> : null}
    </label>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode }>(function TextArea({ label, className, ...rest }, ref) {
  return (
    <label className={cn("block", className)}>
      {label != null && <span className="block text-footnote text-secondary mb-1.5">{label}</span>}
      <textarea ref={ref} className="w-full min-h-[88px] p-3 rounded-sm bg-surface-2 border border-transparent focus:border-accent focus:bg-surface outline-none text-body resize-y transition-colors duration-150" {...rest} />
    </label>
  );
});

/** A row-style field inside an inset group: label on the left, input on the right. */
export function FieldRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("row-sep relative flex items-center min-h-[44px] pl-[var(--gutter)] pr-[var(--gutter)] gap-3 bg-surface", className)}>
      <span className="text-body text-primary shrink-0">{label}</span>
      <div className="flex-1 min-w-0 flex justify-end items-center">{children}</div>
    </div>
  );
}

/** Native switch; iOS plays its own haptic. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cn("relative w-[51px] h-[31px] rounded-full transition-colors duration-200 shrink-0", checked ? "bg-success" : "bg-border")}>
      <span className={cn("absolute top-[2px] left-[2px] w-[27px] h-[27px] rounded-full bg-white shadow-thumb transition-transform duration-200", checked && "translate-x-[20px]")} style={{ transitionTimingFunction: "var(--ease-out)" }} />
    </button>
  );
}

export function Chip({ children, selected, onClick, className, color }: { children: ReactNode; selected?: boolean; onClick?: () => void; className?: string; color?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-7 px-2.5 rounded-xs text-caption-1 font-medium whitespace-nowrap transition-colors duration-100 active:opacity-70", selected ? "bg-primary text-canvas" : "bg-surface-2 text-secondary", className)} style={color && !selected ? { color } : undefined}>
      {children}
    </button>
  );
}
