import { forwardRef, useEffect, useImperativeHandle, useRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { useSheetSettled } from "./Sheet";

/**
 * autoFocus that waits for the enclosing sheet to finish sliding in, so the keyboard never races the sheet.
 * Outside a sheet it focuses on mount like the native attribute.
 */
function useDeferredAutoFocus<T extends HTMLElement>(autoFocus: boolean | undefined) {
  const ref = useRef<T>(null);
  const whenSettled = useSheetSettled();
  useEffect(() => {
    if (!autoFocus) return;
    return whenSettled(() => ref.current?.focus({ preventScroll: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);
  return ref;
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  trailing?: ReactNode;
  leading?: ReactNode;
}

/** 6px radius, 1px border at rest, 1.5px accent on focus. 16px font prevents iOS focus zoom. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, hint, error, trailing, leading, className, id, autoFocus, ...rest }, ref) {
  const inputId = id ?? (typeof label === "string" ? `f-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  const inner = useDeferredAutoFocus<HTMLInputElement>(autoFocus);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  return (
    <label className={cn("block", className)} htmlFor={inputId}>
      {label != null && <span className="block text-footnote font-medium text-secondary mb-2 pl-1">{label}</span>}
      <span className={cn("flex items-center gap-2 h-12 px-4 rounded-md bg-surface-2 border-[1.5px] border-transparent focus-within:border-accent/50 focus-within:bg-surface-2 focus-within:shadow-[0_0_0_4px_var(--accent-soft)] transition-[background-color,border-color,box-shadow] duration-200", Boolean(error) && "border-danger")}>
        {leading}
        <input ref={inner} id={inputId} className="flex-1 min-w-0 h-full text-body outline-none bg-transparent" {...rest} />
        {trailing}
      </span>
      {error != null ? <span className="block text-footnote text-danger-text mt-1.5">{error}</span> : hint != null ? <span className="block text-footnote text-tertiary mt-1.5">{hint}</span> : null}
    </label>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode }>(function TextArea({ label, className, autoFocus, ...rest }, ref) {
  const inner = useDeferredAutoFocus<HTMLTextAreaElement>(autoFocus);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
  return (
    <label className={cn("block", className)}>
      {label != null && <span className="block text-footnote font-medium text-secondary mb-2 pl-1">{label}</span>}
      <textarea ref={inner} className="w-full min-h-[96px] px-4 py-3 rounded-md bg-surface-2 border-[1.5px] border-transparent focus:border-accent/50 focus:bg-surface-2 focus:shadow-[0_0_0_4px_var(--accent-soft)] outline-none text-body resize-y transition-[background-color,border-color,box-shadow] duration-200" {...rest} />
    </label>
  );
});

/** A row-style field inside an inset group: label on the left, input on the right. */
export function FieldRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("row-sep relative flex items-center min-h-[52px] pl-[var(--gutter)] pr-[var(--gutter)] gap-3", className)}>
      <span className="text-[16px] text-primary shrink-0">{label}</span>
      <div className="flex-1 min-w-0 flex justify-end items-center">{children}</div>
    </div>
  );
}

/** iOS-style switch with a springy thumb. The global tap haptic covers the toggle. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cn("group relative w-[51px] h-[31px] rounded-full transition-colors duration-300 shrink-0", checked ? "bg-primary" : "bg-border")}>
      <span className={cn("absolute top-[2px] left-[2px] h-[27px] w-[27px] group-active:w-[33px] rounded-full bg-white shadow-thumb transition-[transform,width] duration-300", checked && "translate-x-[20px] group-active:translate-x-[14px]")} style={{ transitionTimingFunction: "var(--spring-snappy)" }} />
    </button>
  );
}

export function Chip({ children, selected, onClick, className, color }: { children: ReactNode; selected?: boolean; onClick?: () => void; className?: string; color?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-8 px-3 rounded-full text-[13px] whitespace-nowrap pressable-spring", selected ? "bg-primary text-canvas shadow-thumb" : "well text-secondary", className)} style={color && !selected ? { color, background: `color-mix(in oklab, ${color} 10%, var(--bg-surface))` } : undefined}>
      {children}
    </button>
  );
}
