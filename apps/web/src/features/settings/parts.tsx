import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Group } from "@/ui/List";
import { Icon, type IconName } from "@/ui/Icon";
import "./settings.css";

/** A glass group whose rows lead with icon wells; hairlines are inset to the text edge. */
export const IconGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function IconGroup({ className, ...rest }, ref) {
  return <Group ref={ref} className={cn("settings-rows", className)} {...rest} />;
});

/** Small neutral icon in a white well, the leading mark of a settings row. */
export function RowIcon({ name, tone }: { name: IconName; tone?: "danger" | "accent" }) {
  return (
    <span className={cn("w-8 h-8 rounded-[10px] well inline-flex items-center justify-center shrink-0", tone === "danger" ? "text-danger-text" : tone === "accent" ? "text-accent-text" : "text-secondary")} aria-hidden="true">
      <Icon name={name} size={16} strokeWidth={1.8} />
    </span>
  );
}

/** A data-colored dot in the same well, for rows that stand for a metric (calories, protein, water). */
export function RowDot({ color }: { color: string }) {
  return (
    <span className="w-8 h-8 rounded-[10px] well inline-flex items-center justify-center shrink-0" aria-hidden="true">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

/** FieldRow label with its icon well. */
export function IconLabel({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className="flex items-center gap-3">
      <RowIcon name={icon} />
      {children}
    </span>
  );
}
