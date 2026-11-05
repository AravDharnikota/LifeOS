import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";

/** Section header: footnote, secondary, sentence case, 8px above its group. */
export function SectionHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-end justify-between px-[calc(var(--gutter)+4px)] pb-2.5", className)}>
      <h2 className="text-[15px] text-primary">{title}</h2>
      {action}
    </div>
  );
}

/** Inset-grouped glass card with hairline rows. */
export const Group = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { inset?: boolean }>(function Group({ className, inset = true, children, ...rest }, ref) {
  return (
    <div ref={ref} className={cn("glass rounded-lg overflow-hidden group-rows", inset && "mx-[var(--gutter)]", className)} {...rest}>
      {children}
    </div>
  );
});

export interface RowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  as?: "div" | "button" | "label";
  disabled?: boolean;
  /** Draw a hairline above this row (default true for all but the first child via CSS). */
  separator?: boolean;
}

/** List row: 44px min, 16px inset, hairline above (inset to the text edge), press state on pointerdown. */
export function Row({ title, subtitle, leading, trailing, chevron, onPress, className, disabled, separator = true, ...rest }: RowProps) {
  const interactive = Boolean(onPress);
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive && !disabled ? 0 : undefined}
      onClick={disabled ? undefined : onPress}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPress?.(); } } : undefined}
      className={cn("relative flex items-center gap-3 min-h-[52px] pl-[var(--gutter)] pr-[var(--gutter)]", interactive && "cursor-pointer row-hover active:bg-pressed transition-colors duration-150", disabled && "opacity-40", separator && "row-sep", className)}
      {...rest}
    >
      {leading != null && <div className="shrink-0 flex items-center justify-center text-secondary">{leading}</div>}
      <div className="flex-1 min-w-0 py-[14px]">
        <div className="text-[16px] text-primary truncate">{title}</div>
        {subtitle != null && <div className="text-[13px] text-tertiary truncate-2 mt-0.5">{subtitle}</div>}
      </div>
      {trailing != null && <div className="shrink-0 text-subhead text-secondary tabular flex items-center gap-2">{trailing}</div>}
      {chevron && <Icon name="chevron-right" size={18} className="text-quaternary -mr-1 shrink-0" />}
    </div>
  );
}

/** A row whose trailing side is a value, used in settings and detail screens. */
export function ValueRow(props: RowProps & { value: ReactNode }) {
  const { value, trailing, ...rest } = props;
  return <Row trailing={<span className="text-secondary tabular">{value}</span>} {...rest} />;
}

export function Footnote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[12px] text-tertiary px-[calc(var(--gutter)+4px)] pt-2", className)}>{children}</p>;
}

/** Vertical rhythm between groups: 24px. Sections with headers: 32px. */
export function Section({ title, action, children, className, footer }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <section className={cn("mt-7 first:mt-0", className)}>
      {title != null && <SectionHeader title={title} action={action} />}
      {children}
      {footer != null && <Footnote>{footer}</Footnote>}
    </section>
  );
}
