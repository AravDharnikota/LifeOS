import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/ui/Spinner";

/** Footnote label in secondary color. Used only when the content needs a name. */
export function WidgetLabel({ children, trailing, className }: { children: ReactNode; trailing?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-2 mb-2", className)}>
      <h3 className="text-footnote text-secondary truncate">{children}</h3>
      {trailing != null && <span className="text-footnote text-tertiary tabular shrink-0">{trailing}</span>}
    </div>
  );
}

/** One sentence plus one plain action, vertically centered in the widget. */
export function WidgetEmpty({ children, action, onAction, className }: { children: ReactNode; action?: string; onAction?: () => void; className?: string }) {
  return (
    <div className={cn("flex-1 flex flex-col items-start justify-center gap-1 py-2", className)}>
      <p className="text-subhead text-secondary">{children}</p>
      {action && (
        <button type="button" className="pointer-events-auto text-subhead text-accent-text font-medium min-h-[32px] -ml-1 px-1 active:opacity-60" onClick={(e) => { e.stopPropagation(); onAction?.(); }}>
          {action}
        </button>
      )}
    </div>
  );
}

/** Skeleton bars inside a widget. Shown only after a short delay by the frame. */
export function WidgetSkeleton({ hero, lines = 2 }: { hero?: boolean; lines?: number }) {
  return (
    <div className="flex-1 flex flex-col gap-3 py-1" aria-hidden="true">
      {hero && <div className="h-8 w-24 rounded-xs bg-surface-2" />}
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded-full bg-surface-2" style={{ width: `${55 + ((i * 29) % 35)}%` }} />
      ))}
    </div>
  );
}

export function WidgetError({ children = "Unable to load.", onRetry }: { children?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-between gap-3 text-footnote text-secondary py-2">
      <span>{children}</span>
      {onRetry && (
        <button type="button" className="pointer-events-auto text-accent-text font-medium min-h-[32px] px-1" onClick={(e) => { e.stopPropagation(); onRetry(); }}>
          Retry
        </button>
      )}
    </div>
  );
}

/** The number is the hero: rounded tabular numerals with the unit two steps smaller in secondary. */
export function Hero({ value, unit, size = "title-1", className, pending }: { value: ReactNode; unit?: ReactNode; size?: "title-1" | "display-44"; className?: string; pending?: boolean }) {
  return (
    <div className={cn("flex items-baseline gap-1.5 min-w-0", className)}>
      <span className={cn("num text-primary", size === "display-44" ? "text-display-44" : "text-title-1", pending && "opacity-60 transition-opacity duration-150")}>{value}</span>
      {unit != null && <span className="text-subhead text-secondary">{unit}</span>}
    </div>
  );
}

export function Sub({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-footnote text-secondary mt-0.5", className)}>{children}</div>;
}

/** Inline write error inside a widget: names the fix, next to the thing that failed. */
export function WriteError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-footnote text-danger-text mt-2">
      <span className="truncate">{message}</span>
      {onRetry && (
        <button type="button" className="text-accent-text font-medium shrink-0 min-h-[28px] px-1" onClick={(e) => { e.stopPropagation(); onRetry(); }}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Busy() {
  return <Spinner size={14} className="text-tertiary" />;
}

/** Whole-widget tap target. Content sits above it and passes taps through unless a child opts back in with `pointer-events-auto`. */
export function Pressable({ label, onPress, children, className }: { label: string; onPress: () => void; children: ReactNode; className?: string }) {
  return (
    <>
      <button type="button" aria-label={label} onClick={onPress} className="absolute inset-0 z-0 rounded-lg row-hover active:bg-pressed transition-colors duration-100 cursor-pointer" />
      <div className={cn("relative z-10 pointer-events-none flex-1 flex flex-col min-h-0", className)}>{children}</div>
    </>
  );
}
