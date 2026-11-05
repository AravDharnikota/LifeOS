import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/*
 * Grouped form pieces for the goal and tracker sheets: white wells with hairline rows,
 * a quiet label on the left and the value on the right (like iOS grouped settings, on glass).
 */

/** A white well holding rows separated by hairlines. */
export function WellGroup({ children, className, error, hint }: { children: ReactNode; className?: string; error?: ReactNode; hint?: ReactNode }) {
  return (
    <div className={className}>
      <div className="well rounded-[14px] overflow-hidden divide-y divide-separator">{children}</div>
      {error ? <p className="text-[13px] text-danger-text mt-1.5 px-1">{error}</p> : hint ? <p className="text-[12px] text-tertiary mt-1.5 px-1">{hint}</p> : null}
    </div>
  );
}

/** Small label above a block (chips, a segmented control). */
export function FormLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("block text-[13px] text-tertiary mb-2 px-1", className)}>{children}</span>;
}

export interface WellInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Row label; omit for a full-width field (titles). */
  label?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
}

/** One input row. With a label the value sits right-aligned; without, it fills the row. 16px keeps iOS from zooming. */
export const WellInput = forwardRef<HTMLInputElement, WellInputProps>(function WellInput({ label, trailing, invalid, className, ...rest }, ref) {
  return (
    <label className={cn("flex items-center gap-3 min-h-[50px] px-4", className)}>
      {label != null && <span className={cn("text-[15px] shrink-0", invalid ? "text-danger-text" : "text-secondary")}>{label}</span>}
      <input ref={ref} className={cn("flex-1 min-w-0 h-[50px] bg-transparent outline-none text-[16px] text-primary placeholder:text-quaternary", label != null && "text-right tabular [&::-webkit-date-and-time-value]:text-right")} aria-invalid={invalid || undefined} {...rest} />
      {trailing}
    </label>
  );
});

export function WellTextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("block w-full min-h-[88px] px-4 py-3.5 bg-transparent outline-none text-[16px] text-primary placeholder:text-quaternary resize-y", className)} {...rest} />;
}

/** A row with a label and any control on the right (segmented control, stepper). */
export function WellRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 min-h-[50px] px-4", className)}>
      <span className="text-[15px] text-secondary shrink-0">{label}</span>
      <div className="min-w-0 flex justify-end">{children}</div>
    </div>
  );
}
