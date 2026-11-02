import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** One sentence plus one plain action. No illustration, no emoji. */
export function Empty({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center text-center px-[var(--gutter)] pt-10 pb-6 gap-2", className)}>
      <p className="text-callout text-secondary max-w-[32ch]">{children}</p>
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("bg-surface rounded-md mx-[var(--gutter)] overflow-hidden", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={cn("h-11 flex items-center px-[var(--gutter)] gap-3", i > 0 && "hairline-t")}>
          <div className="h-3 rounded-full bg-surface-2" style={{ width: `${40 + ((i * 23) % 40)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function InlineError({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="mx-[var(--gutter)] my-2 flex items-center justify-between gap-3 text-footnote text-secondary">
      <span>{children}</span>
      {onRetry && (
        <button type="button" className="text-accent-text font-medium" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
