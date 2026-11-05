import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/ui/Icon";
import { Spinner } from "@/ui/Spinner";
import { BigNumber } from "@/ui/viz";

/**
 * Card label. Without an icon it is a quiet stat label ("Water"); with one it is a list-card
 * header (icon in a white well, title, optional sub line), like the kit's CardHeader.
 */
export function WidgetLabel({ children, trailing, sub, icon, className }: { children: ReactNode; trailing?: ReactNode; sub?: ReactNode; icon?: IconName; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5", icon ? "mb-3" : "mb-2", className)}>
      {icon && (
        <span className="w-8 h-8 rounded-[10px] well inline-flex items-center justify-center shrink-0 text-secondary">
          <Icon name={icon} size={16} strokeWidth={1.8} />
        </span>
      )}
      <div className={cn("flex-1 min-w-0", icon && "pt-px")}>
        <h3 className={cn("truncate", icon ? "text-[15px] leading-5 text-primary" : "text-[13px] leading-4 text-secondary")}>{children}</h3>
        {sub != null && <div className="text-[12px] leading-4 text-tertiary truncate mt-0.5">{sub}</div>}
      </div>
      {trailing != null && <span className={cn("shrink-0 text-[12px] leading-4 text-tertiary tabular", icon && "pt-0.5")}>{trailing}</span>}
    </div>
  );
}

/** One sentence plus one plain action, vertically centered in the widget. */
export function WidgetEmpty({ children, action, onAction, className }: { children: ReactNode; action?: string; onAction?: () => void; className?: string }) {
  return (
    <div className={cn("flex-1 flex flex-col items-start justify-center gap-0.5 py-1", className)}>
      <p className="text-[14px] leading-5 text-secondary">{children}</p>
      {action && (
        <button type="button" className="pointer-events-auto text-[14px] text-accent-text min-h-[32px] -ml-1 px-1 active:opacity-60" onClick={(e) => { e.stopPropagation(); onAction?.(); }}>
          {action}
        </button>
      )}
    </div>
  );
}

/** Shimmer bars inside a widget while it loads. */
export function WidgetSkeleton({ hero, lines = 2 }: { hero?: boolean; lines?: number }) {
  return (
    <div className="flex-1 flex flex-col gap-3 py-1" aria-hidden="true">
      {hero && <div className="h-8 w-20 rounded-xs shimmer" />}
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-2.5 rounded-full shimmer" style={{ width: `${55 + ((i * 29) % 35)}%` }} />
      ))}
    </div>
  );
}

export function WidgetError({ children = "Unable to load.", onRetry }: { children?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-between gap-3 text-[13px] text-secondary py-2">
      <span>{children}</span>
      {onRetry && (
        <button type="button" className="pointer-events-auto text-accent-text min-h-[32px] px-1" onClick={(e) => { e.stopPropagation(); onRetry(); }}>
          Retry
        </button>
      )}
    </div>
  );
}

/** The number is the hero: the kit's thin BigNumber, unit small beside it. Dims while a write is in flight. */
export function Hero({ value, unit, size = "title-1", className, pending }: { value: ReactNode; unit?: ReactNode; size?: "title-1" | "display-44"; className?: string; pending?: boolean }) {
  return (
    <BigNumber
      value={value}
      unit={unit}
      size={size === "display-44" ? 44 : 34}
      className={cn("transition-opacity duration-150", pending && "opacity-60", className)}
    />
  );
}

/** Quiet caption under a number. */
export function Sub({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[12px] leading-4 text-tertiary mt-1", className)}>{children}</div>;
}

/** Inline write error inside a widget: names the fix, next to the thing that failed. */
export function WriteError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[13px] text-danger-text mt-2">
      <span className="truncate">{message}</span>
      {onRetry && (
        <button type="button" className="pointer-events-auto text-accent-text shrink-0 min-h-[28px] px-1" onClick={(e) => { e.stopPropagation(); onRetry(); }}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Busy() {
  return <Spinner size={14} className="text-tertiary" />;
}

/** Small white pill inside a card (value chips, +250 ml, Check In). */
export const chipClass = "pointer-events-auto h-8 px-3 rounded-full well inline-flex items-center justify-center gap-1.5 text-[13px] text-primary tabular whitespace-nowrap active:bg-pressed pressable disabled:opacity-40";

/** A nested white list inside a card ("well"), rows separated by hairlines. */
export function WellList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("well rounded-md overflow-hidden [&>*+*]:border-t [&>*+*]:border-separator", className)}>{children}</div>;
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
